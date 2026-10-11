import { describe, it, expect } from 'vitest';
import {
  LOCAL_DB_VERSION_SQL,
  OUTGOING_CHANGES_SQL,
  OUTGOING_VERSIONS_SQL,
  VERSION_REST_SQL,
  VERSION_SLICE_END_SQL,
  VERSION_SLICE_SQL,
  formatPushCursor,
  parsePushCursor,
  planOutgoingWindow,
  readOutgoingChanges,
} from '@/utils/syncCursor';

/**
 * In-memory stand-in for the statements `readOutgoingChanges` issues. `rows`
 * are `crsql_changes` rows with an `own` flag; `committedVersion` is what
 * `crsql_db_version()` reports.
 */
function fakeDatabase(rows, committedVersion) {
  const calls = [];
  const bySeq = (a, b) => a.db_version - b.db_version || a.seq - b.seq;
  const own = (predicate) => rows.filter((row) => row.own && predicate(row)).sort(bySeq);

  return {
    calls,
    async execO(sql, params = []) {
      calls.push({ sql, params });
      if (sql === LOCAL_DB_VERSION_SQL) return [{ version: committedVersion }];
      if (sql === OUTGOING_VERSIONS_SQL) {
        const groups = new Map();
        for (const row of own((r) => r.db_version > params[0] && r.db_version <= params[1])) {
          const group = groups.get(row.db_version) || { count: 0, seqs: new Set() };
          group.count += 1;
          group.seqs.add(row.seq);
          groups.set(row.db_version, group);
        }
        return [...groups.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([db_version, group]) => ({ db_version, change_count: group.count, distinct_seq: group.seqs.size }));
      }
      if (sql === OUTGOING_CHANGES_SQL) {
        return own((r) => r.db_version > params[0] && r.db_version <= params[1]);
      }
      if (sql === VERSION_SLICE_END_SQL) {
        const remaining = own((r) => r.db_version === params[0] && r.seq > params[1]);
        return remaining[params[2]] ? [{ seq: remaining[params[2]].seq }] : [];
      }
      if (sql === VERSION_SLICE_SQL) {
        return own((r) => r.db_version === params[0] && r.seq > params[1] && r.seq <= params[2]);
      }
      if (sql === VERSION_REST_SQL) {
        return own((r) => r.db_version === params[0] && r.seq > params[1]);
      }
      throw new Error(`Unexpected statement: ${sql}`);
    },
  };
}

let nextSeq = 0;
const change = (db_version, cid, own = true, seq = nextSeq++) => ({ table: 'notes', cid, db_version, seq, own });

/** One transaction of `count` changes, as a bulk import produces. */
const bulkVersion = (db_version, count) => Array.from({ length: count }, (_, i) => change(db_version, `c${i}`, true, i));

describe('parsePushCursor', () => {
  it('starts from zero when nothing was stored', () => {
    for (const stored of [null, undefined, '']) {
      expect(parsePushCursor(stored, 40)).toEqual({ version: 0, seq: null });
    }
  });

  it('reads a completed version and a version in progress', () => {
    expect(parsePushCursor('12', 40)).toEqual({ version: 12, seq: null });
    expect(parsePushCursor(40, 40)).toEqual({ version: 40, seq: null });
    expect(parsePushCursor('12.340', 40)).toEqual({ version: 12, seq: 340 });
    expect(parsePushCursor('12.0', 40)).toEqual({ version: 12, seq: 0 });
  });

  it('restarts when the cursor is ahead of the local database', () => {
    expect(parsePushCursor('41', 40)).toEqual({ version: 0, seq: null });
    expect(parsePushCursor('41.7', 40)).toEqual({ version: 0, seq: null });
  });

  it('restarts on an unreadable value', () => {
    for (const stored of ['not-a-number', '-3', '12.', '.5', '1.2.3', '1e3', '12.x']) {
      expect(parsePushCursor(stored, 40)).toEqual({ version: 0, seq: null });
    }
  });

  it('round-trips through formatPushCursor', () => {
    for (const stored of ['0', '57', '57.0', '57.1200']) {
      expect(formatPushCursor(parsePushCursor(stored, 100))).toBe(stored);
    }
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
    expect(result).toMatchObject({ nextCursor: '57', startVersion: 56, uploadedVersion: 57, hasMore: false });
  });

  it('offers every own change again when no cursor exists yet', async () => {
    const database = fakeDatabase([change(2, 'title'), change(9, 'content')], 9);

    const result = await readOutgoingChanges(database, null);

    expect(result.changes.map((row) => row.db_version)).toEqual([2, 9]);
    expect(result.startVersion).toBe(0);
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
    expect(result.nextCursor).toBe('10');
  });

  it('batches a backlog of small versions on version boundaries', async () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => change(1, `a${i}`)),
      ...Array.from({ length: 3 }, (_, i) => change(2, `b${i}`)),
      ...Array.from({ length: 3 }, (_, i) => change(3, `c${i}`)),
    ];
    const database = fakeDatabase(rows, 3);

    const first = await readOutgoingChanges(database, null, { maxChanges: 6 });
    expect(first.changes).toHaveLength(6);
    expect(first).toMatchObject({ nextCursor: '2', uploadedVersion: 2, hasMore: true });

    const second = await readOutgoingChanges(database, first.nextCursor, { maxChanges: 6 });
    expect(second.changes.map((row) => row.cid)).toEqual(['c0', 'c1', 'c2']);
    expect(second).toMatchObject({ nextCursor: '3', hasMore: false });
  });

  it('skips the change query when nothing is pending', async () => {
    const database = fakeDatabase([change(5, 'content', false)], 5);

    const result = await readOutgoingChanges(database, '5');

    expect(result).toEqual({
      changes: [],
      cursor: { version: 5, seq: null },
      nextCursor: '5',
      startVersion: 5,
      uploadedVersion: 5,
      hasMore: false,
    });
    expect(database.calls.some((call) => call.sql === OUTGOING_CHANGES_SQL)).toBe(false);
  });

  it('restarts from zero when the stored cursor is ahead of a recreated database', async () => {
    const database = fakeDatabase([change(1, 'title')], 1);

    const result = await readOutgoingChanges(database, '400');

    expect(result.changes.map((row) => row.cid)).toEqual(['title']);
  });
});

