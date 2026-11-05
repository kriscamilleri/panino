/**
 * The GitHub add-on's table, registered through its manifest (index.js) and
 * created by db.js when a user database opens. Server-only: never a CRR, never
 * in the browser schema. The table keeps its pre-add-on name, `backup_config`,
 * so existing connections carry over.
 */

/** User databases only. */
export const GITHUB_USER_SCHEMA = `
  -- The user's GitHub connection and backup state (backup.js). The token is
  -- AES-256-GCM encrypted (core secrets.js).
  CREATE TABLE IF NOT EXISTS backup_config (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL UNIQUE,
    access_token_enc TEXT,
    username TEXT,
    avatar_url TEXT,
    repo_full_name TEXT,
    auto_backup_enabled INTEGER NOT NULL DEFAULT 1,
    last_backup_at TEXT,
    last_backup_sha TEXT,
    last_warning TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL
  );
`;

/** Columns added after the table first shipped, with the SQL that adds each. */
const LATER_COLUMNS = [
  ['provider', [
    "ALTER TABLE backup_config ADD COLUMN provider TEXT NOT NULL DEFAULT 'github'",
    "UPDATE backup_config SET provider = 'github' WHERE provider IS NULL OR provider = ''",
  ]],
  ['access_token_enc', ['ALTER TABLE backup_config ADD COLUMN access_token_enc TEXT']],
  ['username', ['ALTER TABLE backup_config ADD COLUMN username TEXT']],
  ['avatar_url', ['ALTER TABLE backup_config ADD COLUMN avatar_url TEXT']],
  ['repo_full_name', ['ALTER TABLE backup_config ADD COLUMN repo_full_name TEXT']],
  ['auto_backup_enabled', [
    'ALTER TABLE backup_config ADD COLUMN auto_backup_enabled INTEGER NOT NULL DEFAULT 1',
    'UPDATE backup_config SET auto_backup_enabled = 1 WHERE auto_backup_enabled IS NULL',
  ]],
  ['last_backup_at', ['ALTER TABLE backup_config ADD COLUMN last_backup_at TEXT']],
  ['last_backup_sha', ['ALTER TABLE backup_config ADD COLUMN last_backup_sha TEXT']],
  ['last_warning', ['ALTER TABLE backup_config ADD COLUMN last_warning TEXT']],
  ['last_error', ['ALTER TABLE backup_config ADD COLUMN last_error TEXT']],
  // SQLite refuses a non-constant default in ADD COLUMN, so fill it in afterwards.
  ['created_at', [
    "ALTER TABLE backup_config ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
    "UPDATE backup_config SET created_at = datetime('now') WHERE created_at IS NULL OR created_at = ''",
  ]],
];

/**
 * schema.upgrade: bring an older `backup_config` up to date, then switch the
 * add-on on for a user who connected GitHub before backup became an add-on,
 * so their daily backup keeps running. INSERT OR IGNORE leaves any switch the
 * user has set, on or off, alone; a user with no connection stays off.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {'user' | 'space'} kind
 */
export function upgradeGithubSchema(db, kind) {
  if (kind !== 'user') return;
  const names = new Set(db.prepare("PRAGMA table_info('backup_config')").all().map((column) => column.name));
  for (const [name, statements] of LATER_COLUMNS) {
    if (names.has(name)) continue;
    for (const statement of statements) db.exec(statement);
  }
  db.prepare(`
    INSERT OR IGNORE INTO addons (addon_id, enabled, enabled_at)
    SELECT 'github', 1, ?
    WHERE EXISTS (SELECT 1 FROM backup_config WHERE provider = 'github' AND access_token_enc IS NOT NULL)
  `).run(new Date().toISOString());
}
