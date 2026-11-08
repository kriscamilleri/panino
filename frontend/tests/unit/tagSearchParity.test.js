// `tag:` in search and the sidebar's tag filter bar give the same Documents for the same tags
// (advanced-search.md §4, tag-system.md §5.2): the real `tagStore.findTaggedDocuments` and the
// search engine over the same two SQLite databases and the same metadata index, with a
// Document in a Trash subfolder that both leave out.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import { PERSONAL_LABELS, searchDatabases } from '@panino/content-merge/document-search';
import { DocumentMetadataIndex } from '@/utils/documentMetadataIndex';

const PERSONAL = 'user:11111111-1111-4111-8111-111111111111';
const SPACE = 'space:22222222-2222-4222-8222-222222222222';
const harness = vi.hoisted(() => ({ syncStore: null, indexes: new Map() }));

vi.mock('@/store/syncStore', () => ({ useSyncStore: () => harness.syncStore }));
vi.mock('@/store/documentIndexStore', () => ({
    useDocumentIndexStore: () => ({
        version: 0,
        ensure: async () => {},
        isReady: () => true,
        idsWithTags: (dbKey, names) => harness.indexes.get(dbKey).idsWithTags(names),
        metadataEntries: (dbKey) => harness.indexes.get(dbKey).documents(),
        tagCounts: (dbKey) => harness.indexes.get(dbKey).tagCounts(),
        tagLabel: (dbKey, name) => harness.indexes.get(dbKey).tagLabel(name),
    }),
}));

const { useTagStore } = await import('@/store/tagStore');

function sqlite({ folders = [], notes = [] }) {
    const db = new DatabaseSync(':memory:');
    db.exec(`
        CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, created_at TEXT);
        CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, content TEXT, folder_id TEXT,
                            created_at TEXT, updated_at TEXT, pinned INTEGER DEFAULT 0);
        CREATE TABLE tags (name TEXT PRIMARY KEY, display_name TEXT, color TEXT, created_at TEXT, updated_at TEXT);
    `);
    for (const [id, name, parent = null] of folders) db.prepare('INSERT INTO folders VALUES (?, ?, ?, ?)').run(id, name, parent, '2026-01-01T00:00:00.000Z');
    for (const note of notes) {
        db.prepare('INSERT INTO notes (id, title, content, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(note.id, note.title, note.content, note.folder ?? null, '2026-10-01T00:00:00.000Z', note.updated);
    }
    return db;
}

const fm = (tags, body = 'body') => `---\ntags: [${tags.join(', ')}]\n---\n${body}`;
const day = (n) => `2026-11-${String(n).padStart(2, '0')}T10:00:00.000Z`;

beforeEach(() => {
    setActivePinia(createPinia());
    const personal = sqlite({
        folders: [['f-trash', 'Trash'], ['f-old', 'Old', 'f-trash'], ['f-work', 'Work']],
        notes: [
            { id: 'p1', title: 'Plan', content: fm(['Urgent', 'work']), folder: 'f-work', updated: day(1) },
            { id: 'p2', title: 'Review', content: fm(['urgent']), updated: day(2) },
            { id: 'p3', title: 'Buried', content: fm(['urgent', 'work']), folder: 'f-old', updated: day(3) },
            { id: 'p4', title: 'Plain', content: 'no tags', updated: day(4) },
        ],
    });
    const space = sqlite({
        folders: [['s-trash', ' trash ']],
        notes: [
            { id: 's1', title: 'Team', content: fm(['work', 'URGENT']), updated: day(5) },
            { id: 's2', title: 'Binned', content: fm(['urgent', 'work']), folder: 's-trash', updated: day(6) },
        ],
    });
    const handles = new Map([[PERSONAL, personal], [SPACE, space]]);
    harness.indexes = new Map();
    for (const [dbKey, db] of handles) {
        const index = new DocumentMetadataIndex();
        for (const row of db.prepare('SELECT id, content FROM notes').all()) index.set(row.id, row.content);
        harness.indexes.set(dbKey, index);
    }
    harness.syncStore = reactive({
        personalDbKey: PERSONAL,
        databases: new Map([
            [PERSONAL, { dbKey: PERSONAL, kind: 'user', db: {} }],
            [SPACE, { dbKey: SPACE, kind: 'space', name: 'Acme Team', db: {} }],
        ]),
        repository: (dbKey) => ({ execute: async (sql, params = []) => handles.get(dbKey).prepare(sql).all(...params) }),
    });
    harness.handles = handles;
});

function searchable() {
    return [...harness.handles].map(([dbKey, db]) => ({
        dbKey,
        name: dbKey === SPACE ? 'Acme Team' : null,
        labels: dbKey === SPACE ? ['Acme Team'] : [...PERSONAL_LABELS],
        execute: (sql, params = []) => db.prepare(sql).all(...params),
        index: async () => ({
            entries: () => harness.indexes.get(dbKey).documents(),
            idsWithTags: (names) => harness.indexes.get(dbKey).idsWithTags(names),
        }),
    }));
}

describe('tag: and the sidebar filter bar', () => {
    for (const names of [['urgent'], ['work'], ['urgent', 'work'], ['nothing']]) {
        it(`give the same Documents for ${names.join(' + ')}`, async () => {
            const bar = await useTagStore().findTaggedDocuments(names);
            const found = await searchDatabases({ databases: searchable(), query: names.map((name) => `tag:${name}`).join(' '), limit: 100 });
            if (names[0] !== 'nothing') expect(bar.length).toBeGreaterThan(0);
            expect(found.results.map((row) => row.id).sort()).toEqual(bar.map((row) => row.id).sort());
            // Neither shows the Documents in Trash or below it.
            expect(found.results.map((row) => row.id)).not.toContain('p3');
            expect(found.results.map((row) => row.id)).not.toContain('s2');
        });
    }

    it('finds the Trash ones with in:Trash, which the bar never shows', async () => {
        const found = await searchDatabases({ databases: searchable(), query: 'tag:urgent tag:work in:Trash', limit: 100 });
        expect(found.results.map((row) => row.id).sort()).toEqual(['p3', 's2']);
    });
});
