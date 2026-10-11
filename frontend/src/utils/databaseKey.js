import { validate as validateUuid } from 'uuid';

export const DATABASE_KINDS = Object.freeze({
  USER: 'user',
  SPACE: 'space',
});

/**
 * Build the only accepted database identifier shape.
 *
 * @param {'user'|'space'} kind
 * @param {string} id
 * @returns {string}
 */
export function createDatabaseKey(kind, id) {
  if (!Object.values(DATABASE_KINDS).includes(kind) || !validateUuid(id)) {
    throw new Error('Database scope must be a canonical user:<uuid> or space:<uuid> key.');
  }
  return `${kind}:${id.toLowerCase()}`;
}

/**
 * Parse and validate a canonical database key without accepting bare IDs.
 *
 * @param {string} dbKey
 * @returns {{ dbKey: string, kind: 'user'|'space', id: string }}
 */
export function parseDatabaseKey(dbKey) {
  if (typeof dbKey !== 'string') {
    throw new Error('Database scope is required.');
  }
  const separator = dbKey.indexOf(':');
  if (separator <= 0 || separator !== dbKey.lastIndexOf(':')) {
    throw new Error('Database scope must be a canonical user:<uuid> or space:<uuid> key.');
  }
  const kind = dbKey.slice(0, separator);
  const id = dbKey.slice(separator + 1);
  const canonical = createDatabaseKey(kind, id);
  if (canonical !== dbKey) {
    throw new Error('Database scope must use its canonical lowercase key.');
  }
  return { dbKey, kind, id };
}

/**
 * The browser's SQLite file system (wa-sqlite) refuses a path longer than 64
 * characters, and SQLite derives `<name>-journal` from the name. With the
 * leading slash and that suffix, a file name may be at most 55 characters.
 */
export const MAX_LOCAL_DATABASE_NAME_LENGTH = 55;

/**
 * Return a stable browser database filename for one canonical database key.
 * Existing personal database names deliberately remain unchanged.
 *
 * A space's file also carries the account it belongs to. Named by space alone,
 * a second account signing in on the same browser opened the first account's
 * replica and uploaded that account's pending edits under its own name. Two
 * full UUIDs do not fit the length limit above (the database then fails to
 * open at all), so the name holds the space id without dashes and the first
 * twelve hex digits of the account id.
 *
 * @param {string} dbKey
 * @param {string} [accountUserId] required for a space
 * @returns {string}
 */
export function localDatabaseName(dbKey, accountUserId) {
  const { kind, id } = parseDatabaseKey(dbKey);
  if (kind === DATABASE_KINDS.USER) return `panino-${id}.db`;
  if (!validateUuid(accountUserId || '')) {
    throw new Error('A space database belongs to an account; its user id is required.');
  }
  const compact = (uuid) => uuid.toLowerCase().replace(/-/g, '');
  return `pn-s-${compact(id)}-${compact(accountUserId).slice(0, 12)}.db`;
}

/** The name a space's file had before it was tied to an account. Only for cleaning it up. */
export function legacySpaceDatabaseName(dbKey) {
  const { kind, id } = parseDatabaseKey(dbKey);
  if (kind !== DATABASE_KINDS.SPACE) throw new Error('Only a space has a legacy file name.');
  return `panino-space-${id}.db`;
}

/**
 * Phase 4 adapter for APIs whose space-qualified routes do not exist until
 * Phase 6. The explicit scope prevents a shared node from hitting a plausible
 * personal endpoint.
 */
export function requirePersonalDatabaseKey(dbKey, operation = 'This operation') {
  const parsed = parseDatabaseKey(dbKey);
  if (parsed.kind !== DATABASE_KINDS.USER) {
    throw new Error(`${operation} is not available for shared-space Documents yet.`);
  }
  return parsed.dbKey;
}
