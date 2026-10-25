// /frontend/src/store/syncStore.js
import { defineStore } from "pinia";
import { computed, markRaw, ref } from "vue";
import initWasm from "@/vendor/crsqlite-wasm/index.js";
import wasmUrl from "@/vendor/crsqlite-wasm/crsqlite.wasm?url";
import { useAuthStore } from "./authStore";
import { useDocStore } from "./docStore";
import { useDraftStore } from "./draftStore";
import { useGlobalVariablesStore } from "./globalVariablesStore";
import { parsePkId } from "@/utils/crsqlitePk";
import {
  planConflictAfterChange,
  planRemoteContent,
  resolveServerValue,
  evaluateWritebackGuard,
  WRITEBACK_WINDOW_MS,
} from "@/utils/syncMerge";
import {
  LOCAL_DB_VERSION_SQL,
  parsePushCursor,
  readOutgoingChanges,
} from "@/utils/syncCursor";
import {
  mergeContent,
  normalizeContent,
  serializeConflictHunks,
} from "@panino/content-merge";
import { v4 as uuidv4 } from "uuid";
import { deleteLocalDatabase, purgeCachedSpaceResponses } from "@/utils/localDatabaseStorage";
import {
  clockStorageKey,
  isStorageQuotaError,
  migrateLegacyPersonalClock,
  migrateLegacyPersonalPushCursor,
  pushCursorStorageKey,
  projectSpaceOutgoingChanges,
  reconnectDelayMs,
  reconcileMembershipKeys,
  runSequentially,
} from "@/utils/syncRegistry";
import {
  createDatabaseKey,
  legacySpaceDatabaseName,
  localDatabaseName,
  parseDatabaseKey,
} from "@/utils/databaseKey";
import { createScopedRepository, runExclusive } from "@/utils/scopedRepository";

const isProd = import.meta.env.PROD;
const API_URL = isProd
  ? "/api"
  : import.meta.env.VITE_API_SERVICE_URL || "http://localhost:8000";
const WS_URL = isProd
  ? window.location.origin.replace(/^http/, "ws") + "/ws/"
  : API_URL.replace(/^http/, "ws");

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
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  title_pattern TEXT NOT NULL DEFAULT '',
  default_folder_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_templates_updated ON templates(updated_at DESC);
