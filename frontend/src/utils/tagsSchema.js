/**
 * The browser side of the `tags` CRR (docs/specs/active/tag-system.md §4, §6.2).
 * `DB_SCHEMA` in `syncStore.js` creates and registers the table; this repairs a
 * table an earlier build created, as `ensureTagsSchema` in the API's `db.js`
 * does on the server.
 */

/** The `tags` columns after `name`. Every one needs a default (CR-SQLite). */
export const TAGS_COLUMNS = Object.freeze({
    display_name: "TEXT NOT NULL DEFAULT ''",
    color: "TEXT NOT NULL DEFAULT ''",
    created_at: "TEXT NOT NULL DEFAULT ''",
    updated_at: "TEXT NOT NULL DEFAULT ''",
});

/** The statements `DB_SCHEMA` runs for the table. */
export const TAGS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tags (
  name TEXT PRIMARY KEY NOT NULL,
  ${Object.entries(TAGS_COLUMNS).map(([column, type]) => `${column} ${type}`).join(',\n  ')}
);
SELECT crsql_as_crr('tags');
`;

async function crrUpdateTriggerSql(database, table) {
    const rows = await database.execO(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
        [`${table}__crsql_utrig`],
    );
    return rows?.[0]?.sql;
}

/**
 * Add a column the local `tags` table lacks, through `crsql_begin_alter` /
 * `crsql_commit_alter` when it is a CRR (a bare `ALTER` leaves CR-SQLite's
 * triggers bound to the old column count), rebuild stale triggers, and register
 * the table if it is not a CRR. Column names come from {@link TAGS_COLUMNS}.
 * @param {{ exec: Function, execO: Function }} database a CR-SQLite handle
 */
export async function ensureTagsSchema(database) {
    if (!database) throw new Error('Database scope is required for schema initialization.');
    try {
        const columns = await database.execO("PRAGMA table_info('tags')");
        if (!columns || columns.length === 0) return;

        const names = new Set(columns.map((column) => column.name));
        const triggerSql = await crrUpdateTriggerSql(database, 'tags');
        const isCrr = Boolean(triggerSql);
        const required = Object.keys(TAGS_COLUMNS);
        const missing = required.filter((column) => !names.has(column));

        if (missing.length > 0) {
            if (isCrr) await database.exec("SELECT crsql_begin_alter('tags')");
            try {
                for (const column of missing) {
                    await database.exec(`ALTER TABLE tags ADD COLUMN ${column} ${TAGS_COLUMNS[column]}`);
                }
            } finally {
                if (isCrr) await database.exec("SELECT crsql_commit_alter('tags')");
            }
            if (!isCrr) await database.exec("SELECT crsql_as_crr('tags')");
            return;
        }

        if (isCrr && !required.every((column) => triggerSql.includes(column))) {
            await database.exec("SELECT crsql_begin_alter('tags')");
            await database.exec("SELECT crsql_commit_alter('tags')");
            return;
        }

        if (!isCrr) await database.exec("SELECT crsql_as_crr('tags')");
    } catch (error) {
        console.error('[syncStore] Failed to ensure tags schema', error);
    }
}
