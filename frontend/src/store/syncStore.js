// /frontend/src/store/syncStore.js
import { defineStore } from 'pinia';
import { markRaw, ref } from 'vue';
import initWasm from '@vlcn.io/crsqlite-wasm';
import wasmUrl from '@vlcn.io/crsqlite-wasm/crsqlite.wasm?url';
import { useAuthStore } from './authStore';
import { useDocStore } from './docStore';
import { useGlobalVariablesStore } from './globalVariablesStore';

const isProd = import.meta.env.PROD;
const API_URL = isProd ? '/api' : (import.meta.env.VITE_API_SERVICE_URL || 'http://localhost:8000');
const WS_URL = isProd ? window.location.origin.replace(/^http/, 'ws') + '/ws/' : API_URL.replace(/^http/, 'ws');

const DB_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, name TEXT, email TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY NOT NULL, user_id TEXT, name TEXT, parent_id TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY NOT NULL, user_id TEXT, folder_id TEXT, title TEXT, content TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY NOT NULL, user_id TEXT, filename TEXT, mime_type TEXT, path TEXT, size_bytes INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '', created_at TEXT);
CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY NOT NULL, value TEXT);
CREATE TABLE IF NOT EXISTS globals (
  key TEXT PRIMARY KEY NOT NULL,
  id TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  display_key TEXT NOT NULL DEFAULT ''
);
SELECT crsql_as_crr('users');
SELECT crsql_as_crr('folders');
SELECT crsql_as_crr('notes');
SELECT crsql_as_crr('images');
SELECT crsql_as_crr('settings');
`;

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export const useSyncStore = defineStore('syncStore', () => {
  const sqlite = ref(null);
  const db = ref(null);
  const isInitialized = ref(false);
  const syncEnabled = ref(true);
  const isSyncing = ref(false);
  const ws = ref(null);
  const hasShownAuthWarning = ref(false);
  const isOnline = ref(navigator.onLine);

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

  async function initializeDB() {
    if (isInitialized.value) return;

    console.log('[syncStore] Initializing crsqlite wasm…');
    sqlite.value = markRaw(await initWasm(() => wasmUrl));

    const auth = useAuthStore();
    const dbName = auth.isAuthenticated ? `panino-${auth.user.id}.db` : 'panino-guest.db';

    db.value = markRaw(await sqlite.value.open(dbName));
    db.value.exec(DB_SCHEMA);
    await ensureImagesSchema();
    await ensureGlobalsSchema();

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

    db.value.onUpdate(() => {
      console.log("Local DB update detected, triggering sync.");
      debouncedSync();
    });

    isInitialized.value = true;
    
    // Set up online/offline listeners
    setupOnlineOfflineListeners();
  }

  async function ensureGlobalsSchema() {
    if (!db.value) return;
    try {
      const columns = await db.value.execO("PRAGMA table_info('globals')");
      if (!columns || columns.length === 0) {
        await db.value.exec(`
          CREATE TABLE IF NOT EXISTS globals (
            key TEXT PRIMARY KEY NOT NULL,
             id TEXT NOT NULL DEFAULT '',
            value TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            display_key TEXT NOT NULL DEFAULT ''
          )
        `);
        await db.value.exec("SELECT crsql_as_crr('globals')");
        return;
      }

      const names = new Set((columns || []).map(c => c.name));
      const indexes = await db.value.execO("PRAGMA index_list('globals')");
      const hasExtraUnique = (indexes || []).some(idx => idx?.unique && idx?.origin !== 'pk');

      if (hasExtraUnique) {
        const selectId = names.has('id') ? 'id' : 'key';
        const selectCreated = names.has('created_at') ? 'created_at' : "datetime('now')";
        const selectUpdated = names.has('updated_at') ? 'updated_at' : "datetime('now')";
        const selectDisplay = names.has('display_key') ? 'display_key' : 'key';

        await db.value.exec('BEGIN');
        try {
          await db.value.exec(`
            CREATE TABLE globals_new (
              key TEXT PRIMARY KEY NOT NULL,
               id TEXT NOT NULL DEFAULT '',
              value TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              display_key TEXT NOT NULL DEFAULT ''
            )
          `);
          await db.value.exec(`
            INSERT INTO globals_new (key, id, value, created_at, updated_at, display_key)
            SELECT
              key,
              ${selectId} as id,
              value,
              ${selectCreated} as created_at,
              ${selectUpdated} as updated_at,
              ${selectDisplay} as display_key
            FROM globals
          `);
          await db.value.exec('DROP TABLE globals');
          await db.value.exec('ALTER TABLE globals_new RENAME TO globals');
          await db.value.exec("SELECT crsql_as_crr('globals')");
          await db.value.exec('COMMIT');
          return;
        } catch (err) {
          await db.value.exec('ROLLBACK');
          throw err;
        }
      }

      if (!names.has('id')) {
        await db.value.exec("ALTER TABLE globals ADD COLUMN id TEXT NOT NULL DEFAULT ''");
        await db.value.exec('UPDATE globals SET id = key WHERE id IS NULL');
      }
      if (!names.has('created_at')) {
        await db.value.exec("ALTER TABLE globals ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))");
        await db.value.exec("UPDATE globals SET created_at = datetime('now') WHERE created_at IS NULL");
      }
      if (!names.has('updated_at')) {
        await db.value.exec("ALTER TABLE globals ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
        await db.value.exec("UPDATE globals SET updated_at = datetime('now') WHERE updated_at IS NULL");
      }
      if (!names.has('display_key')) {
        await db.value.exec("ALTER TABLE globals ADD COLUMN display_key TEXT NOT NULL DEFAULT ''");
        await db.value.exec('UPDATE globals SET display_key = key WHERE display_key IS NULL');
      }
      await db.value.exec("SELECT crsql_as_crr('globals')");
    } catch (err) {
      console.error('[syncStore] Failed to ensure globals schema', err);
    }
  }

  async function ensureImagesSchema() {
    if (!db.value) return;
    try {
      const columns = await db.value.execO("PRAGMA table_info('images')");
      if (!columns || columns.length === 0) {
        return;
      }

      const names = new Set((columns || []).map(c => c.name));

      if (!names.has('size_bytes')) {
        await db.value.exec("ALTER TABLE images ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0");
        await db.value.exec('UPDATE images SET size_bytes = 0 WHERE size_bytes IS NULL');
      }

      if (!names.has('sha256')) {
        await db.value.exec("ALTER TABLE images ADD COLUMN sha256 TEXT NOT NULL DEFAULT ''");
        await db.value.exec("UPDATE images SET sha256 = '' WHERE sha256 IS NULL");
      }

      await db.value.exec("SELECT crsql_as_crr('images')");
    } catch (err) {
      console.error('[syncStore] Failed to ensure images schema', err);
    }
  }

  function setupOnlineOfflineListeners() {
    const handleOnline = async () => {
      console.log('[Sync] Network connection restored');
      isOnline.value = true;
      
      const auth = useAuthStore();
      if (auth.isAuthenticated && syncEnabled.value) {
        // Reset auth warning flag when coming online
        hasShownAuthWarning.value = false;
        
        // Show toast
        const { useUiStore } = await import('./uiStore');
        const uiStore = useUiStore();
        uiStore.addToast('Back online! Syncing your notes...', 'success', 3000);
        
        // Reconnect websocket and sync
        connectWebSocket();
        sync();
      } else if (auth.isAuthenticated && !syncEnabled.value) {
        // User is authenticated but sync was disabled while offline
        const { useUiStore } = await import('./uiStore');
        const uiStore = useUiStore();
        uiStore.addToast('Back online! Enable sync to sync your notes.', 'info', 5000);
      }
    };
    
    const handleOffline = async () => {
      console.log('[Sync] Network connection lost');
      isOnline.value = false;
      
      const { useUiStore } = await import('./uiStore');
      const uiStore = useUiStore();
      uiStore.addToast('You\'re offline. Changes will sync when you reconnect.', 'warning', 5000);
      
      // Disconnect websocket when offline (but don't disable sync)
      // This way sync state is preserved for when we come back online
      disconnectWebSocket();
    };
    
    // Remove existing listeners if any
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    
    // Add new listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  async function resetDatabase() {
    disconnectWebSocket();
    hasShownAuthWarning.value = false; // Reset warning flag on database reset
    if (db.value) {
      try { await db.value.close(); } catch (_) { }
    }
    db.value = null;
    isInitialized.value = false;
    setClock(0);
  }

  function hexToUint8Array(hex) {
    if (!hex || hex.length % 2 !== 0) return new Uint8Array();
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  async function sync() {
    const auth = useAuthStore();
    if (!syncEnabled.value || !isInitialized.value || isSyncing.value || !auth.isAuthenticated) return;
    
    // Skip sync if offline
    if (!isOnline.value) {
      console.log('[Sync] Skipping sync - offline');
      return;
    }

    isSyncing.value = true;
    try {
      const myClock = getClock();
      const mySite = getSiteId();

      const localChanges = await db.value.execO(
        `SELECT "table", pk, cid, val, col_version, db_version, hex(site_id) AS site_id, seq, cl FROM crsql_changes WHERE db_version > ? ORDER BY db_version ASC`,
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

      if (!resp.ok) {
        // Check if it's an authentication error (401 or 403)
        if (resp.status === 401 || resp.status === 403) {
          console.log('[Sync] Authentication failed, attempting token refresh...');
          
          // Try to refresh the token
          const refreshed = await auth.refreshToken();
          
          if (refreshed) {
            console.log('[Sync] Token refreshed successfully, retrying sync...');
            hasShownAuthWarning.value = false;
            isSyncing.value = false; // Reset syncing flag
            return sync(); // Retry with new token
          }
          
          // If refresh failed, show warning only once
          if (!hasShownAuthWarning.value) {
            const { useUiStore } = await import('./uiStore');
            const uiStore = useUiStore();
            uiStore.addToast('Your session has expired. Please log in again to sync.', 'warning');
            hasShownAuthWarning.value = true;
          }
          // Disable sync to prevent further attempts
          syncEnabled.value = false;
          disconnectWebSocket();
          throw new Error('Authentication failed');
        }
        throw new Error(`Sync failed: ${resp.status}`);
      }

      const { changes: remoteChanges, clock: newClock } = await resp.json();

      if (remoteChanges?.length) {
        console.log(`Applying ${remoteChanges.length} remote changes.`);
        const insertSQL = `INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id, seq, cl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        await db.value.exec('BEGIN');
        try {
          for (const ch of remoteChanges) {
            await db.value.exec(insertSQL, [
              ch.table, hexToUint8Array(ch.pk), ch.cid, ch.val,
              ch.col_version, ch.db_version, hexToUint8Array(ch.site_id),
              ch.seq, ch.cl
            ]);
          }
          await db.value.exec('COMMIT');
        } catch (e) {
          await db.value.exec('ROLLBACK');
          throw e;
        }

        useDocStore().refreshData();
        useGlobalVariablesStore().loadGlobals();
      }

      setClock(newClock ?? myClock);
    } catch (e) {
      console.error('[syncStore] sync error', e);
    } finally {
      isSyncing.value = false;
    }
  }

  function connectWebSocket() {
    if (ws.value || !syncEnabled.value) return;
    const auth = useAuthStore();
    const siteId = getSiteId();
    if (!auth.token || !siteId) return;

    console.log('[Sync] Connecting WebSocket...');
    ws.value = new WebSocket(`${WS_URL}?token=${auth.token}&siteId=${siteId}`);

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
    const auth = useAuthStore();
    
    // Prevent enabling sync if offline or not authenticated
    if (v && !isOnline.value) {
      console.warn('[Sync] Cannot enable sync while offline');
      return false;
    }
    
    if (v && !auth.isAuthenticated) {
      console.warn('[Sync] Cannot enable sync without authentication');
      return false;
    }
    
    syncEnabled.value = v;
    
    if (v) {
      hasShownAuthWarning.value = false; // Reset warning flag when re-enabling sync
      console.log('[Sync] Sync enabled, connecting...');
      connectWebSocket();
      sync();
    } else {
      console.log('[Sync] Sync disabled, disconnecting...');
      disconnectWebSocket();
    }
    
    return true;
  }

  return {
    isInitialized, syncEnabled, isSyncing, isOnline,
    db: { get value() { return db.value; } },
    execute, initializeDB, resetDatabase,
    sync, setSyncEnabled, ensureGlobalsSchema, ensureImagesSchema,
    connectWebSocket, disconnectWebSocket,
  };
});