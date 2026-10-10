// @vitest-environment jsdom
/**
 * End-to-end behaviour of one `/sync` exchange in the sync store, against a
 * small stateful stand-in for the local CR-SQLite database. The stand-in keeps
 * document bodies, merge bases and conflict records, and resolves an applied
 * remote row the way CR-SQLite does: the higher column version wins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PERSONAL_KEY = `user:${USER_ID}`;
const SITE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_SITE = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const NOTE = '33333333-3333-4333-8333-333333333333';

const BASE = 'title\n\nalpha\n\nbeta\n';
const MINE = 'title\n\nalpha edited here\n\nbeta\n';
const REMOTE = 'title\n\nalpha\n\nbeta edited there\n';
const MERGED = 'title\n\nalpha edited here\n\nbeta edited there\n';

const harness = vi.hoisted(() => ({
  auth: {
    isAuthenticated: true,
    user: { id: '11111111-1111-4111-8111-111111111111', name: 'Personal User' },
    token: 'token',
    refreshToken: vi.fn(async () => false),
  },
  open: vi.fn(),
  toasts: [],
  drafts: new Map(),
}));

vi.mock('@/vendor/crsqlite-wasm/index.js', () => ({
  default: vi.fn(async () => ({ open: harness.open })),
}));
vi.mock('@/store/authStore', () => ({ useAuthStore: () => harness.auth }));
vi.mock('@/store/docStore', () => ({ useDocStore: () => ({ refreshData: vi.fn(async () => {}) }) }));
vi.mock('@/store/globalVariablesStore', () => ({
  useGlobalVariablesStore: () => ({ loadGlobals: vi.fn(async () => {}) }),
}));
vi.mock('@/store/draftStore', () => ({
  useDraftStore: () => ({ getDraft: (id) => harness.drafts.get(id) }),
}));
vi.mock('@/store/uiStore', () => ({
  useUiStore: () => ({ addToast: (message, type) => harness.toasts.push({ message, type }) }),
}));

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWebSocket.instances.push(this); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  refuse(reason) { this.readyState = 3; this.onclose?.({ code: 1008, reason }); }
  drop() { this.readyState = 3; this.onclose?.({ code: 1006, reason: '' }); }
}

const pkOf = (id) => Array.from(new TextEncoder().encode(id)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * @param {{ body?: string, colVersion?: number, dbVersion?: number, base?: string, own?: boolean }} seed
 *   the one document this replica holds, and whether its body is this replica's own change
 */
