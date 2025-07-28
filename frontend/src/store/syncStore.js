// frontend/src/store/syncStore.js
import { defineStore } from 'pinia';
import { markRaw, ref } from 'vue';
import initWasm from '@vlcn.io/crsqlite-wasm';
import wasmUrl from '@vlcn.io/crsqlite-wasm/crsqlite.wasm?url';
import { useAuthStore } from './authStore';

const API_URL = import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000';

const DB_SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users   (id TEXT PRIMARY KEY NOT NULL, email TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY NOT NULL, user_id TEXT, name TEXT, parent_id TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS notes   (id TEXT PRIMARY KEY NOT NULL, user_id TEXT, folder_id TEXT, title TEXT, content TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS images  (id TEXT PRIMARY KEY NOT NULL, user_id TEXT, filename TEXT, mime_type TEXT, data BLOB, created_at TEXT);
  CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY NOT NULL, value TEXT);

  SELECT crsql_as_crr('users');
  SELECT crsql_as_crr('folders');
  SELECT crsql_as_crr('notes');
  SELECT crsql_as_crr('images');
  SELECT crsql_as_crr('settings');
`;

export const useSyncStore = defineStore('syncStore', () => {
  /* -------------------------------------------------------
   * State
   * -----------------------------------------------------*/
  const sqlite = ref(null); // wasm module root
  const db = ref(null);     // db handle
  const isInitialized = ref(false);

  const syncEnabled = ref(true);
  const isSyncing = ref(false);

  let syncTimer = null;

  /* -------------------------------------------------------
   * Local clock + site id helpers
   * -----------------------------------------------------*/
  function getClock() {
    return Number(localStorage.getItem('crsqlite_clock') || 0);
  }
  function setClock(v) {
    localStorage.setItem('crsqlite_clock', String(v));
  }
  function getSiteId() {
    return localStorage.getItem('crsqlite_site_id') || '';
  }
  function setSiteId(id) {
    localStorage.setItem('crsqlite_site_id', id);
  }

  /* -------------------------------------------------------
   * Public API
   * -----------------------------------------------------*/
  async function execute(sql, params = []) {

    // 🛡️ ADD THIS GUARD CLAUSE
    if (!isInitialized.value || !db.value) {
      console.warn('[syncStore] DB not initialized. Aborting execute.');
      return []; // Return an empty array to prevent the app from crashing
    }
    return db.value.execO(sql, params);
  }

  // expose raw db so legacy calls like syncStore.db.exec still work
  function getDb() {
    return db.value;
  }

  /* -------------------------------------------------------
   * Tx helper
   * -----------------------------------------------------*/
  function withTx(fn) {
    db.value.exec('BEGIN');
    try {
      const res = fn();
      db.value.exec('COMMIT');
      return res;
    } catch (e) {
      try { db.value.exec('ROLLBACK'); } catch (_) { }
      throw e;
    }
  }

  /* -------------------------------------------------------
   * Init / Reset
   * -----------------------------------------------------*/
  async function initializeDB() {
    if (isInitialized.value && db.value) return;

    console.log('[syncStore] Initializing crsqlite wasm…');

    // ---- WASM INIT ----
    sqlite.value = markRaw(await initWasm(() => wasmUrl));

    // ---- OPEN DB ----
    const auth = useAuthStore();
    const dbName = auth.isAuthenticated
      ? `panino-${auth.user.id}.db`
      : 'panino-guest.db';

    db.value = markRaw(await sqlite.value.open(dbName));
    db.value.exec(DB_SCHEMA);

    // ✅ FIX: More robust site_id initialization
    let siteId = getSiteId();
    if (!siteId) {
      console.log('[syncStore] No site_id in localStorage, querying from DB...');
      // The result is an array of objects
      const rows = await db.value.execO(`SELECT hex(crsql_site_id()) AS id`);

      // Log the raw result for debugging
      console.log('[syncStore] Raw site_id query result:', rows);

      const row = rows[0];
      if (row && typeof row.id === 'string' && row.id.length > 0) {
        siteId = row.id.toLowerCase();
        console.log(`[syncStore] Fetched and saved new site_id: ${siteId}`);
        setSiteId(siteId);
      } else {
        // This is a critical failure. The app cannot sync without a site ID.
        // Throwing an error here will display it on the loading page.
        throw new Error(
          "Fatal: Could not retrieve crsql_site_id from the database. " +
          `Query returned: ${JSON.stringify(rows)}`
        );
      }
    } else {
      console.log(`[syncStore] Found existing site_id in localStorage: ${siteId}`);
    }

    isInitialized.value = true;
    scheduleSync();
  }

  async function resetDatabase() {
    cancelSync();
    if (db.value) {
      try { await db.value.close(); } catch (_) { }
    }
    db.value = null;
    isInitialized.value = false;
    setClock(0);
  }

  /* -------------------------------------------------------
   * Sync logic
   * -----------------------------------------------------*/

  /* -------------------------------------------------------
  * Sync logic
  * -----------------------------------------------------*/

  // Helper function to convert a hex string to a Uint8Array
  function hexToUint8Array(hexString) {
    if (!hexString || hexString.length % 2 !== 0) {
      return null;
    }
    const bytes = new Uint8Array(hexString.length / 2);
    for (let i = 0; i < hexString.length; i += 2) {
      bytes[i / 2] = parseInt(hexString.substring(i, i + 2), 16);
    }
    return bytes;
  }

  async function sync() {
    if (!syncEnabled.value || !isInitialized.value || isSyncing.value) return;
    isSyncing.value = true;
    try {
      const myClock = getClock();
      const mySite = getSiteId();

      // 1. Local changes since last clock
      const queryResult = await db.value.execO(
        `SELECT "table", pk, cid, val, col_version, db_version,
                hex(site_id) AS site_id, seq, cl
                FROM crsql_changes
                WHERE db_version > ?
                ORDER BY db_version ASC`,
        [myClock]
      );
      const localChanges = Array.from(queryResult || []);

      // ✅ ADD THIS LOG
      if (localChanges.length > 0) {
        console.log('CLIENT: Sending changes to server:', JSON.stringify(localChanges, null, 2));
      }

      // 2. Send + receive
      const resp = await fetch(`${API_URL}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt_token') || ''}`
        },
        body: JSON.stringify({
          since: myClock,
          siteId: mySite,
          changes: localChanges
        })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Sync failed: ${resp.status}`);
      }

      const { changes: remoteChanges, clock: newClock } = await resp.json();

      // 3. Apply remote changes
      if (remoteChanges?.length) {
        const insertSQL = `
          INSERT INTO crsql_changes
            ("table", pk, cid, val, col_version, db_version, site_id, seq, cl)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        withTx(() => {
          for (const ch of remoteChanges) {
            db.value.exec(insertSQL, [
              ch.table,
              hexToUint8Array(ch.pk), // This is the fix
              ch.cid,
              ch.val,
              Number(ch.col_version) || 0,
              Number(ch.db_version) || 0,
              hexToUint8Array(ch.site_id),
              Number(ch.seq) || 0,
              Number(ch.cl) || 0
            ]);
          }
        });
      }

      // 4. Update clock
      setClock(newClock ?? myClock);
    } catch (e) {
      console.error('[syncStore] sync error', e);
    } finally {
      isSyncing.value = false;
    }
  }

  function scheduleSync(intervalMs = 5000) {
    cancelSync();
    if (!syncEnabled.value) return;
    syncTimer = setInterval(sync, intervalMs);
  }

  function cancelSync() {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  }

  function setSyncEnabled(v) {
    syncEnabled.value = v;
    if (v) scheduleSync();
    else cancelSync();
  }

  /* -------------------------------------------------------
   * Exports
   * -----------------------------------------------------*/
  return {
    // state
    isInitialized,
    syncEnabled,
    isSyncing,

    // db access
    db: { get value() { return getDb(); } },
    execute,

    // lifecycle
    initializeDB,
    resetDatabase,

    // sync
    sync,
    setSyncEnabled
  };
});
