// @vitest-environment jsdom
// Tag styling and the tag filter (tag-system.md §4, §5): one-column writes, the
// display-name rule, the renderer's fallbacks for another client's rows, the filter
// across databases with Trash left out and sorting after the merge, and suggestions.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { markRaw, nextTick, reactive } from 'vue';

const PERSONAL = 'user:11111111-1111-4111-8111-111111111111';
const SPACE = 'space:22222222-2222-4222-8222-222222222222';

const harness = vi.hoisted(() => ({ syncStore: null, listeners: [], index: null }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => harness.syncStore }));
vi.mock('@/store/documentIndexStore', () => ({ useDocumentIndexStore: () => harness.index }));

const { useTagStore } = await import('@/store/tagStore');

/** A database holding `tags` rows, Documents and folders, recording writes. */
function fakeDatabase({ tags = [], notes = [], folders = [] } = {}) {
    const state = { tags: new Map(tags.map((row) => [row.name, { display_name: '', color: '', created_at: '', updated_at: '', ...row }])), notes, folders, writes: [] };
    return markRaw({
        state,
        async execO(sql, params = []) {
            if (sql.includes('FROM tags')) return [...state.tags.values()];
            if (sql.includes('FROM folders')) return state.folders;
            if (sql.includes('FROM notes')) {
                const ids = JSON.parse(params[0]);
                return state.notes.filter((note) => ids.includes(note.id));
            }
            return [];
        },
        async exec(sql, params = []) {
            state.writes.push({ sql, params });
            if (sql.startsWith('DELETE FROM tags')) state.tags.delete(params[0]);
            else if (sql.includes('INSERT INTO tags (name, color')) {
                const row = state.tags.get(params[0]) || { name: params[0], display_name: '', created_at: params[2] };
                state.tags.set(params[0], { ...row, color: params[1], updated_at: params[3] });
            } else if (sql.includes('INSERT INTO tags (name, display_name')) {
                const row = state.tags.get(params[0]) || { name: params[0], color: '', created_at: params[2] };
                state.tags.set(params[0], { ...row, display_name: params[1], updated_at: params[3] });
            }
        },
    });
}