function localDatabase(seed = {}) {
  const state = {
    bodies: new Map(seed.body === undefined ? [] : [[NOTE, seed.body]]),
    colVersion: seed.colVersion ?? 1,
    // Own body changes in crsql_changes: [{ dbVersion, colVersion }]
    ownChange: seed.own === false || seed.body === undefined ? null : { dbVersion: seed.dbVersion ?? 1 },
    committedVersion: seed.committedVersion ?? seed.dbVersion ?? 1,
    bases: new Map(seed.base === undefined ? [] : [[NOTE, { content: seed.base, writeback_count: 0, writeback_window_started_at: null }]]),
    conflicts: new Map(),
    localWrites: [],
  };

  const ownRows = (after, upTo = Infinity) => (state.ownChange && state.ownChange.dbVersion > after && state.ownChange.dbVersion <= upTo
    ? [{
        table: 'notes', pk: new TextEncoder().encode(NOTE), cid: 'content', val: state.bodies.get(NOTE),
        col_version: state.colVersion, db_version: state.ownChange.dbVersion, site_id: SITE.toUpperCase(), seq: 0, cl: 1,
      }]
    : []);

  const database = {
    state,
    onUpdate: vi.fn(),
    close: vi.fn(async () => {}),
    execO: vi.fn(async (sql, params = []) => {
      if (sql.includes('crsql_db_version')) return [{ version: state.committedVersion }];
      if (sql.includes('FROM crsql_changes') && sql.includes('GROUP BY')) {
        return ownRows(params[0], params[1]).map((row) => ({ db_version: row.db_version, change_count: 1 }));
      }
      if (sql.includes('FROM crsql_changes') && sql.startsWith('SELECT pk')) {
        return ownRows(params[0]).map((row) => ({ pk: row.pk }));
      }
      if (sql.includes('FROM crsql_changes')) return ownRows(params[0], params[1]);
      if (sql.includes('crsql_site_id')) return [{ id: SITE }];
      if (sql.includes('FROM notes WHERE id IN')) {
        return [...state.bodies].map(([id, content]) => ({ id, content }));
      }
      if (sql.includes('FROM note_sync_base WHERE note_id')) {
        const base = state.bases.get(params[0]);
        return base ? [base] : [];
      }
      if (sql.includes('FROM note_conflicts WHERE note_id')) {
        const held = state.conflicts.get(params[0]);
        return held ? [{ base_content: held.base, mine_content: held.mine }] : [];
      }
      if (sql.includes("PRAGMA table_info('notes')")) return [{ name: 'pinned' }];
      if (sql.includes("PRAGMA table_info('images')")) return [{ name: 'size_bytes' }, { name: 'sha256' }];
      if (sql.includes("PRAGMA table_info('globals')")) {
        return [{ name: 'key' }, { name: 'id' }, { name: 'created_at' }, { name: 'updated_at' }, { name: 'display_key' }];
      }
      if (sql.includes("PRAGMA table_info('templates')")) {
        return [{ name: 'name', notnull: 1, dflt_value: "''" }, { name: 'title_pattern' }, { name: 'default_folder_id' }];
      }
      if (sql.includes('COUNT(*) AS cnt FROM templates')) return [{ cnt: 1 }];
      return [];
    }),
    exec: vi.fn(async (sql, params = []) => {
      if (sql.includes('INSERT INTO crsql_changes')) {
        const [table, , cid, val, colVersion] = params;
        if (table !== 'notes' || cid !== 'content') return;
        // Last writer wins on the column version, as in CR-SQLite.
        if (!state.bodies.has(NOTE) || Number(colVersion) > state.colVersion) {
          state.bodies.set(NOTE, val);
          state.colVersion = Number(colVersion);
          state.ownChange = null;
        }
        return;
      }
      if (sql.startsWith('UPDATE notes SET content')) {
        state.bodies.set(params[2], params[0]);
        state.colVersion += 1;
        state.committedVersion += 1;
        state.ownChange = { dbVersion: state.committedVersion };
        state.localWrites.push(params[0]);
        return;
      }
      if (sql.includes('INSERT INTO note_sync_base') && sql.includes('writeback_count')) {
        state.bases.set(params[0], { content: params[1], writeback_count: params[2], writeback_window_started_at: params[3] });
        return;
      }
      if (sql.includes('INSERT INTO note_sync_base')) {
        const existing = state.bases.get(params[0]);
        state.bases.set(params[0], { writeback_count: 0, writeback_window_started_at: null, ...existing, content: params[1] });
        return;
      }
      if (sql.includes('INSERT OR IGNORE INTO note_sync_base')) {
        const excluded = new Set(params);
        for (const [id, content] of state.bodies) {
          if (!state.bases.has(id) && !excluded.has(id)) {
            state.bases.set(id, { content, writeback_count: 0, writeback_window_started_at: null });
          }
        }
        return;
      }
      if (sql.includes('INSERT INTO note_conflicts')) {
        state.conflicts.set(params[0], { base: params[1], mine: params[2], theirs: params[3] });
        return;
      }
      if (sql.startsWith('DELETE FROM note_conflicts')) state.conflicts.delete(params[0]);
    }),
  };
  return database;
}

const remoteBody = (content, colVersion) => ({
  table: 'notes', pk: pkOf(NOTE), cid: 'content', val: content,
  col_version: colVersion, db_version: 40, site_id: OTHER_SITE, seq: 0, cl: 1,
});

function serverReplies(body) {
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (url.includes('/spaces')) return { ok: false, status: 404, json: async () => ({}) };
    if (!url.includes('/sync')) return { ok: true, status: 200, json: async () => ({}) };
    requests.push(JSON.parse(options.body));
    const reply = typeof body === 'function' ? body(requests.length) : body;
    return { ok: reply.status ? reply.status < 300 : true, status: reply.status ?? 200, json: async () => reply };
  }));
  return requests;
}

const { useSyncStore } = await import('@/store/syncStore.js');

