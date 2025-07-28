// /frontend/src/store/syncStore.js
import { defineStore } from 'pinia';
import { markRaw, ref } from 'vue';
import initWasm from '@vlcn.io/crsqlite-wasm';
import wasmUrl from '@vlcn.io/crsqlite-wasm/crsqlite.wasm?url';
import { useAuthStore } from './authStore';
import { useDocStore } from './docStore';

const API_URL = import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000';
const WS_URL = API_URL.replace(/^http/, 'ws');

const DB_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, email TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY NOT NULL, user_id TEXT, name TEXT, parent_id TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY NOT NULL, user_id TEXT, folder_id TEXT, title TEXT, content TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY NOT NULL, user_id TEXT, filename TEXT, mime_type TEXT, data BLOB, created_at TEXT);
  CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY NOT NULL, value TEXT);
  SELECT crsql_as_crr('users');
  SELECT crsql_as_crr('folders');
  SELECT crsql_as_crr('notes');
  SELECT crsql_as_crr('images');
  SELECT crsql_as_crr('settings');
`;

export const useSyncStore = defineStore('syncStore', () => {
  const sqlite = ref(null);
  const db = ref(null);
  const isInitialized = ref(false);
  const syncEnabled = ref(true);
  const isSyncing = ref(false);
  const ws = ref(null);

  // Debounce sync calls to bundle rapid local changes
  const debouncedSync = debounce(() => sync(), 500);

  function getClock() { return Number(localStorage.getItem('crsqlite_clock') || 0); }
  function setClock(v) { localStorage.setItem('crsqlite_clock', String(v)); }
  function getSiteId() { return localStorage.getItem('crsqlite_site_id') || ''; }
  function setSiteId(id) { localStorage.setItem('crsqlite_site_id', id); }

  async function execute(sql, params = []) {
    if (!isInitialized.value || !db.value) {
      console.warn('[syncStore] DB not initialized. Aborting execute.');
      return [];
    }
    return db.value.execO(sql, params);
  }

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

  async function initializeDB() {
    if (isInitialized.value) return;

    console.log('[syncStore] Initializing crsqlite wasm…');
    sqlite.value = markRaw(await initWasm(() => wasmUrl));

    const auth = useAuthStore();
    const dbName = auth.isAuthenticated ? `panino-${auth.user.id}.db` : 'panino-guest.db';

    db.value = markRaw(await sqlite.value.open(dbName));
    db.value.exec(DB_SCHEMA);

    let siteId = getSiteId();
    if (!siteId) {
      const rows = await db.value.execO(`SELECT hex(crsql_site_id()) AS id`);
      const row = rows[0];
      if (row && typeof row.id === 'string' && row.id.length > 0) {
        siteId = row.id.toLowerCase();
        setSiteId(siteId);
      } else {
        throw new Error(`Fatal: Could not retrieve crsql_site_id. Query returned: ${JSON.stringify(rows)}`);
      }
    }

    // ✅ HOOK: Trigger sync whenever the local DB changes.
    db.value.onUpdate(() => {
      console.log("Local DB update detected, triggering sync.");
      debouncedSync();
    });

    isInitialized.value = true;
  }

  async function resetDatabase() {
    disconnectWebSocket();
    if (db.value) {
      try { await db.value.close(); } catch (_) { }
    }
    db.value = null;
    isInitialized.value = false;
    setClock(0);
  }

  function hexToUint8Array(hex) {
    if (!hex || hex.length % 2 !== 0) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  async function sync() {
    const auth = useAuthStore();
    if (!syncEnabled.value || !isInitialized.value || isSyncing.value || !auth.isAuthenticated) return;
    isSyncing.value = true;
    try {
      const myClock = getClock();
      const mySite = getSiteId();

      const localChanges = await db.value.execO(
        `SELECT "table", pk, cid, val, col_version, db_version, hex(site_id) AS site_id, seq, cl
         FROM crsql_changes WHERE db_version > ? ORDER BY db_version ASC`,
        [myClock]
      );

      const resp = await fetch(`${API_URL}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jwt_token') || ''}`
        },
        body: JSON.stringify({ since: myClock, siteId: mySite, changes: localChanges })
      });

      if (!resp.ok) throw new Error(`Sync failed: ${resp.status}`);

      const { changes: remoteChanges, clock: newClock } = await resp.json();

      if (remoteChanges?.length) {
        console.log(`Applying ${remoteChanges.length} remote changes.`);
        const insertSQL = `INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id, seq, cl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        withTx(() => {
          for (const ch of remoteChanges) {
            db.value.exec(insertSQL, [
              ch.table, hexToUint8Array(ch.pk), ch.cid, ch.val,
              ch.col_version, ch.db_version, hexToUint8Array(ch.site_id),
              ch.seq, ch.cl
            ]);
          }
        });
        // After applying changes, refresh the main document store
        useDocStore().refreshData();
      }

      setClock(newClock ?? myClock);
    } catch (e) {
      console.error('[syncStore] sync error', e);
    } finally {
      isSyncing.value = false;
    }
  }

  // --- WebSocket Actions ---
  function connectWebSocket() {
    if (ws.value || !syncEnabled.value) return;
    const auth = useAuthStore();
    if (!auth.token) return;

    console.log('[Sync] Connecting WebSocket...');
    ws.value = new WebSocket(`${WS_URL}?token=${auth.token}`);

    ws.value.onopen = () => console.log('[Sync] WebSocket connected.');
    ws.value.onclose = () => { ws.value = null; console.log('[Sync] WebSocket disconnected.'); };
    ws.value.onerror = (err) => console.error('[Sync] WebSocket error:', err);
    ws.value.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'sync') {
        console.log('[Sync] Received "sync" poke from server.');
        sync();
      }
    };
  }

  function disconnectWebSocket() {
    if (ws.value) {
      ws.value.close();
      ws.value = null;
    }
  }

  function setSyncEnabled(v) {
    syncEnabled.value = v;
    if (v) {
      connectWebSocket();
      sync();
    } else {
      disconnectWebSocket();
    }
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  return {
    isInitialized, syncEnabled, isSyncing,
    db: { get value() { return db.value; } },
    execute, initializeDB, resetDatabase,
    sync, setSyncEnabled,
    connectWebSocket, disconnectWebSocket,
  };
});