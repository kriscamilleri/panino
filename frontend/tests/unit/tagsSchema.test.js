// The browser's `tags` table (tag-system.md §6): what it uploads to a space, and the
// repair it runs for each table shape.
import { describe, expect, it, vi } from 'vitest';
import { TAGS_COLUMNS, TAGS_SCHEMA_SQL, ensureTagsSchema } from '@/utils/tagsSchema';
import { projectSpaceOutgoingChanges } from '@/utils/syncRegistry';

function database({ columns, trigger }) {
    const statements = [];
    return {
        statements,
        execO: vi.fn(async (sql) => {
            if (sql.includes("PRAGMA table_info('tags')")) return columns.map((name) => ({ name }));
            if (sql.includes('sqlite_master')) return trigger ? [{ sql: trigger }] : [];
            return [];
        }),
        exec: vi.fn(async (sql) => { statements.push(sql); }),
    };
}

const ALL = ['name', ...Object.keys(TAGS_COLUMNS)];

describe('tags in a space', () => {
    it('uploads every tags column and its reset to a space, and nothing the server refuses', () => {
        // The client's projection mirrors the server allowlist; a column left out
        // here is never uploaded, and the push cursor moves past it for good.
        const changes = [
            ...ALL.map((cid) => ({ table: 'tags', cid, val: 'x' })),
            { table: 'tags', cid: '-1', val: null },
            { table: 'tags', cid: 'user_id', val: 'u1' },
        ];
        expect(projectSpaceOutgoingChanges(changes)).toEqual(changes.slice(0, ALL.length + 1));
    });
});

describe('ensureTagsSchema', () => {
    it('creates and registers the table from DB_SCHEMA with defaults on every column', () => {
        expect(TAGS_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS tags');
        expect(TAGS_SCHEMA_SQL).toContain("SELECT crsql_as_crr('tags')");
        for (const type of Object.values(TAGS_COLUMNS)) expect(type).toMatch(/NOT NULL DEFAULT ''/);
    });

    it('does nothing for a healthy CRR or a missing table', async () => {
        const healthy = database({ columns: ALL, trigger: `CREATE TRIGGER x ${ALL.join(' ')}` });
        await ensureTagsSchema(healthy);
        expect(healthy.statements).toEqual([]);
        const missing = database({ columns: [], trigger: null });
        await ensureTagsSchema(missing);
        expect(missing.statements).toEqual([]);
    });

    it('adds missing columns between begin and commit alter on a CRR', async () => {
        const db = database({ columns: ['name', 'color'], trigger: 'CREATE TRIGGER x name color' });
        await ensureTagsSchema(db);
        expect(db.statements).toEqual([
            "SELECT crsql_begin_alter('tags')",
            "ALTER TABLE tags ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE tags ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE tags ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''",
            "SELECT crsql_commit_alter('tags')",
        ]);
    });

    it('rebuilds stale triggers and registers a table that is not a CRR', async () => {
        const stale = database({ columns: ALL, trigger: 'CREATE TRIGGER x name color' });
        await ensureTagsSchema(stale);
        expect(stale.statements).toEqual(["SELECT crsql_begin_alter('tags')", "SELECT crsql_commit_alter('tags')"]);
        const plain = database({ columns: ['name', 'color'], trigger: null });
        await ensureTagsSchema(plain);
        expect(plain.statements.at(-1)).toBe("SELECT crsql_as_crr('tags')");
        expect(plain.statements).not.toContain("SELECT crsql_begin_alter('tags')");
    });
});