async function startStore(database, { pushCursor, clock } = {}) {
  harness.open.mockImplementation(async () => database);
  if (pushCursor !== undefined) localStorage.setItem(`crsqlite_push_cursor:${PERSONAL_KEY}`, String(pushCursor));
  if (clock !== undefined) localStorage.setItem(`crsqlite_clock:${PERSONAL_KEY}`, String(clock));
  const store = useSyncStore();
  await store.initializeDB();
  return store;
}

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
  harness.toasts.length = 0;
  harness.drafts.clear();
  harness.auth.refreshToken = vi.fn(async () => false);
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('uploads', () => {
  it('sends an own change whose local version equals the pull clock', async () => {
    const database = localDatabase({ body: MINE, dbVersion: 57, colVersion: 3, base: BASE });
    const requests = serverReplies({ changes: [], clock: 58 });
    const store = await startStore(database, { pushCursor: 56, clock: 57 });

    await store.sync();

    expect(requests[0]).toMatchObject({ since: 57 });
    expect(requests[0].changes.map((change) => change.cid)).toEqual(['content']);
    expect(localStorage.getItem(`crsqlite_push_cursor:${PERSONAL_KEY}`)).toBe('57');
    expect(localStorage.getItem(`crsqlite_clock:${PERSONAL_KEY}`)).toBe('58');
  });

  it('records the uploaded body as the merge base once it is acknowledged', async () => {
    const database = localDatabase({ body: MINE, dbVersion: 9, colVersion: 3, base: BASE });
    serverReplies({ changes: [], clock: 20 });
    const store = await startStore(database, { pushCursor: 8, clock: 19 });

    await store.sync();

    expect(database.state.bases.get(NOTE).content).toBe(MINE);
    expect(database.state.conflicts.size).toBe(0);
  });
});

describe('a remote body arrives', () => {
  it('is adopted without a conflict on a stale device that has no merge base yet', async () => {
    // First sync after upgrade: no stored push cursor, the body was synced long
    // ago (version 4, pull clock 30), and another device has since edited it.
    const database = localDatabase({ body: BASE, dbVersion: 4, colVersion: 2 });
    serverReplies({ changes: [remoteBody(REMOTE, 5)], clock: 41 });
    const store = await startStore(database, { clock: 30 });

    await store.sync();

    expect(database.state.bodies.get(NOTE)).toBe(REMOTE);
    expect(database.state.conflicts.size).toBe(0);
    expect(database.state.bases.get(NOTE).content).toBe(REMOTE);
  });

  it('keeps both bodies when an unacknowledged edit loses to it and merging is off', async () => {
    const database = localDatabase({ body: MINE, dbVersion: 9, colVersion: 3, base: BASE });
    serverReplies({ changes: [remoteBody(REMOTE, 4)], clock: 41 });
    const store = await startStore(database, { pushCursor: 8, clock: 30 });

    await store.sync();

    expect(database.state.bodies.get(NOTE)).toBe(REMOTE);
    expect(database.state.conflicts.get(NOTE)).toMatchObject({ base: BASE, mine: MINE, theirs: REMOTE });
    expect(database.state.localWrites).toEqual([]);
    expect(database.state.bases.get(NOTE).content).toBe(REMOTE);
  });

  it('keeps the overwritten remote body when this device won on the server', async () => {
    // The reply carries what the server held before it merged this upload.
    // Locally the remote row loses (version 2 < 3), so only the reply reveals it.
    const database = localDatabase({ body: MINE, dbVersion: 9, colVersion: 3, base: BASE });
    serverReplies({ changes: [remoteBody(REMOTE, 2)], clock: 41 });
    const store = await startStore(database, { pushCursor: 8, clock: 30 });

    await store.sync();

    expect(database.state.bodies.get(NOTE)).toBe(MINE);
    expect(database.state.conflicts.get(NOTE)).toMatchObject({ mine: MINE, theirs: REMOTE });
    // The server now holds this device's body.
    expect(database.state.bases.get(NOTE).content).toBe(MINE);
  });

  it('writes the merged body and uploads it when the server allows automatic merging', async () => {
    const database = localDatabase({ body: MINE, dbVersion: 9, colVersion: 3, base: BASE });
    const requests = serverReplies((n) => (n === 1
      ? { changes: [remoteBody(REMOTE, 4)], clock: 41, contentMergeWriteback: true }
      : { changes: [], clock: 42, contentMergeWriteback: true }));
    const store = await startStore(database, { pushCursor: 8, clock: 30 });

    await store.sync();
    await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect(database.state.bases.get(NOTE).content).toBe(MERGED));

    expect(database.state.bodies.get(NOTE)).toBe(MERGED);
    expect(database.state.localWrites).toEqual([MERGED]);
    expect(database.state.conflicts.size).toBe(0);
    expect(requests[1].changes.map((change) => change.val)).toEqual([MERGED]);
  });

  it('keeps both bodies for a stranded edit that outranks the server value after upgrade', async () => {
    // No push cursor and the edit sits at the pull clock, so nothing marks it
    // as pending. It survives the remote row, which shows the server never saw it.
    const database = localDatabase({ body: MINE, dbVersion: 30, colVersion: 9 });
    serverReplies({ changes: [remoteBody(REMOTE, 4)], clock: 41 });
    const store = await startStore(database, { clock: 30 });

    await store.sync();

    expect(database.state.bodies.get(NOTE)).toBe(MINE);
    expect(database.state.conflicts.get(NOTE)).toMatchObject({ mine: MINE, theirs: REMOTE });
  });

  it('uses the unsaved editor draft as the local side', async () => {
    const database = localDatabase({ body: BASE, dbVersion: 4, colVersion: 2, base: BASE, own: false });
    harness.drafts.set(NOTE, MINE);
    serverReplies({ changes: [remoteBody(REMOTE, 5)], clock: 41 });
    const store = await startStore(database, { pushCursor: 4, clock: 30 });

    await store.sync();

    expect(database.state.conflicts.get(NOTE)).toMatchObject({ mine: MINE, theirs: REMOTE });
  });

  it('does not discard a held conflict when the document later moves on', async () => {
    const database = localDatabase({ body: REMOTE, dbVersion: 4, colVersion: 4, base: REMOTE, own: false });
    database.state.conflicts.set(NOTE, { base: BASE, mine: MINE, theirs: REMOTE });
    const newer = `${REMOTE}\ngamma\n`;
    serverReplies({ changes: [remoteBody(newer, 5)], clock: 41 });
    const store = await startStore(database, { pushCursor: 4, clock: 30 });

    await store.sync();

    expect(database.state.bodies.get(NOTE)).toBe(newer);
    expect(database.state.conflicts.get(NOTE)).toMatchObject({ mine: MINE, theirs: newer });
  });
});