SELECT crsql_as_crr('templates');
CREATE TABLE IF NOT EXISTS style_presets (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL DEFAULT 'preview',
  name TEXT NOT NULL DEFAULT '',
  styles TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
SELECT crsql_as_crr('style_presets');
CREATE TABLE IF NOT EXISTS style_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  preset_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
SELECT crsql_as_crr('style_assignments');

-- Local-only (non-CRR) client state for content merge (COLLAB-02). Deliberately
-- not replicated: note_sync_base tracks the last value this client and the
-- server agreed on, and note_conflicts holds displaced local bodies.
CREATE TABLE IF NOT EXISTS note_sync_base (
  note_id                     TEXT PRIMARY KEY NOT NULL,
  content                     TEXT NOT NULL DEFAULT '',
  writeback_count             INTEGER NOT NULL DEFAULT 0,
  writeback_window_started_at TEXT,
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS note_conflicts (
  note_id TEXT PRIMARY KEY NOT NULL,
  base_content TEXT NOT NULL DEFAULT '',
  mine_content TEXT NOT NULL DEFAULT '',
  theirs_content TEXT NOT NULL DEFAULT '',
  conflict_hunks TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  merge_attempts INTEGER NOT NULL DEFAULT 0
);
`;

const LOCAL_ONLY_SYNC_TABLES = new Set(["note_sync_base", "note_conflicts"]);
/** A socket must stay open this long before reconnect backoff resets. */
const STABLE_CONNECTION_MS = 5000;
/** How often a tab refused for the per-account connection limit tries again. */
const CONNECTION_LIMIT_RETRY_MS = 60000;

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export const useSyncStore = defineStore("syncStore", () => {
  const sqlite = ref(null);
  const databases = ref(new Map());
  const isInitialized = ref(false);
  const syncEnabled = ref(true);
  const isSyncing = ref(false);
  const ws = ref(null);
  const hasShownAuthWarning = ref(false);
  const isOnline = ref(navigator.onLine);

  // COLLAB-02 sync-merge state. Every registry entry owns its remote-apply and
  // queued-follow-up flags so databases cannot suppress one another.
  const contentMergeWriteback = ref(false);
  const membershipVersion = ref(0);
  const sharedSpacesAvailable = ref(false);
  // Told by the server with the space list, so a control for something the
  // server does not offer is not shown at all.
  const liveSessionsAvailable = ref(false);
  // Spaces this account owns that are waiting out their retention period.
  const pendingSpaceDeletions = ref([]);
  const bootstrapState = ref({
    status: "idle",
    currentDbKey: null,
    completed: 0,
    total: 0,
    error: null,
  });
  const personalDbKey = computed(() => {
    const userId = useAuthStore().user?.id;
    return userId ? createDatabaseKey("user", userId) : null;
  });
  let membershipRefreshPromise = null;
  let membershipRefreshRequested = false;
  let reconnectTimer = null;
  let stableConnectionTimer = null;
  let reconnectAttempts = 0;
  // Resubscriptions after the server refused a subscribe request; reset by an
  // accepted one, so a server that keeps refusing is not asked for ever.
  let subscribeRetries = 0;
  let hasShownConnectionLimitNotice = false;
  let shouldReconnect = false;
  const webSocketListeners = new Set();
  let collabRemoteGuard = null;

  const debouncedSync = debounce(() => sync(), 500);

  function addWebSocketListener(listener) {
    webSocketListeners.add(listener);
    return () => webSocketListeners.delete(listener);
  }

  function notifyWebSocketListeners(message) {
    for (const listener of webSocketListeners) listener(message);
  }

  function sendWebSocketMessage(type, payload = {}) {
    if (ws.value?.readyState !== WebSocket.OPEN) return null;
    const requestId = uuidv4();
    ws.value.send(JSON.stringify({ v: 1, type, requestId, payload }));
    return requestId;
  }

  function setCollabRemoteGuard(guard) {
    collabRemoteGuard = typeof guard === "function" ? guard : null;
  }

  function getClock(dbKey) {
    return Number(localStorage.getItem(clockStorageKey(dbKey)) || 0);
  }
  function setClock(dbKey, value) {
    localStorage.setItem(clockStorageKey(dbKey), String(value));
    const entry = databases.value.get(dbKey);
    if (entry) entry.clock = Number(value) || 0;
  }
  // The clock above is the server's version. Uploads are tracked by a separate
  // cursor in each replica's own version space (see utils/syncCursor.js).
  function getPushCursor(dbKey) {
    return localStorage.getItem(pushCursorStorageKey(dbKey));
  }
  function setPushCursor(dbKey, value) {
    localStorage.setItem(pushCursorStorageKey(dbKey), String(value));
  }

  function requireEntry(dbKey) {
    parseDatabaseKey(dbKey);
    const entry = databases.value.get(dbKey);
    if (!entry?.db) throw new Error(`Database scope ${dbKey} is not initialized.`);
    return entry;
  }

  function repository(dbKey) {
    return createScopedRepository(dbKey, (key) => databases.value.get(key)?.db || null);
  }

  function personalRepository() {
    if (!personalDbKey.value) throw new Error("Personal database scope is unavailable.");
    return repository(personalDbKey.value);
  }

  async function execute(dbKey, sql, params = []) {
    return repository(dbKey).execute(sql, params);
  }

  async function exec(dbKey, sql, params = []) {
    return repository(dbKey).exec(sql, params);
  }

  /** The signed-in account, which a space's local file is named after. */
  function accountUserId() {
    return personalDbKey.value ? parseDatabaseKey(personalDbKey.value).id : null;
  }

  const membershipCacheKey = () => `panino_spaces:${accountUserId()}`;

  /** The space list as last received, so a start without a connection can open what this device holds. */
  function readCachedMembership() {
    try {
      const cached = JSON.parse(localStorage.getItem(membershipCacheKey()) || "null");
      return Array.isArray(cached?.spaces) ? cached : null;
    } catch {
      return null;
    }
  }

  function writeCachedMembership(spaces) {
    try {
      if (!spaces) localStorage.removeItem(membershipCacheKey());
      else {
        localStorage.setItem(membershipCacheKey(), JSON.stringify({
          spaces: spaces.map(({ spaceId, name, role, members }) => ({ spaceId, name, role, members: members || [] })),
        }));
      }
    } catch {
      // A convenience for offline starts; never worth failing a refresh over.
    }
  }

  /**
   * Remove everything a space left on this device: its database, its sync
   * positions and its cached responses. Access to it has ended (removal,
   * leaving, deletion) or the user asked for the local copy to go.
   */
  async function wipeLocalSpace(dbKey) {
    const { kind, id } = parseDatabaseKey(dbKey);
    if (kind !== "space") return;
    localStorage.removeItem(clockStorageKey(dbKey));
    localStorage.removeItem(pushCursorStorageKey(dbKey));
    const account = accountUserId();
    for (const filename of [account && localDatabaseName(dbKey, account), legacySpaceDatabaseName(dbKey)]) {
      if (!filename) continue;
      try {
        await deleteLocalDatabase(filename);
      } catch (error) {
        console.warn("[syncStore] Could not delete a local space database", error?.name || error);
      }
    }
    try {
      await purgeCachedSpaceResponses(id);
    } catch (error) {
      console.warn("[syncStore] Could not clear cached responses for a space", error?.name || error);
    }
  }

  async function openDatabaseEntry({ dbKey, name, role = null, members = [] }) {
    const { kind } = parseDatabaseKey(dbKey);
    const database = markRaw(await sqlite.value.open(localDatabaseName(dbKey, accountUserId())));
    database.exec(DB_SCHEMA);
    await ensureNotesSchema(database);
    await ensureImagesSchema(database);
    await ensureGlobalsSchema(database);
    await ensureTemplatesSchema(database);

    const rows = await database.execO(`SELECT lower(hex(crsql_site_id())) AS id`);
    const siteId = rows[0]?.id;
    if (!/^[0-9a-f]{32}$/.test(siteId || "")) {
      await database.close();
      throw new Error(`Fatal: Could not retrieve crsql_site_id for ${dbKey}.`);
    }

    const entry = {
      dbKey,
      kind,
      db: database,
      siteId,
      clock: getClock(dbKey),
      name,
      role,
      members,
      isSyncing: false,
      isApplyingRemote: false,
      syncPending: false,
      lastSyncChangedData: false,
      status: "ready",
      error: null,
    };
    databases.value.set(dbKey, entry);
    database.onUpdate((_type, _dbName, tableName) => {
      // Merge bases and conflict records are client-local; writing them has
      // nothing to upload and must not schedule another round trip.
      if (LOCAL_ONLY_SYNC_TABLES.has(tableName)) return;
      if (entry.isApplyingRemote) {
        entry.syncPending = true;
        return;
      }
      debouncedSync();
    });
    return entry;
  }

  async function initializeDB() {
    if (isInitialized.value) return;

    console.info("[syncStore] Initializing crsqlite wasm…");
    sqlite.value = markRaw(await initWasm(() => wasmUrl));

    const auth = useAuthStore();
    if (!auth.isAuthenticated || !auth.user?.id) {
      throw new Error("Authentication is required to initialize the personal database.");
    }
    const dbKey = createDatabaseKey("user", auth.user.id);
    migrateLegacyPersonalClock(localStorage, dbKey);
    migrateLegacyPersonalPushCursor(localStorage, dbKey);
    await openDatabaseEntry({ dbKey, name: "Personal" });

    isInitialized.value = true;

    // Set up online/offline listeners
    setupOnlineOfflineListeners();
    shouldReconnect = true;
    connectWebSocket();

    // First paint is gated only by the personal database. Membership discovery
    // and space bootstrap deliberately continue in the background.
    queueMicrotask(() => {
      void refreshMembership({ bootstrap: true }).catch(reportMembershipRefreshFailure);
    });
  }

  async function ensureGlobalsSchema(database) {
    if (!database) throw new Error("Database scope is required for schema initialization.");
    try {
      const columns = await database.execO("PRAGMA table_info('globals')");
      if (!columns || columns.length === 0) {
        await database.exec(`
          CREATE TABLE IF NOT EXISTS globals (
            key TEXT PRIMARY KEY NOT NULL,
             id TEXT NOT NULL DEFAULT '',
            value TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            display_key TEXT NOT NULL DEFAULT ''
          )
        `);
        await database.exec("SELECT crsql_as_crr('globals')");
        return;
      }

      const names = new Set((columns || []).map((c) => c.name));
      const indexes = await database.execO("PRAGMA index_list('globals')");
      const hasExtraUnique = (indexes || []).some(
        (idx) => idx?.unique && idx?.origin !== "pk",
      );

      if (hasExtraUnique) {
        const selectId = names.has("id") ? "id" : "key";
        const selectCreated = names.has("created_at")
          ? "created_at"
          : "datetime('now')";
        const selectUpdated = names.has("updated_at")
          ? "updated_at"
          : "datetime('now')";
        const selectDisplay = names.has("display_key") ? "display_key" : "key";

        await database.exec("BEGIN");
        try {
          await database.exec(`
            CREATE TABLE globals_new (
              key TEXT PRIMARY KEY NOT NULL,
               id TEXT NOT NULL DEFAULT '',
              value TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              display_key TEXT NOT NULL DEFAULT ''
            )
          `);
          await database.exec(`
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
          await database.exec("DROP TABLE globals");
          await database.exec("ALTER TABLE globals_new RENAME TO globals");
          await database.exec("SELECT crsql_as_crr('globals')");
          await database.exec("COMMIT");
          return;
        } catch (err) {
          await database.exec("ROLLBACK");
          throw err;
        }
      }

      if (!names.has("id")) {
        await database.exec(
          "ALTER TABLE globals ADD COLUMN id TEXT NOT NULL DEFAULT ''",
        );
        await database.exec("UPDATE globals SET id = key WHERE id IS NULL");
      }
      if (!names.has("created_at")) {
        await database.exec(
          "ALTER TABLE globals ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))",
        );
        await database.exec(
          "UPDATE globals SET created_at = datetime('now') WHERE created_at IS NULL",
        );
      }
      if (!names.has("updated_at")) {
        await database.exec(
          "ALTER TABLE globals ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
        );
        await database.exec(
          "UPDATE globals SET updated_at = datetime('now') WHERE updated_at IS NULL",
        );
      }
      if (!names.has("display_key")) {
        await database.exec(
          "ALTER TABLE globals ADD COLUMN display_key TEXT NOT NULL DEFAULT ''",
        );
        await database.exec(
          "UPDATE globals SET display_key = key WHERE display_key IS NULL",
        );
      }
      await database.exec("SELECT crsql_as_crr('globals')");
    } catch (err) {
      console.error("[syncStore] Failed to ensure globals schema", err);
    }
  }

  /**
   * CR-SQLite's generated update trigger for a table, or `undefined` when the
   * table is not a CRR on this connection.
   */
  async function crrUpdateTriggerSql(database, table) {
    const rows = await database.execO(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
      [`${table}__crsql_utrig`],
    );
    return rows?.[0]?.sql;
  }

  /**
   * Adds the `pinned` document attribute to databases created before the Recent
   * Documents redesign.
   */
  async function ensureNotesSchema(database) {
    if (!database) throw new Error("Database scope is required for schema initialization.");
    try {
      const columns = await database.execO("PRAGMA table_info('notes')");
      if (!columns || columns.length === 0) return;

      const names = new Set(columns.map((column) => column.name));
      const triggerSql = await crrUpdateTriggerSql(database, "notes");
      const isCrr = Boolean(triggerSql);

      if (!names.has("pinned")) {
        if (isCrr) await database.exec("SELECT crsql_begin_alter('notes')");
        try {
          await database.exec(
            "ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
          );
          await database.exec(
            "UPDATE notes SET pinned = 0 WHERE pinned IS NULL",
          );
        } finally {
          if (isCrr) await database.exec("SELECT crsql_commit_alter('notes')");
        }
        return;
      }

      if (isCrr && !triggerSql.includes("pinned")) {
        await database.exec("SELECT crsql_begin_alter('notes')");
        await database.exec("SELECT crsql_commit_alter('notes')");
      }
    } catch (err) {
      console.error("[syncStore] Failed to ensure notes schema", err);
    }
  }

  /**
   * Adds `size_bytes` and `sha256` to databases created before those columns
   * existed.
   *
   * `images` is a CRR, and CR-SQLite generates its insert/update/delete
   * triggers from the column list at registration time. A bare `ALTER TABLE`
   * leaves triggers bound to the old column count, so the next write fails with
   * `expected N values, got M` — and re-running `crsql_as_crr` does not rebuild
   * them, it reports success and leaves the stale triggers in place.
   * `crsql_begin_alter` / `crsql_commit_alter` is the supported way to change a
   * CRR's shape.
   */
  async function ensureImagesSchema(database) {
    if (!database) throw new Error("Database scope is required for schema initialization.");
    try {
      const columns = await database.execO("PRAGMA table_info('images')");
      if (!columns || columns.length === 0) {
        return;
      }

      const names = new Set((columns || []).map((c) => c.name));
      const triggerSql = await crrUpdateTriggerSql(database, "images");
      const isCrr = Boolean(triggerSql);
      const missing = ["size_bytes", "sha256"].filter((c) => !names.has(c));

      if (missing.length > 0) {
        if (isCrr) await database.exec("SELECT crsql_begin_alter('images')");
        try {
          if (!names.has("size_bytes")) {
            await database.exec(
              "ALTER TABLE images ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0",
            );
            await database.exec(
              "UPDATE images SET size_bytes = 0 WHERE size_bytes IS NULL",
            );
          }

          if (!names.has("sha256")) {
            await database.exec(
              "ALTER TABLE images ADD COLUMN sha256 TEXT NOT NULL DEFAULT ''",
            );
            await database.exec(
              "UPDATE images SET sha256 = '' WHERE sha256 IS NULL",
            );
          }
        } finally {
          if (isCrr) await database.exec("SELECT crsql_commit_alter('images')");
        }

        if (!isCrr) await database.exec("SELECT crsql_as_crr('images')");
        return;
      }

      // Self-heal a database whose columns were added by the old bare-ALTER
      // migration, or by a run interrupted before the commit.
      if (isCrr && !["size_bytes", "sha256"].every((c) => triggerSql.includes(c))) {
        await database.exec("SELECT crsql_begin_alter('images')");
        await database.exec("SELECT crsql_commit_alter('images')");
        return;
      }

      if (!isCrr) await database.exec("SELECT crsql_as_crr('images')");
    } catch (err) {
      console.error("[syncStore] Failed to ensure images schema", err);
    }
  }

  async function ensureTemplatesSchema(database) {
    if (!database) throw new Error("Database scope is required for schema initialization.");
    try {
      const columns = await database.execO("PRAGMA table_info('templates')");
      const tableExists = columns && columns.length > 0;

      if (!tableExists) {
        await database.exec(`
          CREATE TABLE IF NOT EXISTS templates (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            title_pattern TEXT NOT NULL DEFAULT '',
            default_folder_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        await database.exec(
          "CREATE INDEX IF NOT EXISTS idx_templates_updated ON templates(updated_at DESC)",
        );
        await database.exec("SELECT crsql_as_crr('templates')");
        await seedDefaultTemplates(database);
        return;
      }

      // Add title_pattern column if missing (added in v1.1)
      const hasTitlePattern = columns.some((c) => c.name === "title_pattern");
      if (!hasTitlePattern) {
        await database.exec(
          "ALTER TABLE templates ADD COLUMN title_pattern TEXT NOT NULL DEFAULT ''",
        );
      }

      // Add default_folder_id column if missing (added in v1.1)
      const hasDefaultFolder = columns.some(
        (c) => c.name === "default_folder_id",
      );
      if (!hasDefaultFolder) {
        await database.exec(
          "ALTER TABLE templates ADD COLUMN default_folder_id TEXT",
        );
      }

      // Check if existing table has the old schema (NOT NULL columns without DEFAULTs)
      // CR-SQLite requires DEFAULTs on all NOT NULL columns
      const needsMigration = columns.some(
        (c) =>
          (c.name === "name" ||
            c.name === "created_at" ||
            c.name === "updated_at") &&
          c.notnull === 1 &&
          c.dflt_value === null,
      );

      if (needsMigration) {
        // Recreate table with proper DEFAULTs
        await database.exec(`
          ALTER TABLE templates RENAME TO templates_old;

          CREATE TABLE templates (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            title_pattern TEXT NOT NULL DEFAULT '',
            default_folder_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );

          INSERT INTO templates SELECT * FROM templates_old;
          CREATE INDEX IF NOT EXISTS idx_templates_updated ON templates(updated_at DESC);
          DROP TABLE templates_old;
        `);
      }

      const rows = await database.execO(
        "SELECT COUNT(*) AS cnt FROM templates",
      );
      if (rows[0]?.cnt === 0) {
        await seedDefaultTemplates(database);
      }

      await database.exec("SELECT crsql_as_crr('templates')");
    } catch (err) {
      console.error("[syncStore] Failed to ensure templates schema", err);
    }
  }

  async function seedDefaultTemplates(database) {
    const rows = await database.execO("SELECT COUNT(*) AS cnt FROM templates");
    if (rows[0]?.cnt > 0) return;

    const now = new Date().toISOString();
    const defaults = [
      {
        name: "Meeting Notes",
        titlePattern: "",
        defaultFolderId: null,
        content: `---
title: "{{input:Meeting Title}}"
date: "{{today}}"
attendees: "{{input:Attendees (comma-separated)}}"
tags:
  - "meeting"
  - "{{input:Project Tag}}"
---

# {{input:Meeting Title}}

**Date:** {{today}}
**Attendees:** {{input:Attendees (comma-separated)}}

## Agenda

1. {{input:Agenda Item 1}}
2. {{input:Agenda Item 2}}

## Notes

- {{input:Key discussion point}}

## Action Items

- [ ] {{input:Action item}} — Assigned to: {{input:Owner}}
`,
      },
      {
        name: "Project Brief",
        titlePattern: "",
        defaultFolderId: null,
        content: `---
title: "{{input:Project Name}} - Project Brief"
author: "{{input:Author}}"
date: "{{today}}"
status: "draft"
tags:
  - "project"
  - "{{input:Department}}"
---

# {{input:Project Name}}

**Objective:** {{input:Project Objective}}

## Scope

{{input:Describe the scope of the project}}

## Timeline

- Start: {{today}}
- Target: {{input:Target completion date}}

## Stakeholders

- {{input:Stakeholder name and role}}
`,
      },
      {
        name: "Journal Entry",
        titlePattern: "Journal Entry — {{today:dd-MM-yyyy}}",
        defaultFolderId: null,
        content: `---
title: "Journal Entry - {{today}}"
date: "{{today}}"
mood: "{{input:Mood}}"
tags:
  - "journal"
---

# Journal Entry — {{today}}

**Mood:** {{input:Mood}}

{{input:What happened today?}}
`,
      },
      {
        name: "Bug Report",
        titlePattern: "Bug Report: {{input:Bug Title}}",
        defaultFolderId: null,
        content: `---
title: "Bug: {{input:Bug Title}}"
date: "{{today}}"
severity: "{{input:Severity (low/medium/high/critical)}}"
tags:
  - "bug"
  - "{{input:Component}}"
---

# Bug Report: {{input:Bug Title}}

**Severity:** {{input:Severity (low/medium/high/critical)}}
**Component:** {{input:Component}}

## Steps to Reproduce

1. {{input:Step 1}}
2. {{input:Step 2}}
3. {{input:Step 3}}

## Expected Behavior

{{input:What should happen?}}

## Actual Behavior

{{input:What actually happens?}}

## Environment

- {{input:Browser/OS/Device details}}

## Additional Context

{{input:Any logs, screenshots, or notes}}
`,
      },
    ];

    for (const tpl of defaults) {
      await database.exec(
        "INSERT INTO templates (id, name, content, title_pattern, default_folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          uuidv4(),
          tpl.name,
          tpl.content,
          tpl.titlePattern || "",
          tpl.defaultFolderId || null,
          now,
          now,
        ],
      );
    }
  }

  function setupOnlineOfflineListeners() {
    const handleOnline = async () => {
      console.info("[Sync] Network connection restored");
      isOnline.value = true;

      const auth = useAuthStore();
      if (auth.isAuthenticated && syncEnabled.value) {
        // Reset auth warning flag when coming online
        hasShownAuthWarning.value = false;

        // Show toast
        const { useUiStore } = await import("./uiStore");
        const uiStore = useUiStore();
        uiStore.addToast("Back online! Syncing your documents...", "success", 3000);

        // Reconnect websocket and sync
        connectWebSocket();
        sync();
        // Spaces that could not be loaded or opened while offline are tried
        // again now; this used to need a click on Retry for each one.
        void requestMembershipRefresh().catch(reportMembershipRefreshFailure);
      } else if (auth.isAuthenticated && !syncEnabled.value) {
        // User is authenticated but sync was disabled while offline
        const { useUiStore } = await import("./uiStore");
        const uiStore = useUiStore();
        uiStore.addToast(
          "Back online! Enable sync to sync your documents.",
          "info",
          5000,
        );
      }
    };

    const handleOffline = async () => {
      console.info("[Sync] Network connection lost");
      isOnline.value = false;

      const { useUiStore } = await import("./uiStore");
      const uiStore = useUiStore();
      uiStore.addToast(
        "You're offline. Changes will sync when you reconnect.",
        "warning",
        5000,
      );

      // Disconnect websocket when offline (but don't disable sync)
      // This way sync state is preserved for when we come back online
      disconnectWebSocket();
    };

    // Remove existing listeners if any
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);

    // Add new listeners
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
  }

  async function resetDatabase() {
    disconnectWebSocket();
    shouldReconnect = false;
    hasShownAuthWarning.value = false;
    for (const entry of databases.value.values()) {
      try {
        await entry.db?.close();
      } catch {
        // The handle is being discarded whether already closed or mid-teardown.
      }
    }
    databases.value.clear();
    isInitialized.value = false;
    membershipVersion.value = 0;
    membershipRefreshRequested = false;
    sharedSpacesAvailable.value = false;
    bootstrapState.value = { status: "idle", currentDbKey: null, completed: 0, total: 0, error: null };
  }

  function hexToUint8Array(hex) {
    if (!hex || hex.length % 2 !== 0) return new Uint8Array();
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  async function applyRemoteRows(database, remoteChanges) {
    const insertSQL = `INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id, seq, cl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    for (const ch of remoteChanges) {
      await database.exec(insertSQL, [
        ch.table,
        hexToUint8Array(ch.pk),
        ch.cid,
        ch.val,
        ch.col_version,
        ch.db_version,
        hexToUint8Array(ch.site_id),
        ch.seq,
        ch.cl,
      ]);
    }
  }

  async function upsertMergeBase(database, noteId, content) {
    await database.exec(
      `INSERT INTO note_sync_base (note_id, content, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      [noteId, content ?? "", new Date().toISOString()],
    );
  }

  /**
   * The document is in step with the server again, so it needs no merge base:
   * one is kept only while an edit is waiting to be acknowledged. A row still
   * inside its automatic write-back window is updated instead of removed, so
   * the oscillation guard it carries survives.
   */
  async function settleMergeBase(database, noteId, serverContent) {
    const now = Date.now();
    await database.exec(
      `DELETE FROM note_sync_base
        WHERE note_id = ?
          AND (writeback_window_started_at IS NULL OR writeback_window_started_at < ?)`,
      [noteId, new Date(now - WRITEBACK_WINDOW_MS).toISOString()],
    );
    await database.exec(
      "UPDATE note_sync_base SET content = ?, updated_at = ? WHERE note_id = ?",
      [serverContent ?? "", new Date(now).toISOString(), noteId],
    );
  }

  /**
   * Record the body the server holds for a document, just before the first
   * local edit that makes it differ. Call inside the transaction that writes
   * the new body, before the write.
   *
   * Nothing is recorded when the stored body is not known to be the server's:
   * the document already has an edit waiting to be uploaded, or this replica
   * has not yet completed a sync with the upload cursor. A later concurrent
   * edit then becomes a conflict that keeps both bodies, rather than a merge
   * from the wrong ancestor.
   *
   * @param {string} dbKey
   * @param {{ execute: Function, exec: Function }} tx the transaction's repository
   * @param {string} noteId
   */
  async function captureMergeBase(dbKey, tx, noteId) {
    const stored = getPushCursor(dbKey);
    if (stored === null) return;

    const versionRows = await tx.execute(LOCAL_DB_VERSION_SQL);
    const cursor = parsePushCursor(stored, Number(versionRows?.[0]?.version) || 0);
    const uploadedVersion = cursor.seq === null ? cursor.version : cursor.version - 1;
    const pending = await tx.execute(
      `SELECT 1 AS pending FROM crsql_changes
        WHERE "table" = 'notes' AND cid = 'content' AND site_id = crsql_site_id()
          AND db_version > ? AND pk = crsql_pack_columns(?)
        LIMIT 1`,
      [uploadedVersion, noteId],
    );
    if (pending?.length) return;

    await tx.exec(
      `INSERT OR IGNORE INTO note_sync_base (note_id, content, updated_at)
       SELECT id, COALESCE(content, ''), ? FROM notes WHERE id = ?`,
      [new Date().toISOString(), noteId],
    );
  }

  async function recordConflict(database, noteId, base, mine, theirs, conflicts) {
    const now = new Date().toISOString();
    await database.exec(
      `INSERT INTO note_conflicts
         (note_id, base_content, mine_content, theirs_content, conflict_hunks, created_at, updated_at, merge_attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(note_id) DO UPDATE SET
         base_content = excluded.base_content,
         mine_content = excluded.mine_content,
         theirs_content = excluded.theirs_content,
         conflict_hunks = excluded.conflict_hunks,
         updated_at = excluded.updated_at,
         merge_attempts = note_conflicts.merge_attempts + 1`,
      [noteId, base ?? "", mine ?? "", theirs ?? "", serializeConflictHunks(conflicts), now, now],
    );
  }

  /** Conflict regions between two bodies, as stored with a conflict record. */
  function conflictHunksFor(base, mine, theirs) {
    if (base === undefined) {
      // No common ancestor: the whole Document is one region.
      return [{
        baseLines: [],
        mineLines: normalizeContent(mine).split("\n"),
        theirsLines: normalizeContent(theirs).split("\n"),
      }];
    }
    const merge = mergeContent({ base, mine, theirs });
    return merge.status === "conflict" ? merge.conflicts : [];
  }

  async function clearConflict(database, noteId) {
    await database.exec("DELETE FROM note_conflicts WHERE note_id = ?", [noteId]);
  }

  /** Body changes of `notes` in a change list, keyed by document id. */
  function collectContentChanges(changes) {
    const byNote = new Map();
    for (const ch of changes || []) {
      if (ch.table !== "notes" || ch.cid !== "content") continue;
      const noteId = parsePkId(ch.pk);
      if (!noteId) continue;
      byNote.set(noteId, {
        content: ch.val == null ? "" : String(ch.val),
        colVersion: Number(ch.col_version) || 0,
        dbVersion: Number(ch.db_version) || 0,
      });
    }
    return byNote;
  }

  /** Documents whose body this replica changed after the given local version. */
  async function ownContentChangedAfter(database, localVersion) {
    const rows = await database.execO(
      `SELECT pk FROM crsql_changes WHERE "table" = 'notes' AND cid = 'content' AND site_id = crsql_site_id() AND db_version > ?`,
      [localVersion],
    );
    const ids = new Set();
    for (const row of rows || []) {
      const noteId = parsePkId(row.pk);
      if (noteId) ids.add(noteId);
    }
    return ids;
  }

  /**
   * Keep a stored conflict in step when the Document's stored text changes.
   * The record holds the only copy of a body the user has not decided about,
   * so it is never simply replaced: the side that was the Document follows it
   * to the new text, and the record is dropped only once the new text already
   * contains the held body ({@link planConflictAfterChange}).
   *
   * @param {{ execO: Function, exec: Function }} database a connection, inside the writing transaction
   * @param {string} noteId
   * @param {string} previousContent the stored text before the change
   * @param {string} nextContent the stored text after it
   */
  async function followConflict(database, noteId, previousContent, nextContent) {
    const rows = await database.execO(
      "SELECT base_content, mine_content, theirs_content FROM note_conflicts WHERE note_id = ?",
      [noteId],
    );
    if (!rows?.length) return;

    const held = rows[0];
    const plan = planConflictAfterChange({
      base: held.base_content,
      mine: held.mine_content,
      theirs: held.theirs_content,
      previous: previousContent,
      next: nextContent,
    });
    if (plan.action === "clear") {
      await clearConflict(database, noteId);
    } else if (plan.action === "update") {
      await recordConflict(database, noteId, held.base_content, plan.mine, plan.theirs, plan.conflicts);
    }
  }

  /**
   * A local write of a Document's body: call inside the transaction, before the
   * write, so a stored conflict for the Document follows the new text.
   *
   * @param {string} dbKey
   * @param {{ execute: Function, exec: Function }} tx the transaction's repository
   * @param {string} noteId
   * @param {string} nextContent
   */
  async function followLocalBodyWrite(dbKey, tx, noteId, nextContent) {
    const database = { execO: (sql, params) => tx.execute(sql, params), exec: (sql, params) => tx.exec(sql, params) };
    const recorded = await database.execO("SELECT 1 AS held FROM note_conflicts WHERE note_id = ?", [noteId]);
    if (!recorded?.length) return;
    const stored = await database.execO("SELECT COALESCE(content, '') AS content FROM notes WHERE id = ?", [noteId]);
    if (!stored?.length) return;
    await followConflict(database, noteId, stored[0].content, nextContent ?? "");
  }

  /**
   * Text the editor holds unsaved while its Document has a stored conflict is
   * this device's side of that conflict. Store it as such, so resolving
   * compares against what was actually typed.
   *
   * @param {string} dbKey
   * @param {string} noteId
   * @param {string} text
   * @returns {Promise<boolean>} true when the record changed
   */
  async function holdUnsavedText(dbKey, noteId, text) {
    return repository(dbKey).transaction(async (tx) => {
      const rows = await tx.execute(
        "SELECT base_content, mine_content, theirs_content FROM note_conflicts WHERE note_id = ?",
        [noteId],
      );
      if (!rows?.length) return false;
      const held = rows[0];
      const unsaved = normalizeContent(text);
      if (unsaved === normalizeContent(held.mine_content) || unsaved === normalizeContent(held.theirs_content)) {
        return false;
      }
      const merge = mergeContent({ base: held.base_content, mine: unsaved, theirs: held.theirs_content });
      await recordConflict(
        { exec: (sql, params) => tx.exec(sql, params) },
        noteId,
        held.base_content,
        unsaved,
        held.theirs_content,
        merge.status === "conflict" ? merge.conflicts : [],
      );
      return true;
    });
  }

  /**
   * Applies remote CR-SQLite changes inside one transaction and decides, per
   * document, between adopting the remote body, keeping or merging the local
   * one, and recording a conflict (COLLAB-02 §5.3).
   *
   * `upload` describes the request these changes answer: the bodies this
   * replica sent in it, how far its uploads now reach, and the local version
   * above which a sent change is known to be new rather than re-offered.
   *
   * @returns {Promise<boolean>} true when a local content write needs a follow-up sync
   */
  function applyRemoteChanges(entry, remoteChanges, upload = {}) {
    // Queued behind any open editor or store transaction on this database.
    return runExclusive(entry.dbKey, () => applyRemoteChangesExclusive(entry, remoteChanges, upload));
  }

  async function applyRemoteChangesExclusive(entry, remoteChanges, upload = {}) {
    const { sentContent = new Map(), uploadedUpTo = 0, pendingAfter = 0 } = upload;
    let didLocalWrite = false;
    const database = entry.db;

    const remoteContent = collectContentChanges(remoteChanges);
    const idList = [...remoteContent.keys()];

    entry.isApplyingRemote = true;
    try {
      if (idList.length === 0) {
        await database.exec("BEGIN");
        try {
          await applyRemoteRows(database, remoteChanges);
          await database.exec("COMMIT");
        } catch (e) {
          await database.exec("ROLLBACK");
          throw e;
        }
        return didLocalWrite;
      }

      const placeholders = idList.map(() => "?").join(",");
      const readBodies = async () => {
        const rows = await database.execO(
          `SELECT id, COALESCE(content, '') AS content FROM notes WHERE id IN (${placeholders})`,
          idList,
        );
        return new Map((rows || []).map((row) => [row.id, row.content]));
      };

      await database.exec("BEGIN");
      try {
        const mineMap = await readBodies();
        const changedSinceUpload = await ownContentChangedAfter(database, uploadedUpTo);

        await applyRemoteRows(database, remoteChanges);

        const postMap = await readBodies();
        const draftStore = useDraftStore();

        for (const noteId of idList) {
          const remote = remoteContent.get(noteId);
          const postApply = postMap.get(noteId) ?? "";
          if (collabRemoteGuard?.(entry.dbKey, noteId, postApply)) {
            await settleMergeBase(database, noteId, postApply);
            continue;
          }

          const dbMine = mineMap.get(noteId) ?? "";
          // The draft store keeps the last editor text of every document opened
          // in this tab, so a draft that merely differs from the stored body is
          // usually just old: the document was adopted from another device
          // after it was closed. It is unsaved text only while it differs from
          // what the editor itself last saved or adopted.
          const draft = draftStore.getDraft(noteId);
          const editorBase = draftStore.getBase(noteId);
          const unsavedDraft = draft !== undefined && editorBase !== undefined
            && normalizeContent(draft) !== normalizeContent(editorBase);
          const mine = unsavedDraft ? draft : dbMine;
          const sent = sentContent.get(noteId) || null;
          const changedSinceSend = changedSinceUpload.has(noteId);
          const localPending = Boolean(sent && sent.dbVersion > pendingAfter) || changedSinceSend || unsavedDraft;

          const baseRows = await database.execO(
            "SELECT content, writeback_count, writeback_window_started_at FROM note_sync_base WHERE note_id = ?",
            [noteId],
          );
          const hasBase = baseRows.length > 0;
          const base = hasBase ? baseRows[0].content : undefined;

          const decision = planRemoteContent({
            hasBase,
            base,
            hasLocalRow: mineMap.has(noteId) || unsavedDraft,
            mine,
            remote: remote.content,
            postApply,
            localPending,
            serverValue: resolveServerValue({
              remote: remote.content,
              remoteColVersion: remote.colVersion,
              sent,
              postApply,
              localChangedSinceSend: changedSinceSend,
            }),
            capabilityEnabled: contentMergeWriteback.value,
          });

          const now = new Date().toISOString();
          const storeBase = async () => {
            if (decision.base !== undefined) await upsertMergeBase(database, noteId, decision.base);
          };
          const holdBothSides = async () => {
            // One recorded side is always the Document's stored text. After a
            // local win that is the stored body itself; text the editor still
            // holds unsaved reaches the record through its own save.
            const documentHoldsRemote = normalizeContent(postApply) === normalizeContent(remote.content);
            const recordedMine = documentHoldsRemote ? mine : postApply;
            const conflicts = recordedMine === mine
              ? decision.conflicts
              : conflictHunksFor(base, recordedMine, remote.content);
            await recordConflict(database, noteId, base, recordedMine, remote.content, conflicts);
            await storeBase();
          };

          if (decision.action === "write-merge") {
            const guard = evaluateWritebackGuard({
              writebackCount: hasBase ? baseRows[0].writeback_count : 0,
              windowStartedAt: hasBase ? baseRows[0].writeback_window_started_at : null,
            });

            if (!guard.allowed) {
              console.info("[Sync] Suppressing a merge write-back (oscillation guard).");
              await holdBothSides();
              continue;
            }

            await database.exec(
              "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
              [decision.content, now, noteId],
            );
            await database.exec(
              `INSERT INTO note_sync_base (note_id, content, writeback_count, writeback_window_started_at, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(note_id) DO UPDATE SET
                 content = excluded.content,
                 writeback_count = excluded.writeback_count,
                 writeback_window_started_at = excluded.writeback_window_started_at,
                 updated_at = excluded.updated_at`,
              [noteId, decision.base ?? base ?? "", guard.writebackCount, guard.windowStartedAt, now],
            );
            await followConflict(database, noteId, dbMine, decision.content);
            didLocalWrite = true;
          } else if (decision.action === "write") {
            await database.exec(
              "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
              [decision.content, now, noteId],
            );
            await storeBase();
            await followConflict(database, noteId, dbMine, decision.content);
            didLocalWrite = true;
          } else if (decision.action === "adopt") {
            // Local and server hold the remote body; nothing is pending.
            await settleMergeBase(database, noteId, decision.base ?? postApply);
            await followConflict(database, noteId, dbMine, postApply);
          } else if (decision.action === "keep") {
            await storeBase();
            await followConflict(database, noteId, dbMine, postApply);
          } else {
            await holdBothSides();
          }
        }

        await database.exec("COMMIT");
      } catch (e) {
        await database.exec("ROLLBACK");
        throw e;
      }
    } finally {
      entry.isApplyingRemote = false;
    }

    return didLocalWrite;
  }

  /**
   * Once the server acknowledges an upload and returns no competing body for a
   * document, it holds exactly what was sent. If nothing newer is waiting
   * locally the document is in step again and its merge base is dropped;
   * otherwise what was sent becomes the base for the edit still waiting.
   */
  async function settleAcknowledgedUploads(dbKey, database, sentContent, remoteNoteIds, uploadedVersion) {
    const acknowledged = [...sentContent].filter(([noteId]) => !remoteNoteIds.has(noteId));
    if (acknowledged.length === 0) return;

    await runExclusive(dbKey, async () => {
      const stillPending = await ownContentChangedAfter(database, uploadedVersion);
      await database.exec("BEGIN");
      try {
        for (const [noteId, sent] of acknowledged) {
          if (stillPending.has(noteId)) await upsertMergeBase(database, noteId, sent.content);
          else await settleMergeBase(database, noteId, sent.content);
        }
        await database.exec("COMMIT");
      } catch (e) {
        await database.exec("ROLLBACK");
        throw e;
      }
    });
  }

  async function fetchMembershipPages() {
    const auth = useAuthStore();
    const spaces = [];
    let cursor = null;
    let version = null;
    let minimumSchema = 0;
    let pendingDeletion = [];
    let liveSessions = false;
    do {
      const suffix = cursor ? `?limit=25&cursor=${encodeURIComponent(cursor)}` : "?limit=25";
      const response = await fetch(`${API_URL}/spaces${suffix}`, {
        headers: { Authorization: `Bearer ${auth.token || ""}` },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Space discovery failed: ${response.status}`);
      const page = await response.json();
      spaces.push(...(Array.isArray(page.spaces) ? page.spaces : []));
      const pageVersion = Number(page.membershipVersion) || 0;
      if (version === null) version = pageVersion;
      else if (pageVersion !== version) {
        throw new Error("Space membership changed during paginated discovery.");
      }
      minimumSchema = Math.max(minimumSchema, Number(page.minimum_client_schema) || 0);
      if (Array.isArray(page.pendingDeletion)) pendingDeletion = page.pendingDeletion;
      liveSessions = liveSessions || page.capabilities?.liveSessions === true;
      cursor = page.nextCursor || null;
    } while (cursor);
    return { spaces, membershipVersion: version ?? 0, minimumSchema, pendingDeletion, liveSessions };
  }

  async function removeDatabase(dbKey, { notifyServer = true } = {}) {
    const entry = databases.value.get(dbKey);
    if (!entry || dbKey === personalDbKey.value) return;
    entry.syncPending = false;
    entry.isSyncing = false;
    const { useStructureStore } = await import("./structureStore");
    const { useDraftStore } = await import("./draftStore");
    const { useHistoryStore } = await import("./historyStore");
    const { useConflictStore } = await import("./conflictStore");
    const affectedNoteIds = useStructureStore().clearDatabaseScope(dbKey);
    const drafts = useDraftStore();
    const history = useHistoryStore();
    for (const noteId of affectedNoteIds) {
      drafts.clearDraft(noteId);
      drafts.clearBase(noteId);
      history.clear(noteId);
    }
    useConflictStore().clearDatabase(dbKey);
    if (notifyServer && ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({
        v: 1,
        type: "unsubscribe",
        requestId: uuidv4(),
        payload: { dbKeys: [dbKey] },
      }));
    }
    try {
      await entry.db?.close();
    } catch {
      // Revocation removes the handle from the active registry even if close races.
    }
    databases.value.delete(dbKey);
    // Closing alone left the whole replica on disk: every Document, a second
    // copy of each body, and edits that were never uploaded. Those came back,
    // and were uploaded, if the member was invited again.
    await wipeLocalSpace(dbKey);
  }

  async function bootstrapSpaces(spaces) {
    const pending = (spaces || []).filter((space) => {
      const dbKey = createDatabaseKey("space", space.spaceId);
      return !databases.value.get(dbKey)?.db;
    });
    bootstrapState.value = {
      status: pending.length ? "loading" : "ready",
      currentDbKey: null,
      completed: 0,
      total: pending.length,
      error: null,
    };

    for (const space of pending) {
      const dbKey = createDatabaseKey("space", space.spaceId);
      bootstrapState.value.currentDbKey = dbKey;
      try {
        if (navigator.storage?.estimate) await navigator.storage.estimate();
        const entry = await openDatabaseEntry({
          dbKey,
          name: space.name,
          role: space.role,
          members: space.members || [],
        });
        try {
          await syncDatabase(entry);
        } catch (error) {
          // A space this device has synced before is already here. Without a
          // connection it opens with what it has, like the personal library;
          // only a space that has never been downloaded has nothing to show.
          const heldLocally = getClock(dbKey) > 0 && !isStorageQuotaError(error) && error?.code !== "SESSION_EXPIRED";
          if (!heldLocally) throw error;
          entry.status = "sync-error";
          entry.error = "Sync failed. Local changes are safe and will retry.";
        }
        subscribeInitializedDatabases();
      } catch (error) {
        // Without this the only trace of a failed space was a generic message
        // in the tree.
        console.warn(`[syncStore] Could not open ${dbKey}:`, error?.message || error);
        const existing = databases.value.get(dbKey);
        if (existing?.db) {
          try { await existing.db.close(); } catch { /* discard below */ }
        }
        databases.value.set(dbKey, {
          dbKey,
          kind: "space",
          db: null,
          siteId: null,
          clock: getClock(dbKey),
          name: space.name,
          role: space.role,
          members: space.members || [],
          syncPending: false,
          status: isStorageQuotaError(error) ? "quota-error" : "bootstrap-error",
          error: isStorageQuotaError(error)
            ? "This space could not be stored on this device. Free storage and retry."
            : "This space could not be initialized. Retry when the connection is stable.",
        });
      } finally {
        bootstrapState.value.completed++;
      }
    }
    const failed = [...databases.value.values()].find(
      (entry) => entry.kind === "space" && !entry.db,
    );
    bootstrapState.value = failed
      ? {
          ...bootstrapState.value,
          status: failed.status === "quota-error" ? "quota-error" : "error",
          currentDbKey: failed.dbKey,
          error: failed.error,
        }
      : { ...bootstrapState.value, status: "ready", currentDbKey: null, error: null };
  }

  function reportMembershipRefreshFailure(error) {
    console.warn("[syncStore] Shared-space discovery failed", error);
    bootstrapState.value = {
      ...bootstrapState.value,
      status: "error",
      currentDbKey: null,
      error: "Shared spaces could not be loaded. Personal Documents remain available.",
    };
  }

  async function refreshMembership({ bootstrap = false } = {}) {
    if (!isInitialized.value || !personalDbKey.value) return;
    if (membershipRefreshPromise) return membershipRefreshPromise;
    membershipRefreshPromise = (async () => {
      let snapshot;
      try {
        snapshot = await fetchMembershipPages();
      } catch (error) {
        // No answer from the server. On a cold start nothing is open yet, so
        // open the spaces this device was last told about and already holds;
        // otherwise they were simply absent until the next successful load.
        const cached = readCachedMembership();
        const anyOpen = [...databases.value.values()].some((entry) => entry.kind === "space");
        if (!cached?.spaces.length || anyOpen) throw error;
        sharedSpacesAvailable.value = true;
        await bootstrapSpaces(cached.spaces);
        if (!bootstrap) await useDocStore().refreshData();
        return;
      }
      if (!snapshot) {
        sharedSpacesAvailable.value = false;
        liveSessionsAvailable.value = false;
        pendingSpaceDeletions.value = [];
        writeCachedMembership(null);
        return;
      }
      writeCachedMembership(snapshot.spaces);
      sharedSpacesAvailable.value = true;
      liveSessionsAvailable.value = snapshot.liveSessions;
      pendingSpaceDeletions.value = snapshot.pendingDeletion;
      if (snapshot.minimumSchema > 1) {
        bootstrapState.value = {
          status: "upgrade-required",
          currentDbKey: null,
          completed: 0,
          total: snapshot.spaces.length,
          error: "Update Panino before opening shared spaces.",
        };
        return;
      }

      const { revoked } = reconcileMembershipKeys(
        databases.value.keys(),
        personalDbKey.value,
        snapshot.spaces,
      );
      for (const dbKey of revoked) await removeDatabase(dbKey);
      for (const space of snapshot.spaces) {
        const entry = databases.value.get(createDatabaseKey("space", space.spaceId));
        if (entry) Object.assign(entry, {
          name: space.name,
          role: space.role,
          members: space.members || [],
        });
      }
      membershipVersion.value = snapshot.membershipVersion;
      await bootstrapSpaces(snapshot.spaces);
      if (!bootstrap) await useDocStore().refreshData();
    })().finally(() => {
      membershipRefreshPromise = null;
      if (membershipRefreshRequested) {
        membershipRefreshRequested = false;
        queueMicrotask(() => {
          void refreshMembership().catch(reportMembershipRefreshFailure);
        });
      }
    });
    return membershipRefreshPromise;
  }

  async function requestMembershipRefresh() {
    if (membershipRefreshPromise) {
      membershipRefreshRequested = true;
      return;
    }
    await refreshMembership();
  }

  async function retryBootstrap(dbKey) {
    parseDatabaseKey(dbKey);
    const failed = databases.value.get(dbKey);
    if (!failed || failed.kind !== "space") return;
    if (failed.db) {
      failed.status = "ready";
      failed.error = null;
      await sync(dbKey);
      await useDocStore().refreshData();
      return;
    }
    databases.value.delete(dbKey);
    await bootstrapSpaces([{
      spaceId: parseDatabaseKey(dbKey).id,
      name: failed.name,
      role: failed.role,
      members: failed.members,
    }]);
    await useDocStore().refreshData();
  }

  /**
   * The session can no longer be refreshed. Say so once, and stop syncing and
   * reconnecting until the user signs in again; retrying cannot succeed.
   */
  async function handleSessionExpired() {
    if (!hasShownAuthWarning.value) {
      hasShownAuthWarning.value = true;
      const { useUiStore } = await import("./uiStore");
      useUiStore().addToast(
        "Your session has expired. Please log in again to sync.",
        "warning",
      );
    }
    syncEnabled.value = false;
    disconnectWebSocket();
  }

  async function syncDatabase(entry, { allowAuthRetry = true } = {}) {
    const auth = useAuthStore();
    if (!entry?.db) return false;
    if (entry.isSyncing) {
      entry.syncPending = true;
      return false;
    }
    entry.isSyncing = true;
    entry.lastSyncChangedData = false;
    const myClock = entry.clock;
    try {
      const storedCursor = getPushCursor(entry.dbKey);
      const outgoing = await readOutgoingChanges(entry.db, storedCursor);
      const target = parseDatabaseKey(entry.dbKey);
      const outgoingChanges = target.kind === "space"
        ? projectSpaceOutgoingChanges(outgoing.changes)
        : outgoing.changes;
      const sentContent = collectContentChanges(outgoingChanges);
      // Before the upload cursor existed, only changes above the pull clock
      // were known to be unsent; the first sync re-offers older ones too, and
      // those must not be mistaken for fresh local edits.
      const pendingAfter = storedCursor === null ? myClock : outgoing.startVersion;
      const body = {
        since: myClock,
        siteId: entry.siteId,
        changes: outgoingChanges,
      };
      if (target.kind === "space") body.space = target.id;

      const response = await fetch(`${API_URL}/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token || ""}`,
        },
        body: JSON.stringify(body),
      });
      if ((response.status === 401 || response.status === 403) && allowAuthRetry) {
        if (await auth.refreshToken()) {
          entry.isSyncing = false;
          return syncDatabase(entry, { allowAuthRetry: false });
        }
      }
      if (response.status === 401 || response.status === 403) {
        await handleSessionExpired();
        const error = new Error("Session expired");
        error.status = response.status;
        error.code = "SESSION_EXPIRED";
        throw error;
      }
      if (response.status === 404 && target.kind === "space") {
        await requestMembershipRefresh();
      }
      if (!response.ok) {
        const error = new Error(`Sync failed for ${entry.dbKey}: ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const data = await response.json();

      // The server has merged this batch: the upload cursor moves past it,
      // whatever happens while the reply is applied. A backlog continues next turn.
      setPushCursor(entry.dbKey, outgoing.nextCursor);
      if (outgoing.hasMore) entry.syncPending = true;

      contentMergeWriteback.value = data.contentMergeWriteback === true;
      const remoteNoteIds = new Set(collectContentChanges(data.changes).keys());
      // Whether anything visible changed, so the caller can skip reloading the
      // tree, dashboard and variables after an exchange that changed nothing.
      entry.lastSyncChangedData = Boolean(data.changes?.length);
      if (data.changes?.length) {
        const didLocalWrite = await applyRemoteChanges(entry, data.changes, {
          sentContent,
          uploadedUpTo: outgoing.uploadedVersion,
          pendingAfter,
        });
        if (didLocalWrite) entry.syncPending = true;
      }
      await settleAcknowledgedUploads(entry.dbKey, entry.db, sentContent, remoteNoteIds, outgoing.uploadedVersion);

      // The clock is persisted only after every remote row and merge base has
      // committed successfully.
      if (
        target.kind === "space" &&
        Number(data.membershipVersion) !== membershipVersion.value
      ) {
        await requestMembershipRefresh();
      }
      setClock(entry.dbKey, data.clock ?? myClock);
      entry.status = "ready";
      entry.error = null;
      return true;
    } finally {
      entry.isSyncing = false;
    }
  }

  /**
   * Make sure the server holds everything this replica has written to one
   * database, or say why not.
   *
   * For actions the server performs on its own copy, such as moving a Document
   * to another database: whatever is still only on this device would be left
   * out of the copy and then deleted with the source.
   *
   * @param {string} dbKey
   * @returns {Promise<{ ok: true } | { ok: false, reason: 'sync-disabled' | 'offline' | 'sync-failed' | 'still-uploading' }>}
   */
  async function ensureUploaded(dbKey) {
    const entry = requireEntry(dbKey);
    if (!syncEnabled.value) return { ok: false, reason: "sync-disabled" };
    if (!isOnline.value) return { ok: false, reason: "offline" };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      for (let waited = 0; waited < 200 && isSyncing.value; waited += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await sync(dbKey);
      if (entry.status === "sync-error" || entry.status === "quota-error") {
        return { ok: false, reason: "sync-failed" };
      }
      const outgoing = await readOutgoingChanges(entry.db, getPushCursor(dbKey));
      if (outgoing.changes.length === 0 && !outgoing.hasMore) return { ok: true };
    }
    return { ok: false, reason: "still-uploading" };
  }

  async function sync(dbKey = null) {
    const auth = useAuthStore();
    if (!syncEnabled.value || !isInitialized.value || !auth.isAuthenticated) return;
    if (isSyncing.value) {
      const requested = dbKey ? databases.value.get(dbKey) : null;
      if (requested) requested.syncPending = true;
      else for (const entry of databases.value.values()) entry.syncPending = true;
      return;
    }

    if (!isOnline.value) {
      console.info("[Sync] Skipping sync - offline");
      return;
    }

    isSyncing.value = true;
    try {
      const entries = dbKey
        ? [requireEntry(dbKey)]
        : [...databases.value.values()].filter((entry) => entry.db);
      const before = entries.map((entry) => ({ status: entry.status, error: entry.error }));
      await runSequentially(entries, async (entry) => {
        try {
          return await syncDatabase(entry);
        } catch (error) {
          if (error?.code === "SESSION_EXPIRED") {
            entry.status = "sync-error";
            entry.error = "Your session has expired. Log in again to sync; local changes are safe.";
            return false;
          }
          entry.status = isStorageQuotaError(error) ? "quota-error" : "sync-error";
          entry.error = isStorageQuotaError(error)
            ? "This database ran out of local storage. Free storage and retry."
            : "Sync failed. Local changes are safe and will retry.";
          console.error(`[syncStore] sync error for ${entry.dbKey}`, error);
          return false;
        }
      });
      // Reloading the tree, the dashboard and the variables walks the library,
      // and most syncs (every save uploads) change nothing here. Reload only
      // when remote rows arrived or a database's sync state changed.
      const dataChanged = entries.some((entry) => entry.lastSyncChangedData);
      const stateChanged = entries.some(
        (entry, index) => entry.status !== before[index].status || entry.error !== before[index].error,
      );
      if (dataChanged || stateChanged) {
        const docStore = useDocStore();
        await docStore.refreshData();
        if (dataChanged) {
          await useGlobalVariablesStore().loadGlobals(
            docStore.selectedDbKey || personalDbKey.value,
          );
        }
      }
    } finally {
      isSyncing.value = false;
      if ([...databases.value.values()].some((entry) => entry.syncPending)) {
        for (const entry of databases.value.values()) entry.syncPending = false;
        queueMicrotask(() => void sync());
      }
    }
  }

  function subscribeInitializedDatabases() {
    if (ws.value?.readyState !== WebSocket.OPEN) return;
    const subscriptions = [...databases.value.values()]
      .filter((entry) => entry.db && entry.siteId)
      .map(({ dbKey, siteId }) => ({ dbKey, siteId }));
    if (!subscriptions.length) return;
    ws.value.send(JSON.stringify({
      v: 1,
      type: "subscribe",
      requestId: uuidv4(),
      payload: { databases: subscriptions },
    }));
  }

  function scheduleReconnect(delayMs) {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, delayMs);
  }

  /**
   * Decide whether and when to reconnect. The server closes with 1008 and a
   * reason (see backend websocket.js) when it refuses the connection outright;
   * retrying those every second can never succeed.
   */
  async function handleSocketClosed(event) {
    const refused = event?.code === 1008 ? String(event.reason || "") : "";

    if (/token/i.test(refused)) {
      if (await useAuthStore().refreshToken()) {
        scheduleReconnect(reconnectDelayMs(reconnectAttempts));
        reconnectAttempts += 1;
        return;
      }
      await handleSessionExpired();
      return;
    }

    if (/too many connections/i.test(refused)) {
      if (!hasShownConnectionLimitNotice) {
        hasShownConnectionLimitNotice = true;
        const { useUiStore } = await import("./uiStore");
        useUiStore().addToast(
          "Live updates are paused in this tab because too many Panino tabs or devices are connected. Your changes still sync.",
          "info",
          8000,
        );
      }
      scheduleReconnect(CONNECTION_LIMIT_RETRY_MS);
      return;
    }

    scheduleReconnect(reconnectDelayMs(reconnectAttempts));
    reconnectAttempts += 1;
  }

  function connectWebSocket() {
    if (ws.value || !syncEnabled.value) return;
    const auth = useAuthStore();
    const personalEntry = databases.value.get(personalDbKey.value);
    if (!auth.token || !personalEntry?.siteId) return;

    shouldReconnect = true;
    console.info("[Sync] Connecting WebSocket...");
    ws.value = new WebSocket(`${WS_URL}?token=${auth.token}&siteId=${personalEntry.siteId}`);

    ws.value.onopen = () => {
      console.info("[Sync] WebSocket connected.");
      subscribeInitializedDatabases();
      notifyWebSocketListeners({ type: "socket:open" });
      // A refused connection also opens, then closes within milliseconds.
      // Only one that stays up counts as recovered.
      clearTimeout(stableConnectionTimer);
      stableConnectionTimer = setTimeout(() => {
        reconnectAttempts = 0;
      }, STABLE_CONNECTION_MS);
    };
    ws.value.onclose = (event) => {
      ws.value = null;
      clearTimeout(stableConnectionTimer);
      console.info("[Sync] WebSocket disconnected.");
      notifyWebSocketListeners({ type: "socket:close" });
      if (shouldReconnect && isOnline.value && syncEnabled.value) {
        void handleSocketClosed(event);
      }
    };
    ws.value.onerror = (err) => console.error("[Sync] WebSocket error:", err);
    ws.value.onmessage = async (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      notifyWebSocketListeners(msg);
      if (msg.type === "subscribe" && msg.ok === true) subscribeRetries = 0;
      if (msg.type === "sync") {
        const target = msg.payload?.dbKey || personalDbKey.value;
        if (databases.value.has(target)) void sync(target);
      } else if (msg.type === "subscription:revoked" && msg.payload?.dbKey) {
        await removeDatabase(msg.payload.dbKey, { notifyServer: false });
        await requestMembershipRefresh();
      } else if (
        msg.type === "membership:changed" &&
        Number.isFinite(Number(msg.payload?.membershipVersion)) &&
        Number(msg.payload.membershipVersion) !== membershipVersion.value
      ) {
        try {
          await requestMembershipRefresh();
        } catch (error) {
          reportMembershipRefreshFailure(error);
        }
      } else if (
        msg.ok === true &&
        msg.type === "subscribe" &&
        Number.isFinite(Number(msg.payload?.membershipVersion)) &&
        Number(msg.payload.membershipVersion) !== membershipVersion.value
      ) {
        try {
          await requestMembershipRefresh();
        } catch (error) {
          reportMembershipRefreshFailure(error);
        }
      } else if (
        msg.ok === false &&
        msg.type === "subscribe" &&
        msg.error?.code === "SPACE_NOT_FOUND"
      ) {
        // The server refuses the whole request when one database in it is no
        // longer ours. After dropping that one, the rest still have to be
        // subscribed; otherwise the socket stays connected with no
        // subscriptions and no space receives live updates until a reload.
        try {
          await requestMembershipRefresh();
          if (subscribeRetries < 3) {
            subscribeRetries += 1;
            subscribeInitializedDatabases();
          }
        } catch (error) {
          reportMembershipRefreshFailure(error);
        }
      }
    };
  }

  function disconnectWebSocket() {
    shouldReconnect = false;
    clearTimeout(reconnectTimer);
    clearTimeout(stableConnectionTimer);
    reconnectAttempts = 0;
    if (ws.value) {
      ws.value.close();
      ws.value = null;
    }
  }

  function setSyncEnabled(v) {
    const auth = useAuthStore();

    // Prevent enabling sync if offline or not authenticated
    if (v && !isOnline.value) {
      console.warn("[Sync] Cannot enable sync while offline");
      return false;
    }

    if (v && !auth.isAuthenticated) {
      console.warn("[Sync] Cannot enable sync without authentication");
      return false;
    }

    syncEnabled.value = v;

    if (v) {
      shouldReconnect = true;
      hasShownAuthWarning.value = false; // Reset warning flag when re-enabling sync
      hasShownConnectionLimitNotice = false;
      console.info("[Sync] Sync enabled, connecting...");
      connectWebSocket();
      sync();
    } else {
      console.info("[Sync] Sync disabled, disconnecting...");
      disconnectWebSocket();
    }

    return true;
  }

  return {
    databases,
    personalDbKey,
    membershipVersion,
    sharedSpacesAvailable,
    liveSessionsAvailable,
    pendingSpaceDeletions,
    bootstrapState,
    isInitialized,
    syncEnabled,
    isSyncing,
    isOnline,
    contentMergeWriteback,
    repository,
    personalRepository,
    execute,
    exec,
    initializeDB,
    resetDatabase,
    sync,
    ensureUploaded,
    refreshMembership,
    requestMembershipRefresh,
    retryBootstrap,
    removeDatabase,
    subscribeInitializedDatabases,
    setSyncEnabled,
    ensureGlobalsSchema,
    ensureNotesSchema,
    ensureImagesSchema,
    ensureTemplatesSchema,
    connectWebSocket,
    disconnectWebSocket,
    addWebSocketListener,
    sendWebSocketMessage,
    setCollabRemoteGuard,
    captureMergeBase,
    followLocalBodyWrite,
    holdUnsavedText,
  };
});