function setup(databases, tagsByDb = {}) {
    harness.listeners = [];
    const entries = new Map(databases.map(([dbKey, db, name]) => [dbKey, { dbKey, kind: dbKey.split(':')[0], name, db }]));
    harness.syncStore = reactive({
        personalDbKey: PERSONAL,
        databases: entries,
        repository: (dbKey) => {
            const db = harness.syncStore.databases.get(dbKey).db;
            return {
                execute: (sql, params) => db.execO(sql, params),
                transaction: async (work) => work({ exec: (sql, params) => db.exec(sql, params), execute: (sql, params) => db.execO(sql, params) }),
            };
        },
        onRemoteChangesApplied: (listener) => harness.listeners.push(listener),
    });
    harness.index = {
        ensure: vi.fn(async () => {}),
        idsWithTags: (dbKey, names) => new Set(Object.entries(tagsByDb[dbKey] || {})
            .filter(([, tags]) => names.every((name) => tags.includes(name))).map(([id]) => id)),
        tagCounts: (dbKey) => {
            const counts = new Map();
            for (const tags of Object.values(tagsByDb[dbKey] || {})) for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
            return counts;
        },
        tagLabel: (_dbKey, name) => (name === 'q3 plan' ? 'Q3 Plan' : null),
    };
}

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('tag styles', () => {
    it('writes the colour column only, then the display name column only', async () => {
        const db = fakeDatabase();
        setup([[PERSONAL, db]]);
        const store = useTagStore();
        await store.setColor(PERSONAL, ' Work ', 'coral');
        await store.setDisplayName(PERSONAL, 'work', 'WORK');

        expect(db.state.writes[0].sql).toContain('DO UPDATE SET color = excluded.color, updated_at');
        expect(db.state.writes[0].sql).not.toContain('display_name');
        expect(db.state.writes[0].params.slice(0, 2)).toEqual(['work', 'coral']);
        expect(db.state.writes[1].sql).toContain('DO UPDATE SET display_name = excluded.display_name, updated_at');
        expect(db.state.writes[1].sql).not.toMatch(/SET .*color/);
        expect(store.tagLook(PERSONAL, 'work')).toMatchObject({ label: 'WORK', colorKey: 'coral', hex: '#c15f4b', styled: true });
    });

    it('refuses an unknown colour, an empty name and a display name of another tag', async () => {
        setup([[PERSONAL, fakeDatabase()]]);
        const store = useTagStore();
        await expect(store.setColor(PERSONAL, 'work', '#ff0000')).rejects.toThrow();
        await expect(store.setColor(PERSONAL, '  ', 'coral')).rejects.toThrow();
        await expect(store.setDisplayName(PERSONAL, 'work', 'Job')).rejects.toThrow(/capitals/);
        await expect(store.setDisplayName(PERSONAL, 'work', 'x'.repeat(60))).rejects.toThrow();
    });

    it('resets a tag by deleting its row; Documents are not written', async () => {
        const db = fakeDatabase({ tags: [{ name: 'work', color: 'coral' }] });
        setup([[PERSONAL, db]]);
        const store = useTagStore();
        await store.loadStyles(PERSONAL);
        await store.resetTag(PERSONAL, 'Work');
        expect(db.state.writes).toEqual([{ sql: 'DELETE FROM tags WHERE name = ?', params: ['work'] }]);
        expect(store.tagLook(PERSONAL, 'work')).toMatchObject({ colorKey: 'neutral', styled: false });
        expect(db.state.writes.every((write) => !write.sql.includes('notes'))).toBe(true);
    });

    it('draws another client\'s unknown colour as neutral and ignores a display name of another tag', async () => {
        const db = fakeDatabase({ tags: [
            { name: 'work', color: 'javascript:alert(1)', display_name: 'Job' },
            { name: 'Bad Key', color: 'coral' },
        ] });
        setup([[PERSONAL, db]]);
        const store = useTagStore();
        await store.loadStyles(PERSONAL);
        expect(store.tagLook(PERSONAL, 'work', 'Work')).toMatchObject({ label: 'Work', colorKey: 'neutral', hex: '#7a736d' });
        expect(store.styleRow(PERSONAL, 'Bad Key')).toBeNull();
        expect(store.tagLook(PERSONAL, 'q3 plan').label).toBe('Q3 Plan');
        expect(store.tagLook(PERSONAL, 'other').label).toBe('other');
    });

    it('keeps each database\'s colours: a space styles a tag differently from personal', async () => {
        setup([
            [PERSONAL, fakeDatabase({ tags: [{ name: 'work', color: 'coral' }] })],
            [SPACE, fakeDatabase({ tags: [{ name: 'work', color: 'seafoam' }] }), 'Team'],
        ]);
        const store = useTagStore();
        await Promise.all([store.loadStyles(PERSONAL), store.loadStyles(SPACE)]);
        expect(store.tagLook(PERSONAL, 'work').colorKey).toBe('coral');
        expect(store.tagLook(SPACE, 'work').colorKey).toBe('seafoam');
    });

    it('reloads a database\'s styles after a sync that changed them', async () => {
        const db = fakeDatabase({ tags: [{ name: 'work', color: 'coral' }] });
        setup([[SPACE, db, 'Team']]);
        const store = useTagStore();
        await store.loadStyles(SPACE);
        db.state.tags.set('work', { name: 'work', color: 'mint', display_name: '' });
        harness.listeners[0](SPACE, [{ table: 'notes' }]);
        await Promise.resolve();
        expect(store.tagLook(SPACE, 'work').colorKey).toBe('coral');
        harness.listeners[0](SPACE, [{ table: 'tags', cid: 'color' }]);
        await vi.waitFor(() => expect(store.tagLook(SPACE, 'work').colorKey).toBe('mint'));
    });

    it('lists styled and found tags with counts, and ranks suggestions', async () => {
        setup([[PERSONAL, fakeDatabase({ tags: [{ name: 'urgent', color: 'coral' }, { name: 'unused', color: 'seafoam' }] })]], {
            [PERSONAL]: { a: ['work', 'urgent'], b: ['work'], c: ['wonder'] },
        });
        const store = useTagStore();
        await store.loadStyles(PERSONAL);
        expect(store.listTags(PERSONAL).map((tag) => [tag.name, tag.count, tag.styled])).toEqual([
            ['unused', 0, true],
            ['urgent', 1, true],
            ['wonder', 1, false],
            ['work', 2, false],
        ]);
        expect(store.suggestions(PERSONAL, '').map((tag) => tag.name)).toEqual(['urgent', 'unused', 'work', 'wonder']);
        expect(store.suggestions(PERSONAL, 'wo').map((tag) => tag.name)).toEqual(['work', 'wonder']);
        expect(store.suggestions(PERSONAL, 'r').map((tag) => tag.name)).toEqual(['urgent', 'work', 'wonder']);
        expect(store.suggestions(PERSONAL, 'u', { exclude: ['urgent'] }).map((tag) => tag.name)).toEqual(['unused']);
        expect(store.suggestions(PERSONAL, 'work').map((tag) => tag.name)).toEqual([]);
    });
});