describe('an expired session', () => {
  it('tells the user once, turns sync off, and stops reconnecting', async () => {
    const database = localDatabase({ body: MINE, dbVersion: 9, colVersion: 3, base: BASE });
    const requests = serverReplies({ status: 403 });
    const store = await startStore(database, { pushCursor: 8, clock: 30 });

    await store.sync();
    await store.sync();

    expect(harness.auth.refreshToken).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(harness.toasts).toEqual([
      { message: 'Your session has expired. Please log in again to sync.', type: 'warning' },
    ]);
    expect(store.syncEnabled).toBe(false);
    // Nothing was acknowledged, so the edit stays queued for upload.
    expect(localStorage.getItem(`crsqlite_push_cursor:${PERSONAL_KEY}`)).toBe('8');
  });

  it('is recognised when the server refuses the socket for its token', async () => {
    vi.useFakeTimers();
    serverReplies({ changes: [], clock: 1 });
    const store = await startStore(localDatabase({}));
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();

    socket.refuse('Invalid token');
    await vi.advanceTimersByTimeAsync(120000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(store.syncEnabled).toBe(false);
    expect(harness.toasts.map((toast) => toast.message))
      .toEqual(['Your session has expired. Please log in again to sync.']);
  });
});

describe('reconnecting', () => {
  it('backs off instead of retrying every second', async () => {
    vi.useFakeTimers();
    serverReplies({ changes: [], clock: 1 });
    await startStore(localDatabase({}));

    const attempts = () => FakeWebSocket.instances.length;
    FakeWebSocket.instances.at(-1).drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts()).toBe(2);
    FakeWebSocket.instances.at(-1).drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts()).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts()).toBe(3);
    FakeWebSocket.instances.at(-1).drop();
    await vi.advanceTimersByTimeAsync(3999);
    expect(attempts()).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts()).toBe(4);
  });

  it('pauses, explains once, and retries slowly when the account has too many connections', async () => {
    vi.useFakeTimers();
    serverReplies({ changes: [], clock: 1 });
    const store = await startStore(localDatabase({}));

    FakeWebSocket.instances.at(-1).refuse('Too many connections for this account');
    await vi.advanceTimersByTimeAsync(59000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances.at(-1).refuse('Too many connections for this account');
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.toasts).toHaveLength(1);
    expect(harness.toasts[0].message).toContain('too many Panino tabs or devices');
    expect(store.syncEnabled).toBe(true);
  });
});
