import { describe, it, expect } from 'vitest';
import {
  LOCAL_DB_VERSION_SQL,
  OUTGOING_CHANGES_SQL,
  OUTGOING_VERSIONS_SQL,
  planOutgoingWindow,
  readOutgoingChanges,
  resolvePushCursor,
} from '@/utils/syncCursor';

/**
 * In-memory stand-in for the three statements `readOutgoingChanges` issues.
 * `rows` are `crsql_changes` rows with an `own` flag; `committedVersion` is
 * what `crsql_db_version()` reports.
 */
function fakeDatabase(rows, committedVersion) {
  const calls = [];
  const own = (after, upTo) =>
    rows.filter((row) => row.own && row.db_version > after && row.db_version <= upTo);

  return {
    calls,
    async execO(sql, params = []) {
      calls.push({ sql, params });
      if (sql === LOCAL_DB_VERSION_SQL) return [{ version: committedVersion }];
      if (sql === OUTGOING_VERSIONS_SQL) {
        const counts = new Map();
        for (const row of own(params[0], params[1])) {
          counts.set(row.db_version, (counts.get(row.db_version) || 0) + 1);
        }
        return [...counts.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([db_version, change_count]) => ({ db_version, change_count }));
      }
      if (sql === OUTGOING_CHANGES_SQL) {
        return own(params[0], params[1]).sort((a, b) => a.db_version - b.db_version);
      }
      throw new Error(`Unexpected statement: ${sql}`);
    },
  };
}

const change = (db_version, cid, own = true) => ({ table: 'notes', cid, db_version, own });

describe('resolvePushCursor', () => {
  it('starts from zero when nothing was stored', () => {
    expect(resolvePushCursor(null, 40)).toBe(0);
    expect(resolvePushCursor(undefined, 40)).toBe(0);
    expect(resolvePushCursor('', 40)).toBe(0);
  });

  it('keeps a stored cursor that the local database can still honour', () => {
    expect(resolvePushCursor('12', 40)).toBe(12);
    expect(resolvePushCursor(40, 40)).toBe(40);
  });

  it('restarts when the cursor is ahead of the local database', () => {
    expect(resolvePushCursor('41', 40)).toBe(0);
  });

  it('restarts on an unreadable or negative value', () => {
    expect(resolvePushCursor('not-a-number', 40)).toBe(0);
    expect(resolvePushCursor('-3', 40)).toBe(0);
  });
});

describe('planOutgoingWindow', () => {
  it('advances to the local snapshot when nothing is pending', () => {
    expect(planOutgoingWindow([], { localDbVersion: 57 })).toEqual({ upTo: 57, hasMore: false });
  });

  it('advances to the local snapshot when everything fits', () => {
    const pending = [
      { db_version: 51, change_count: 2 },
      { db_version: 55, change_count: 6 },
    ];
    expect(planOutgoingWindow(pending, { localDbVersion: 57, maxChanges: 10 }))
      .toEqual({ upTo: 57, hasMore: false });
  });

  it('stops at a whole version when the cap would be exceeded', () => {
    const pending = [
      { db_version: 3, change_count: 4 },
      { db_version: 4, change_count: 4 },
      { db_version: 9, change_count: 4 },
    ];
    expect(planOutgoingWindow(pending, { localDbVersion: 20, maxChanges: 8 }))
      .toEqual({ upTo: 4, hasMore: true });
  });

  it('always takes the first pending version, even when it alone exceeds the cap', () => {
    const pending = [
      { db_version: 3, change_count: 900 },
      { db_version: 4, change_count: 1 },
    ];
    expect(planOutgoingWindow(pending, { localDbVersion: 20, maxChanges: 500 }))
      .toEqual({ upTo: 3, hasMore: true });
  });

  it('accepts the bigint and string counts SQLite drivers may return', () => {
    const pending = [{ db_version: 7n, change_count: '3' }];
    expect(planOutgoingWindow(pending, { localDbVersion: 9, maxChanges: 500 }))
      .toEqual({ upTo: 9, hasMore: false });
  });
});

describe('readOutgoingChanges', () => {
  it('uploads a write whose local version equals the pull clock', async () => {
    // A second device signs in: the server (at 56) merges the device's seed
    // rows and answers with clock 57. The device's next transaction also gets
    // local version 57. Selecting by `db_version > clock` skipped it forever;
    // the push cursor (56 here, the version uploaded so far) does not.
    const database = fakeDatabase(
      [change(4, 'name'), change(57, 'title'), change(57, 'content'), change(57, 'created_at')],
      57,
    );

    const result = await readOutgoingChanges(database, '56');

    expect(result.changes.map((row) => row.cid)).toEqual(['title', 'content', 'created_at']);
    expect(result).toMatchObject({ upTo: 57, hasMore: false });
  });

  it('offers every own change again when no cursor exists yet', async () => {
    const database = fakeDatabase([change(2, 'title'), change(9, 'content')], 9);

    const result = await readOutgoingChanges(database, null);

    expect(result.changes.map((row) => row.db_version)).toEqual([2, 9]);
  });

  it('never uploads rows received from other replicas', async () => {
    const database = fakeDatabase([change(8, 'content', false), change(9, 'title')], 9);

    const result = await readOutgoingChanges(database, '0');

    expect(result.changes.map((row) => row.cid)).toEqual(['title']);
  });

  it('leaves rows of a still-open transaction for the next sync', async () => {
    // crsql_db_version() reports the committed version (10) while the open
    // transaction's rows already carry version 11.
    const database = fakeDatabase([change(10, 'title'), change(11, 'content')], 10);

    const result = await readOutgoingChanges(database, '9');

    expect(result.changes.map((row) => row.cid)).toEqual(['title']);
    expect(result.upTo).toBe(10);
  });

  it('batches a large backlog on version boundaries and reports more to send', async () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => change(1, `a${i}`)),
      ...Array.from({ length: 3 }, (_, i) => change(2, `b${i}`)),
      ...Array.from({ length: 3 }, (_, i) => change(3, `c${i}`)),
    ];
    const database = fakeDatabase(rows, 3);

    const first = await readOutgoingChanges(database, null, { maxChanges: 6 });
    expect(first.changes).toHaveLength(6);
    expect(first).toMatchObject({ upTo: 2, hasMore: true });

    const second = await readOutgoingChanges(database, String(first.upTo), { maxChanges: 6 });
    expect(second.changes.map((row) => row.cid)).toEqual(['c0', 'c1', 'c2']);
    expect(second).toMatchObject({ upTo: 3, hasMore: false });
  });

  it('skips the change query when nothing is pending', async () => {
    const database = fakeDatabase([change(5, 'content', false)], 5);

    const result = await readOutgoingChanges(database, '5');

    expect(result).toEqual({ changes: [], upTo: 5, hasMore: false });
    expect(database.calls.some((call) => call.sql === OUTGOING_CHANGES_SQL)).toBe(false);
  });

  it('restarts from zero when the stored cursor is ahead of a recreated database', async () => {
    const database = fakeDatabase([change(1, 'title')], 1);

    const result = await readOutgoingChanges(database, '400');

    expect(result.changes.map((row) => row.cid)).toEqual(['title']);
  });
});