describe('tag filter', () => {
    it('keeps canonical filters without duplicates', () => {
        setup([[PERSONAL, fakeDatabase()]]);
        const store = useTagStore();
        store.addFilter(' Work ');
        store.addFilter('work');
        store.addFilter('URGENT');
        store.addFilter('');
        expect(store.filters).toEqual(['work', 'urgent']);
        store.removeFilter('work');
        expect(store.filters).toEqual(['urgent']);
        store.clearFilters();
        expect(store.hasFilters).toBe(false);
    });

    it('finds Documents with every tag across databases, newest first after the merge, without Trash', async () => {
        const personal = fakeDatabase({
            folders: [
                { id: 'trash', name: ' trash ', parent_id: null, created_at: '2026-01-01' },
                { id: 'old', name: 'Inside', parent_id: 'trash', created_at: '2026-01-02' },
                { id: 'proj', name: 'Projects', parent_id: null, created_at: '2026-01-03' },
            ],
            notes: [
                { id: 'p1', title: 'Plan', updated_at: '2026-11-01T10:00:00.000Z', folder_id: 'proj' },
                { id: 'p2', title: 'Old', updated_at: '2026-11-07T10:00:00.000Z', folder_id: 'old' },
                { id: 'p3', title: 'Root', updated_at: '2026-11-03T10:00:00.000Z', folder_id: null },
            ],
        });
        const space = fakeDatabase({
            notes: [
                { id: 's1', title: 'Team', updated_at: '2026-11-05T10:00:00.000Z', folder_id: null },
                { id: 's2', title: 'Only work', updated_at: '2026-11-08T10:00:00.000Z', folder_id: null },
            ],
        });
        setup([[PERSONAL, personal], [SPACE, space, 'Team space']], {
            [PERSONAL]: { p1: ['work', 'urgent'], p2: ['work', 'urgent'], p3: ['work', 'urgent'] },
            [SPACE]: { s1: ['urgent', 'work'], s2: ['work'] },
        });
        const store = useTagStore();
        const rows = await store.findTaggedDocuments(['work', 'urgent']);
        expect(rows.map((row) => [row.id, row.dbKey, row.spaceName, row.folderPath])).toEqual([
            ['s1', SPACE, 'Team space', ''],
            ['p3', PERSONAL, null, ''],
            ['p1', PERSONAL, null, 'Projects'],
        ]);
        expect(harness.index.ensure).toHaveBeenCalledWith(PERSONAL);
        expect(harness.index.ensure).toHaveBeenCalledWith(SPACE);
        expect(await store.findTaggedDocuments([])).toEqual([]);
    });

    it('opens the manager on an open database, else on personal', () => {
        setup([[PERSONAL, fakeDatabase()], [SPACE, fakeDatabase(), 'Team']]);
        const store = useTagStore();
        store.openManager(SPACE);
        expect([store.managerOpen, store.managerDbKey]).toEqual([true, SPACE]);
        store.openManager('space:33333333-3333-4333-8333-333333333333');
        expect(store.managerDbKey).toBe(PERSONAL);
        store.closeManager();
        expect(store.managerOpen).toBe(false);
    });

    it('forgets the filters when another account signs in', async () => {
        setup([[PERSONAL, fakeDatabase()]]);
        const store = useTagStore();
        store.addFilter('work');
        harness.syncStore.personalDbKey = 'user:33333333-3333-4333-8333-333333333333';
        await nextTick();
        expect(store.filters).toEqual([]);
    });

    it('removes the row when Neutral is chosen for a tag with no display name', async () => {
        const db = fakeDatabase({ tags: [{ name: 'work', color: 'coral' }] });
        setup([[PERSONAL, db]]);
        const store = useTagStore();
        await store.loadStyles(PERSONAL, { force: true });
        await store.setColor(PERSONAL, 'work', '');
        expect(db.state.writes.at(-1).sql).toMatch(/^DELETE FROM tags/);
        expect(db.state.tags.has('work')).toBe(false);
    });
});