describe('readOutgoingChanges: one transaction larger than a request', () => {
  it('uploads a bulk import in slices and loses no row', async () => {
    const database = fakeDatabase([change(5, 'earlier', true, 0), ...bulkVersion(6, 1234), change(7, 'later', true, 0)], 7);
    const sent = [];
    const sizes = [];
    let cursor = '5';

    for (let turn = 0; turn < 20; turn += 1) {
      const batch = await readOutgoingChanges(database, cursor, { maxChanges: 500 });
      sizes.push(batch.changes.length);
      sent.push(...batch.changes.map((row) => `${row.db_version}:${row.cid}`));
      cursor = batch.nextCursor;
      if (!batch.hasMore) break;
    }

    expect(sizes).toEqual([500, 500, 234, 1]);
    expect(new Set(sent).size).toBe(1235);
    expect(sent.at(-1)).toBe('7:later');
    expect(cursor).toBe('7');
  });

  it('records progress inside the version so an interrupted upload resumes', async () => {
    const database = fakeDatabase(bulkVersion(6, 1200), 6);

    const first = await readOutgoingChanges(database, '5', { maxChanges: 500 });
    expect(first).toMatchObject({ nextCursor: '6.499', startVersion: 5, uploadedVersion: 5, hasMore: true });

    // The page reloads here; only the stored cursor survives.
    const resumed = await readOutgoingChanges(database, '6.499', { maxChanges: 500 });
    expect(resumed.changes[0].seq).toBe(500);
    expect(resumed.changes).toHaveLength(500);
    expect(resumed).toMatchObject({ nextCursor: '6.999', uploadedVersion: 5 });

    const last = await readOutgoingChanges(database, resumed.nextCursor, { maxChanges: 500 });
    expect(last.changes).toHaveLength(200);
    expect(last).toMatchObject({ nextCursor: '6', uploadedVersion: 6 });
  });

  it('never reads values to find where a slice ends', async () => {
    const database = fakeDatabase(bulkVersion(6, 900), 6);

    await readOutgoingChanges(database, '5', { maxChanges: 500 });

    const statements = database.calls.map((call) => call.sql);
    expect(statements).toContain(VERSION_SLICE_END_SQL);
    expect(VERSION_SLICE_END_SQL).not.toMatch(/\bval\b/);
    expect(statements).not.toContain(OUTGOING_CHANGES_SQL);
  });

  it('sends the version whole when its sequence numbers are not unique', async () => {
    // Slicing by `seq > last` would skip a row sharing the boundary number.
    const rows = bulkVersion(6, 900).map((row, i) => (i === 400 ? { ...row, seq: 399 } : row));
    const database = fakeDatabase(rows, 6);

    const result = await readOutgoingChanges(database, '5', { maxChanges: 500 });

    expect(result.changes).toHaveLength(900);
    expect(result.nextCursor).toBe('6');
  });

  it('still sends an oversized version first when smaller ones precede it', async () => {
    const database = fakeDatabase([change(5, 'small', true, 0), ...bulkVersion(6, 900)], 6);

    const first = await readOutgoingChanges(database, '4', { maxChanges: 500 });
    expect(first.changes.map((row) => row.cid)).toEqual(['small']);
    expect(first).toMatchObject({ nextCursor: '5', hasMore: true });

    const second = await readOutgoingChanges(database, first.nextCursor, { maxChanges: 500 });
    expect(second.changes).toHaveLength(500);
    expect(second.nextCursor).toBe('6.499');
  });
});
