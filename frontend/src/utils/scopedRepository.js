import { parseDatabaseKey } from './databaseKey.js';

const exclusiveQueues = new Map();

/**
 * Run `work` once every earlier exclusive section on this database has
 * finished. Every `BEGIN … COMMIT` on a database shares one connection, and
 * SQLite refuses a `BEGIN` while another transaction is open on it. Without
 * this queue an editor save that started while sync was applying remote rows
 * failed with "cannot start a transaction within a transaction" and was simply
 * dropped. Callers must not start another exclusive section on the same
 * database from inside `work`: it would wait for itself.
 *
 * @template T
 * @param {string} dbKey
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export function runExclusive(dbKey, work) {
  const previous = exclusiveQueues.get(dbKey) || Promise.resolve();
  const run = previous.then(work, work);
  const settled = run.then(() => {}, () => {});
  exclusiveQueues.set(dbKey, settled);
  settled.then(() => {
    if (exclusiveQueues.get(dbKey) === settled) exclusiveQueues.delete(dbKey);
  });
  return run;
}

/**
 * Create a repository that can never silently change database scope.
 *
 * @param {string} dbKey
 * @param {(dbKey:string) => {exec:Function,execO:Function}} resolveDatabase
 */
export function createScopedRepository(dbKey, resolveDatabase) {
  parseDatabaseKey(dbKey);
  if (typeof resolveDatabase !== 'function') {
    throw new Error('A scoped database resolver is required.');
  }

  const database = () => {
    const resolved = resolveDatabase(dbKey);
    if (!resolved) throw new Error(`Database scope ${dbKey} is not initialized.`);
    return resolved;
  };

  return Object.freeze({
    dbKey,
    execute(sql, params = []) {
      return database().execO(sql, params);
    },
    exec(sql, params = []) {
      return database().exec(sql, params);
    },
    transaction(work) {
      return runExclusive(dbKey, async () => {
        const db = database();
        await db.exec('BEGIN');
        try {
          const result = await work({
            dbKey,
            execute: (sql, params = []) => db.execO(sql, params),
            exec: (sql, params = []) => db.exec(sql, params),
          });
          await db.exec('COMMIT');
          return result;
        } catch (error) {
          await db.exec('ROLLBACK');
          throw error;
        }
      });
    },
  });
}
