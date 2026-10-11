/**
 * Removing what one database left in this browser.
 *
 * The SQLite build stores every database as blocks in one IndexedDB database
 * (wa-sqlite's IDBBatchAtomicVFS, registered as "idb-batch-atomic" in
 * `vendor/crsqlite-wasm/index.js`): object store `blocks`, keyed by
 * `[path, offset, version]`, where `path` is the file name with a leading
 * slash. Closing a database leaves all of it there. Nothing in the app deleted
 * any, so a member removed from a space kept every Document of that space on
 * disk, including a second copy of each body in the merge-base table and any
 * edits that had not been uploaded.
 */

const IDB_NAME = 'idb-batch-atomic';
const IDB_VERSION = 5;
const SIDECAR_SUFFIXES = ['', '-journal', '-wal', '-shm'];

function openBlockStore(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    // The same shape the file system creates, in case this runs first.
    request.addEventListener('upgradeneeded', () => {
      if (request.result.objectStoreNames.contains('blocks')) return;
      const blocks = request.result.createObjectStore('blocks', { keyPath: ['path', 'offset', 'version'] });
      blocks.createIndex('version', ['path', 'version']);
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
    request.addEventListener('blocked', () => reject(new Error('Local storage is busy.')));
  });
}

/**
 * Delete every stored block of one local database and of its journal files.
 * The database must be closed first.
 *
 * @param {string} filename as passed to `sqlite.open`, e.g. `panino-space-<id>.db`
 * @param {{ indexedDB?: IDBFactory, IDBKeyRange?: typeof IDBKeyRange }} [environment]
 * @returns {Promise<boolean>} false when there is no IndexedDB to delete from
 */
export async function deleteLocalDatabase(filename, {
  indexedDB = globalThis.indexedDB,
  IDBKeyRange = globalThis.IDBKeyRange,
} = {}) {
  if (!filename || /[/\\]/.test(filename)) throw new Error('A plain database file name is required.');
  if (!indexedDB || !IDBKeyRange) return false;

  const database = await openBlockStore(indexedDB);
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('blocks', 'readwrite');
      const blocks = transaction.objectStore('blocks');
      for (const suffix of SIDECAR_SUFFIXES) {
        const path = `/${filename}${suffix}`;
        // Every key that starts with this path: [path] up to [path, <any>].
        blocks.delete(IDBKeyRange.bound([path], [path, []]));
      }
      transaction.addEventListener('complete', resolve);
      transaction.addEventListener('error', () => reject(transaction.error));
      transaction.addEventListener('abort', () => reject(transaction.error || new Error('Deleting local data was aborted.')));
    });
  } finally {
    database.close();
  }
  return true;
}

/**
 * Drop cached API responses that belong to one space: its images (whose URLs
 * carry the session token), its member list, its revisions. The service worker
 * caches every successful GET under `/api` for offline use.
 *
 * @param {string} spaceId
 * @param {{ caches?: CacheStorage }} [environment]
 * @returns {Promise<number>} responses removed
 */
export async function purgeCachedSpaceResponses(spaceId, { caches = globalThis.caches } = {}) {
  if (!caches || !spaceId) return 0;
  const id = String(spaceId).toLowerCase();
  let removed = 0;
  for (const name of await caches.keys()) {
    if (!name.startsWith('panino-runtime-')) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const url = request.url.toLowerCase();
      if (url.includes(`space=${id}`) || url.includes(`/spaces/${id}`)) {
        if (await cache.delete(request)) removed += 1;
      }
    }
  }
  return removed;
}
