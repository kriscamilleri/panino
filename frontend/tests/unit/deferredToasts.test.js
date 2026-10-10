import { describe, it, expect } from 'vitest';
import { DEFERRED_TOASTS_KEY, queueDeferredToasts, takeDeferredToasts } from '@/utils/deferredToasts';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    has: (key) => data.has(key),
  };
}

describe('deferred toasts', () => {
  it('returns queued toasts once, in order, then clears the queue', () => {
    const storage = memoryStorage();
    const queued = queueDeferredToasts(storage, [
      { message: 'Import complete: 1 created, 1 image uploaded.', type: 'success' },
      { message: 'Skipped 1 item(s): img/missing.png (not found)', type: 'warning', duration: 8000 },
    ]);

    expect(queued).toBe(2);
    expect(takeDeferredToasts(storage)).toEqual([
      { message: 'Import complete: 1 created, 1 image uploaded.', type: 'success', duration: 5000 },
      { message: 'Skipped 1 item(s): img/missing.png (not found)', type: 'warning', duration: 8000 },
    ]);
    expect(storage.has(DEFERRED_TOASTS_KEY)).toBe(false);
    expect(takeDeferredToasts(storage)).toEqual([]);
  });

  it('queues nothing for an empty list', () => {
    const storage = memoryStorage();
    expect(queueDeferredToasts(storage, [])).toBe(0);
    expect(storage.has(DEFERRED_TOASTS_KEY)).toBe(false);
  });

  it('drops malformed entries and falls back to safe defaults', () => {
    const storage = memoryStorage();
    queueDeferredToasts(storage, [
      null,
      { message: '' },
      { message: 42 },
      { message: 'kept', type: 'shouting', duration: -1 },
    ]);

    expect(takeDeferredToasts(storage)).toEqual([{ message: 'kept', type: 'info', duration: 5000 }]);
  });

  it('bounds how many toasts, how long, and for how long', () => {
    const storage = memoryStorage();
    queueDeferredToasts(
      storage,
      Array.from({ length: 9 }, (_, i) => ({ message: `${i}`.padEnd(2000, 'x'), duration: 10 ** 9 })),
    );

    const taken = takeDeferredToasts(storage);
    expect(taken).toHaveLength(5);
    expect(taken[0].message).toHaveLength(1000);
    expect(taken[0].duration).toBe(60000);
  });

  it('ignores a corrupt or foreign value instead of throwing', () => {
    expect(takeDeferredToasts(memoryStorage({ [DEFERRED_TOASTS_KEY]: '{not json' }))).toEqual([]);
    expect(takeDeferredToasts(memoryStorage({ [DEFERRED_TOASTS_KEY]: '{"message":"x"}' }))).toEqual([]);
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => {},
    };
    expect(queueDeferredToasts(broken, [{ message: 'x' }])).toBe(0);
    expect(takeDeferredToasts(broken)).toEqual([]);
  });
});
