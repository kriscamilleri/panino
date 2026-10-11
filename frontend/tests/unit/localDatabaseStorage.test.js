import { describe, expect, it } from 'vitest';
import { deleteLocalDatabase, purgeCachedSpaceResponses } from '@/utils/localDatabaseStorage.js';

/**
 * Just enough of IndexedDB for one object store keyed by [path, offset, version]:
 * the layout wa-sqlite's IDBBatchAtomicVFS uses.
 */
function fakeIndexedDB(rows = []) {
  const state = { rows: rows.map((key) => ({ key })), opened: [], closed: 0, stores: new Set(['blocks']) };
  const emitter = () => {
    const listeners = {};
    return {
      addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
      fire: (name) => (listeners[name] || []).forEach((fn) => fn()),
    };
  };
  const compare = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (i >= a.length) return -1;
      if (i >= b.length) return 1;
      if (Array.isArray(b[i])) return -1; // an array sorts after every string and number
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  };
  const database = {
    objectStoreNames: { contains: (name) => state.stores.has(name) },
    createObjectStore: (name) => { state.stores.add(name); return { createIndex() {} }; },
    close: () => { state.closed += 1; },
    transaction: (store, mode) => {
      const transaction = emitter();
      transaction.objectStore = () => ({
        delete: (range) => {
          state.rows = state.rows.filter(({ key }) => !(compare(key, range.lower) >= 0 && compare(key, range.upper) <= 0));
        },
      });
      state.mode = mode;
      queueMicrotask(() => transaction.fire('complete'));
      return transaction;
    },
  };
  return {
    state,
    indexedDB: {
      open: (name, version) => {
        state.opened.push([name, version]);
        const request = emitter();
        request.result = database;
        queueMicrotask(() => request.fire('success'));
        return request;
      },
    },
    IDBKeyRange: { bound: (lower, upper) => ({ lower, upper }) },
  };
}

describe('deleteLocalDatabase', () => {
  const SPACE_FILE = 'panino-space-22222222-2222-4222-8222-222222222222-11111111-1111-4111-8111-111111111111.db';
  const PERSONAL_FILE = 'panino-11111111-1111-4111-8111-111111111111.db';

  it('removes every block of the database and its journal files, and nothing else', async () => {
    const fake = fakeIndexedDB([
      [`/${SPACE_FILE}`, 0, 0],
      [`/${SPACE_FILE}`, -4096, 3],
      [`/${SPACE_FILE}-journal`, 0, 1],
      [`/${PERSONAL_FILE}`, 0, 0],
      // A different file whose name merely starts the same way.
      [`/${SPACE_FILE}.bak`, 0, 0],
    ]);

    await expect(deleteLocalDatabase(SPACE_FILE, fake)).resolves.toBe(true);

    expect(fake.state.rows.map(({ key }) => key[0])).toEqual([`/${PERSONAL_FILE}`, `/${SPACE_FILE}.bak`]);
    expect(fake.state.opened).toEqual([['idb-batch-atomic', 5]]);
    expect(fake.state.mode).toBe('readwrite');
    expect(fake.state.closed).toBe(1);
  });

  it('refuses anything that is not a plain file name', async () => {
    const fake = fakeIndexedDB();
    await expect(deleteLocalDatabase('../panino.db', fake)).rejects.toThrow(/plain database file name/);
    await expect(deleteLocalDatabase('', fake)).rejects.toThrow(/plain database file name/);
    expect(fake.state.opened).toEqual([]);
  });

  it('does nothing where there is no IndexedDB', async () => {
    await expect(deleteLocalDatabase(SPACE_FILE, { indexedDB: undefined, IDBKeyRange: undefined })).resolves.toBe(false);
  });
});

describe('purgeCachedSpaceResponses', () => {
  const SPACE = '22222222-2222-4222-8222-222222222222';
  const OTHER = '33333333-3333-4333-8333-333333333333';

  function fakeCaches(contents) {
    const stores = new Map(Object.entries(contents).map(([name, urls]) => [name, new Set(urls)]));
    return {
      stores,
      caches: {
        keys: async () => [...stores.keys()],
        open: async (name) => ({
          keys: async () => [...stores.get(name)].map((url) => ({ url })),
          delete: async (request) => stores.get(name).delete(request.url),
        }),
      },
    };
  }

  it("removes this space's images, member list and revisions from the runtime caches only", async () => {
    const fake = fakeCaches({
      'panino-runtime-abc': [
        `https://panino.example/api/images/aaaa?space=${SPACE}&token=jwt`,
        `https://panino.example/api/spaces/${SPACE}`,
        `https://panino.example/api/notes/n1/revisions?space=${SPACE.toUpperCase()}`,
        `https://panino.example/api/images/bbbb?space=${OTHER}&token=jwt`,
        'https://panino.example/api/images/cccc?token=jwt',
        'https://panino.example/api/spaces?limit=25',
      ],
      'panino-abc': [`https://panino.example/assets/app.js?space=${SPACE}`],
    });

    await expect(purgeCachedSpaceResponses(SPACE, fake)).resolves.toBe(3);

    expect([...fake.stores.get('panino-runtime-abc')]).toEqual([
      `https://panino.example/api/images/bbbb?space=${OTHER}&token=jwt`,
      'https://panino.example/api/images/cccc?token=jwt',
      'https://panino.example/api/spaces?limit=25',
    ]);
    expect(fake.stores.get('panino-abc').size).toBe(1);
  });

  it('does nothing without a Cache Storage or a space id', async () => {
    await expect(purgeCachedSpaceResponses(SPACE, { caches: undefined })).resolves.toBe(0);
    await expect(purgeCachedSpaceResponses('', fakeCaches({}))).resolves.toBe(0);
  });
});
