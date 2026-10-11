import { describe, expect, it } from 'vitest';
import { createScopedRepository, runExclusive } from '@/utils/scopedRepository.js';
import { classifyEditorConflict } from '@/utils/documentPersistence.js';

const KEY = 'user:11111111-1111-4111-8111-111111111111';
const OTHER = 'user:22222222-2222-4222-8222-222222222222';
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** A connection that, like SQLite, refuses BEGIN while a transaction is open. */
function strictConnection() {
  const log = [];
  let open = false;
  return {
    log,
    async exec(sql) {
      await tick(1);
      if (sql === 'BEGIN') {
        if (open) throw new Error('cannot start a transaction within a transaction');
        open = true;
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') open = false;
      log.push(sql);
    },
    async execO() { await tick(1); return []; },
  };
}

describe('repository.transaction on a shared connection', () => {
  it('queues overlapping transactions instead of nesting them', async () => {
    // An editor save starting while sync applies remote rows used to fail with
    // "cannot start a transaction within a transaction" and was dropped.
    const connection = strictConnection();
    const repository = createScopedRepository(KEY, () => connection);

    const slow = repository.transaction(async (tx) => {
      await tx.exec('remote row 1');
      await tick(20);
      await tx.exec('remote row 2');
    });
    const save = repository.transaction((tx) => tx.exec('editor save'));

    await expect(Promise.all([slow, save])).resolves.toBeDefined();
    expect(connection.log).toEqual([
      'BEGIN', 'remote row 1', 'remote row 2', 'COMMIT',
      'BEGIN', 'editor save', 'COMMIT',
    ]);
  });

  it('keeps going after a transaction fails, and rolls that one back', async () => {
    const connection = strictConnection();
    const repository = createScopedRepository(KEY, () => connection);

    const failing = repository.transaction(async () => { throw new Error('write failed'); });
    const next = repository.transaction((tx) => tx.exec('next write'));

    await expect(failing).rejects.toThrow('write failed');
    await expect(next).resolves.toBeUndefined();
    expect(connection.log).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'next write', 'COMMIT']);
  });

  it('does not make one database wait for another', async () => {
    const order = [];
    const first = runExclusive(KEY, async () => { await tick(20); order.push('first database'); });
    const second = runExclusive(OTHER, async () => { order.push('second database'); });
    await Promise.all([first, second]);
    expect(order).toEqual(['second database', 'first database']);
  });

  it('returns the work result and runs sections in arrival order', async () => {
    const order = [];
    const results = await Promise.all([1, 2, 3].map((n) => runExclusive(KEY, async () => {
      await tick(4 - n);
      order.push(n);
      return n * 10;
    })));
    expect(results).toEqual([10, 20, 30]);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe('classifyEditorConflict', () => {
  it('treats identical editor and incoming text as agreement, not a conflict', () => {
    // The editor's own save coming back, or both sides making the same change.
    expect(classifyEditorConflict({ mine: 'new text', base: 'old text', theirs: 'new text' })).toBe('adopt');
  });

  it('still reports a conflict when both sides changed differently', () => {
    expect(classifyEditorConflict({ mine: 'my text', base: 'old text', theirs: 'their text' })).toBe('conflict');
  });

  it('keeps the existing ignore and adopt cases', () => {
    expect(classifyEditorConflict({ mine: 'typing', base: 'old', theirs: 'old' })).toBe('ignore');
    expect(classifyEditorConflict({ mine: 'old', base: 'old', theirs: 'new' })).toBe('adopt');
  });
});
