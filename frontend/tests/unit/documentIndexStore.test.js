// @vitest-environment jsdom
// The Document metadata index store (tag-system.md §7): lazy, shared build in pages;
// kept current through the update hook and the after-sync hook; dropped with its database.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { markRaw, nextTick, reactive } from 'vue';

const PERSONAL = 'user:11111111-1111-4111-8111-111111111111';
const SPACE = 'space:22222222-2222-4222-8222-222222222222';

const harness = vi.hoisted(() => ({ syncStore: null, listeners: [] }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => harness.syncStore }));

const { useDocumentIndexStore, INDEX_BUILD_PAGE_SIZE } = await import('@/store/documentIndexStore');

const pkOf = (id) => Array.from(new TextEncoder().encode(id)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
const tagged = (...tags) => `---\ntitle: T\ntags: [${tags.join(', ')}]\n---\n\nBody`;

function fakeDatabase(notes = []) {
    let nextRowid = 1;
    const rows = new Map();
    const hooks = new Set();
    const db = {
        pageReads: 0,
        changedReads: 0,
        onUpdate(callback) {
            hooks.add(callback);
            return () => hooks.delete(callback);
        },
        hookCount: () => hooks.size,
        fire(rowid, table = 'notes') {
            for (const hook of hooks) hook(23, 'main', table, BigInt(rowid));
        },
        insert(id, content, { silent = false } = {}) {
            const rid = nextRowid++;
            rows.set(rid, { id, content });
            if (!silent) db.fire(rid);
            return rid;
        },
        update(id, content, { silent = false } = {}) {
            for (const [rid, row] of rows) {
                if (row.id !== id) continue;
                row.content = content;
                if (!silent) db.fire(rid);
            }
        },
        remove(id) {
            for (const [rid, row] of [...rows]) {
                if (row.id !== id) continue;
                rows.delete(rid);
                db.fire(rid);
            }
        },
        async execO(sql, params = []) {
            const shape = ([rid, row]) => ({ rid, id: row.id, head: row.content.slice(0, 16384) });
            if (sql.includes('WHERE rowid > ?')) {
                db.pageReads += 1;
                const [after, limit] = params;
                return [...rows].filter(([rid]) => rid > after).sort((a, b) => a[0] - b[0]).slice(0, limit).map(shape);
            }
            if (sql.includes('json_each')) {
                db.changedReads += 1;
                const rids = JSON.parse(params[0]);
                const ids = JSON.parse(params[1]);
                return [...rows].filter(([rid, row]) => rids.includes(rid) || ids.includes(row.id)).map(shape);
            }
            return [];
        },
    };
    for (const note of notes) db.insert(note.id, note.content, { silent: true });
    return markRaw(db);
}

function registry(entries) {
    const databases = new Map(entries.map(([dbKey, db]) => [dbKey, { dbKey, kind: dbKey.split(':')[0], db }]));
    harness.listeners = [];
    harness.syncStore = reactive({
        databases,
        repository: (dbKey) => ({ execute: (sql, params) => harness.syncStore.databases.get(dbKey).db.execO(sql, params) }),
        onRemoteChangesApplied: (listener) => harness.listeners.push(listener),
    });
}

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('documentIndexStore', () => {
    it('builds lazily, once, for concurrent callers', async () => {
        const db = fakeDatabase([{ id: 'a', content: tagged('Work') }, { id: 'b', content: 'plain' }]);
        registry([[PERSONAL, db]]);
        const index = useDocumentIndexStore();
        expect(db.pageReads).toBe(0);
        expect(index.entry(PERSONAL, 'a')).toBeNull();

        await Promise.all([index.ensure(PERSONAL), index.ensure(PERSONAL), index.ensure(PERSONAL)]);

        expect(db.pageReads).toBe(1);
        expect(index.isReady(PERSONAL)).toBe(true);
        expect(index.entry(PERSONAL, 'a')).toMatchObject({ tags: ['work'], tagLabels: { work: 'Work' } });
        expect(index.entry(PERSONAL, 'b')).toEqual({ tags: [], tagLabels: {}, properties: {} });
        expect(index.versionOf(PERSONAL)).toBeGreaterThan(0);
        await index.ensure(PERSONAL);
        expect(db.pageReads).toBe(1);
    });

    it('streams rows in pages', async () => {
        const notes = Array.from({ length: INDEX_BUILD_PAGE_SIZE * 2 + 5 }, (_, i) => ({ id: `n${i}`, content: tagged(i % 2 ? 'odd' : 'even') }));
        const db = fakeDatabase(notes);
        registry([[PERSONAL, db]]);
        const index = useDocumentIndexStore();
        await index.ensure(PERSONAL);
        expect(db.pageReads).toBe(3);
        expect(index.tagCounts(PERSONAL)).toEqual(new Map([['even', INDEX_BUILD_PAGE_SIZE + 3], ['odd', INDEX_BUILD_PAGE_SIZE + 2]]));
    });

    it('follows local writes through the update hook: change, insert and delete', async () => {
        const db = fakeDatabase([{ id: 'a', content: tagged('work') }, { id: 'b', content: tagged('work', 'urgent') }]);
        registry([[PERSONAL, db]]);
        const index = useDocumentIndexStore();
        await index.ensure(PERSONAL);
        const before = index.version;

        db.update('a', tagged('later'));
        db.insert('c', tagged('work'));
        db.remove('b');
        await index.settled();

        expect(index.idsWithTags(PERSONAL, ['work'])).toEqual(new Set(['c']));
        expect(index.idsWithTags(PERSONAL, ['later'])).toEqual(new Set(['a']));
        expect(index.entry(PERSONAL, 'b')).toBeNull();
        expect(index.version).toBeGreaterThan(before);
        // One read for the three writes.
        expect(db.changedReads).toBe(1);
    });

    it('ignores writes to other tables', async () => {
        const db = fakeDatabase([{ id: 'a', content: tagged('work') }]);
        registry([[PERSONAL, db]]);
        const index = useDocumentIndexStore();
        await index.ensure(PERSONAL);
        db.fire(1, 'folders');
        await index.settled();
        expect(db.changedReads).toBe(0);
    });

    it('re-reads the Documents of a synced change set even when the hook said nothing', async () => {
        const db = fakeDatabase([{ id: 'a', content: tagged('work') }]);
        registry([[PERSONAL, db]]);
        const index = useDocumentIndexStore();
        await index.ensure(PERSONAL);

        db.update('a', tagged('synced'), { silent: true });
        expect(harness.listeners).toHaveLength(1);
        harness.listeners[0](PERSONAL, [
            { table: 'notes', pk: pkOf('a'), cid: 'content', val: 'x' },
            { table: 'folders', pk: pkOf('f'), cid: 'name', val: 'y' },
        ]);
        await index.settled();

        expect(index.entry(PERSONAL, 'a').tags).toEqual(['synced']);
    });

    it('keeps databases apart and answers nothing for one it has not built', async () => {
        registry([
            [PERSONAL, fakeDatabase([{ id: 'p', content: tagged('work') }])],
            [SPACE, fakeDatabase([{ id: 's', content: tagged('work') }])],
        ]);
        const index = useDocumentIndexStore();
        await index.ensure(PERSONAL);
        expect(index.idsWithTags(PERSONAL, ['work'])).toEqual(new Set(['p']));
        expect(index.idsWithTags(SPACE, ['work'])).toEqual(new Set());
        expect(index.tagCounts(SPACE)).toEqual(new Map());
        await index.ensure(SPACE);
        expect(index.idsWithTags(SPACE, ['work'])).toEqual(new Set(['s']));
    });

    it('drops a database that leaves the registry, and one whose handle was reopened', async () => {
        const spaceDb = fakeDatabase([{ id: 's', content: tagged('work') }]);
        registry([[PERSONAL, fakeDatabase([{ id: 'p', content: tagged('work') }])], [SPACE, spaceDb]]);
        const index = useDocumentIndexStore();
        await index.ensure(PERSONAL);
        await index.ensure(SPACE);
        expect(spaceDb.hookCount()).toBe(1);

        harness.syncStore.databases.delete(SPACE);
        await nextTick();
        expect(index.isReady(SPACE)).toBe(false);
        expect(index.entry(SPACE, 's')).toBeNull();
        expect(spaceDb.hookCount()).toBe(0);

        const reopened = fakeDatabase([{ id: 'p', content: tagged('other') }]);
        harness.syncStore.databases.set(PERSONAL, { dbKey: PERSONAL, kind: 'user', db: reopened });
        await nextTick();
        expect(index.isReady(PERSONAL)).toBe(false);
        await index.ensure(PERSONAL);
        expect(index.entry(PERSONAL, 'p').tags).toEqual(['other']);
    });

    it('takes direct updates and removals once built', async () => {
        registry([[PERSONAL, fakeDatabase([{ id: 'a', content: tagged('work') }])]]);
        const index = useDocumentIndexStore();
        index.noteChanged(PERSONAL, 'a', tagged('ignored'));
        await index.ensure(PERSONAL);
        expect(index.entry(PERSONAL, 'a').tags).toEqual(['work']);
        index.noteChanged(PERSONAL, 'a', tagged('direct'));
        expect(index.entry(PERSONAL, 'a').tags).toEqual(['direct']);
        index.noteRemoved(PERSONAL, 'a');
        expect(index.entry(PERSONAL, 'a')).toBeNull();
    });

    it('lists property keys and values', async () => {
        registry([[PERSONAL, fakeDatabase([
            { id: 'a', content: '---\nstatus: draft\n---\n' },
            { id: 'b', content: '---\nStatus: "draft"\nowner: Sam\n---\n' },
        ])]]);
        const index = useDocumentIndexStore();
        await index.ensure(PERSONAL);
        expect(index.propertyKeys(PERSONAL)).toEqual([{ key: 'Status', count: 2 }, { key: 'owner', count: 1 }]);
        expect(index.propertyValues(PERSONAL, 'status')).toEqual([{ value: 'draft', count: 2 }]);
    });

    it('resolves ensure without being ready when the handle is replaced mid-build', async () => {
        registry([[PERSONAL, fakeDatabase([{ id: 'a', content: tagged('work') }])]]);
        const index = useDocumentIndexStore();
        const building = index.ensure(PERSONAL);
        // The database is reopened before the build reads its first page.
        harness.syncStore.databases.set(PERSONAL, { dbKey: PERSONAL, kind: 'user', db: fakeDatabase([]) });
        await nextTick();
        await building;
        expect(index.isReady(PERSONAL)).toBe(false);
        expect(index.idsWithTags(PERSONAL, ['work'])).toEqual(new Set());
    });

    it('lists the Documents with metadata for search, and nothing before the build', async () => {
        registry([[PERSONAL, fakeDatabase([
            { id: 'a', content: '---\nstatus: draft\n---\n' },
            { id: 'b', content: 'no front matter' },
            { id: 'c', content: tagged('work') },
        ])]]);
        const index = useDocumentIndexStore();
        expect([...index.metadataEntries(PERSONAL)]).toEqual([]);
        await index.ensure(PERSONAL);
        const entries = new Map(index.metadataEntries(PERSONAL));
        expect([...entries.keys()].sort()).toEqual(['a', 'c']);
        expect(entries.get('a').properties).toEqual({ status: 'draft' });
        expect(entries.get('c').tags).toEqual(['work']);
    });

    it('rejects a database that is not open, and can build after a failure', async () => {
        const db = fakeDatabase([{ id: 'a', content: tagged('work') }]);
        registry([[PERSONAL, db]]);
        const index = useDocumentIndexStore();
        await expect(index.ensure(SPACE)).rejects.toThrow();
        const original = db.execO;
        db.execO = async () => { throw new Error('busy'); };
        await expect(index.ensure(PERSONAL)).rejects.toThrow('busy');
        db.execO = original;
        await index.ensure(PERSONAL);
        expect(index.isReady(PERSONAL)).toBe(true);
    });
});
