// The app's search engine (`@panino/content-merge/document-search`, docs/specs/active/
// advanced-search.md §6.2) against real SQLite databases: Node's built-in `node:sqlite` stands in
// for CR-SQLite WASM, with the columns search reads. Two databases, a personal one and a space,
// check the merge order, paging, Trash, `in:` naming a space, full checklist pages, folding of
// every letter, negation, properties and cancellation.
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { PERSONAL_LABELS, metadataRestrictions, searchDatabases } from '@panino/content-merge/document-search';
import { parseSearchQuery } from '@panino/content-merge/search-text';
import { DocumentMetadataIndex } from '@/utils/documentMetadataIndex';

const PERSONAL = 'user:11111111-1111-4111-8111-111111111111';
const SPACE = 'space:22222222-2222-4222-8222-222222222222';

function database(dbKey, name, { folders = [], notes = [] }) {
    const db = new DatabaseSync(':memory:');
    db.exec(`
        CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT, parent_id TEXT, created_at TEXT);
        CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, content TEXT, folder_id TEXT,
                            created_at TEXT, updated_at TEXT, pinned INTEGER DEFAULT 0);
    `);
    const addFolder = db.prepare('INSERT INTO folders VALUES (?, ?, ?, ?)');
    for (const [id, folderName, parent = null, created = '2026-01-01T00:00:00.000Z'] of folders) addFolder.run(id, folderName, parent, created);
    const addNote = db.prepare('INSERT INTO notes (id, title, content, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const note of notes) {
        addNote.run(note.id, note.title, note.content ?? '', note.folder ?? null, note.created ?? '2026-10-01T00:00:00.000Z', note.updated);
    }
    let calls = 0;
    const sqls = [];
    return {
        dbKey,
        name,
        labels: name ? [name] : [...PERSONAL_LABELS],
        sqls,
        get calls() { return calls; },
        execute(sql, params = []) {
            calls += 1;
            sqls.push(sql);
            return db.prepare(sql).all(...params);
        },
    };
}

const day = (n) => `2026-11-${String(n).padStart(2, '0')}T10:00:00.000Z`;

function fixture() {
    const personal = database(PERSONAL, null, {
        folders: [
            ['f-projects', 'Projects'], ['f-2026', '2026', 'f-projects'],
            ['f-archive', 'Archive'], ['f-trash', 'Trash'], ['f-old', 'Old', 'f-trash'],
        ],
        notes: [
            { id: 'p1', title: 'Budget plan', content: 'The budget for next year.', folder: 'f-2026', updated: day(1) },
            { id: 'p2', title: 'Notes', content: 'budget talk, draft', folder: 'f-projects', updated: day(5) },
            { id: 'p3', title: 'Old budget', content: 'budget gone', folder: 'f-old', updated: day(9) },
            { id: 'p4', title: 'Archive budget', content: 'budget kept', folder: 'f-archive', updated: day(2) },
            { id: 'p5', title: 'Über uns', content: 'Wir sind ÜBERALL.', updated: day(3) },
        ],
    });
    const space = database(SPACE, 'Acme Team', {
        folders: [['s-contracts', 'Contracts'], ['s-trash', 'trash ']],
        notes: [
            { id: 's1', title: 'Budget review', content: 'team budget', folder: 's-contracts', updated: day(4) },
            { id: 's2', title: 'Kickoff', content: 'mentions the budget', updated: day(6) },
            { id: 's3', title: 'Binned', content: 'budget in the bin', folder: 's-trash', updated: day(7) },
            { id: 's4', title: 'Uber eats', content: 'über alles', updated: day(8) },
        ],
    });
    return { personal, space, databases: [personal, space] };
}

const ids = (result) => result.results.map((row) => row.id);

describe('searchDatabases', () => {
    it('merges databases in the API order: title words, then newest, then id', async () => {
        const { databases } = fixture();
        const result = await searchDatabases({ databases, query: 'budget' });
        // Title matches first (newest first), then body-only matches; Trash left out.
        expect(ids(result)).toEqual(['s1', 'p4', 'p1', 's2', 'p2']);
        expect(result.results[0]).toMatchObject({ dbKey: SPACE, spaceName: 'Acme Team', folderPath: 'Contracts', title_score: 1, inTrash: false });
        expect(result.results[2]).toMatchObject({ folderPath: 'Projects / 2026', content: 'The budget for next year.' });
        expect(result.nextCursor).toBeNull();
    });

    it('pages with a cursor without repeating or skipping a Document', async () => {
        const { databases } = fixture();
        const all = ids(await searchDatabases({ databases, query: 'budget' }));
        const seen = [];
        let cursor = null;
        for (let page = 0; page < 5; page += 1) {
            const result = await searchDatabases({ databases, query: 'budget', limit: 2, cursor });
            seen.push(...ids(result));
            cursor = result.nextCursor;
            if (!cursor) break;
        }
        expect(seen).toEqual(all);
        expect(cursor).toBeNull();
        // A cursor this engine did not issue starts again from the top.
        expect(ids(await searchDatabases({ databases, query: 'budget', limit: 1, cursor: { score: 'x' } }))).toEqual(['s1']);
    });

    it('leaves Trash out by default, and includes and labels it with in:Trash', async () => {
        const { databases } = fixture();
        const trash = await searchDatabases({ databases, query: 'budget in:Trash' });
        // Both databases' Trash folders: "Trash" and "trash " are the same name.
        expect(ids(trash)).toEqual(['p3', 's3']);
        expect(trash.results.every((row) => row.inTrash)).toBe(true);
        expect(trash.results[0].folderPath).toBe('Trash / Old');
        expect(ids(await searchDatabases({ databases, query: 'budget in:Trash/Old' }))).toEqual(['p3']);
    });

    it('reads in: as a folder path, led by a space name when it names one', async () => {
        const { databases } = fixture();
        expect(ids(await searchDatabases({ databases, query: 'budget in:projects' }))).toEqual(['p1', 'p2']);
        expect(ids(await searchDatabases({ databases, query: 'budget in:"acme team"' }))).toEqual(['s1', 's2']);
        expect(ids(await searchDatabases({ databases, query: 'in:"Acme Team/Contracts"' }))).toEqual(['s1']);
        expect(ids(await searchDatabases({ databases, query: 'budget in:"My Notes/Projects/2026"' }))).toEqual(['p1']);
        expect(ids(await searchDatabases({ databases, query: 'budget -in:Projects -in:"Acme Team"' }))).toEqual(['p4']);
        const missing = await searchDatabases({ databases, query: 'budget in:Nowhere' });
        expect(missing.results).toEqual([]);
        expect(missing.notices).toEqual(['No folder matches in:Nowhere']);
    });

    it('fills a checklist page instead of returning it short', async () => {
        const notes = [];
        for (let i = 0; i < 40; i += 1) {
            // Every Document has a bracket, so all pass the SQL prefilter; one in four is a checklist.
            const checklist = i % 4 === 0;
            notes.push({ id: `n${String(i).padStart(2, '0')}`, title: `Item ${i}`, content: checklist ? '- [ ] milk' : 'array[0] milk', updated: day(1 + (i % 28)) });
        }
        const only = database(PERSONAL, null, { notes });
        const first = await searchDatabases({ databases: [only], query: 'milk is:checklist', limit: 4 });
        expect(first.results).toHaveLength(4);
        expect(first.results.every((row) => row.content === '- [ ] milk')).toBe(true);
        expect(first.nextCursor).not.toBeNull();
        const rest = await searchDatabases({ databases: [only], query: 'milk is:checklist', limit: 20, cursor: first.nextCursor });
        expect(first.results.length + rest.results.length).toBe(10);
        expect(rest.nextCursor).toBeNull();
        const without = await searchDatabases({ databases: [only], query: 'milk -is:checklist', limit: 50 });
        expect(without.results).toHaveLength(30);
    });

    it('ignores case for every letter, and orders by exact title matches', async () => {
        const { databases } = fixture();
        // "Über uns" has it in the title; "Uber eats" only in the body (its title is ASCII "Uber").
        expect(ids(await searchDatabases({ databases, query: 'ÜBER' }))).toEqual(['p5', 's4']);
        expect(ids(await searchDatabases({ databases, query: 'überall' }))).toEqual(['p5']);
        expect(ids(await searchDatabases({ databases, query: 'title:über' }))).toEqual(['p5']);
        expect(ids(await searchDatabases({ databases, query: 'über -überall' }))).toEqual(['s4']);
        const paged = await searchDatabases({ databases, query: 'über', limit: 1 });
        expect(ids(paged)).toEqual(['p5']);
        expect(ids(await searchDatabases({ databases, query: 'über', cursor: paged.nextCursor }))).toEqual(['s4']);
    });

    it('handles phrases, title: and negation', async () => {
        const { databases } = fixture();
        expect(ids(await searchDatabases({ databases, query: '"budget talk"' }))).toEqual(['p2']);
        expect(ids(await searchDatabases({ databases, query: 'title:budget' }))).toEqual(['s1', 'p4', 'p1']);
        expect(ids(await searchDatabases({ databases, query: 'budget -draft -title:review' }))).toEqual(['p4', 'p1', 's2']);
        const only = await searchDatabases({ databases, query: '-budget' });
        expect(only.results).toEqual([]);
        expect(only.notices[0]).toMatch(/only exclusions/);
    });

    it('filters on front matter and the local built-in properties', async () => {
        const db = database(PERSONAL, null, {
            notes: [
                { id: 'a', title: 'A', content: '---\nstatus: draft\ndue: 2026-12-01\n---\none two three four', updated: day(3), created: '2026-10-05T00:00:00.000Z' },
                { id: 'b', title: 'B', content: '---\nstatus: final\n---\none', updated: day(2) },
                { id: 'c', title: 'C', content: 'no front matter at all here', updated: day(1) },
            ],
        });
        const run = (query) => searchDatabases({ databases: [db], query }).then(ids);
        expect(await run('prop:status=draft')).toEqual(['a']);
        expect(await run('prop:"status != draft"')).toEqual(['b', 'c']);
        expect(await run('-prop:status=draft prop:"owner missing"')).toEqual(['b', 'c']);
        expect(await run('prop:"due <= 2026-12-01"')).toEqual(['a']);
        expect(await run('prop:"owner missing"')).toEqual(['a', 'b', 'c']);
        // Words of the whole body, front matter included (the API's rule).
        expect(await run('prop:word_count>6')).toEqual(['a']);
        expect(await run('prop:"word_count <= 6"')).toEqual(['b', 'c']);
        expect(await run('prop:created_on=2026-10-05')).toEqual(['a']);
        expect(await run('prop:"modified_on >= 2026-11-02"')).toEqual(['a', 'b']);
        const author = await searchDatabases({ databases: [db], query: 'one prop:created_by=Kris' });
        expect(ids(author)).toEqual(['a', 'b']);
        expect(author.notices).toEqual(['prop:created_by needs revision history, which only the API has; it was left out']);
    });

    it('stops when a newer search starts, and leaves out a database it cannot read', async () => {
        const { personal, space, databases } = fixture();
        let cancel = false;
        const result = await searchDatabases({
            databases,
            query: 'budget',
            isCancelled: () => cancel || ((cancel = personal.calls > 0), false),
        });
        expect(result.cancelled).toBe(true);
        expect(space.calls).toBe(0);

        const broken = { dbKey: SPACE, name: 'Broken', execute: () => { throw new Error('closed'); } };
        const partial = await searchDatabases({ databases: [personal, broken], query: 'budget' });
        expect(ids(partial)).toEqual(['p4', 'p1', 'p2']);
        expect(partial.notices).toEqual(['One database could not be searched.']);
        expect(partial.failed).toHaveLength(1);
    });

    it('keeps only the bodies of matching rows while refilling, so memory is bounded by the page', async () => {
        const notes = [];
        for (let i = 0; i < 300; i += 1) {
            // All but the ten oldest have a checklist, so `-is:checklist` rejects nearly every candidate.
            const plain = i < 10;
            notes.push({ id: `n${String(i).padStart(3, '0')}`, title: `Item ${i}`, content: `${plain ? 'zebra über' : '- [ ] zebra über'} ${'x'.repeat(200)}`, updated: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00.000Z` });
        }
        const db = database(PERSONAL, null, { notes });
        for (const query of ['zebra -is:checklist', 'über -is:checklist', 'zebra prop:word_count>50000']) {
            const result = await searchDatabases({ databases: [db], query, limit: 3 });
            expect(result.stats.bodiesRead, query).toBeGreaterThan(250);
            expect(result.stats.bodiesKept, query).toBeLessThanOrEqual(4);
        }
        const plain = await searchDatabases({ databases: [db], query: 'zebra -is:checklist', limit: 3 });
        expect(plain.results).toHaveLength(3);
        expect(plain.results.every((row) => !row.content.startsWith('- [ ]'))).toBe(true);
    });

    it('keeps a dash before a digit a word', async () => {
        const { databases } = fixture();
        // A dash before a digit is a word: "-5" is searched for, not excluded.
        expect((await searchDatabases({ databases, query: '-5' })).notices).toEqual([]);
    });

    it('scans each database once, however many candidates its checks reject, and pages on', async () => {
        const notes = [];
        for (let i = 0; i < 400; i += 1) {
            // Nine in ten are checklists, so `-is:checklist` rejects nearly every candidate.
            const plain = i % 10 === 0;
            notes.push({ id: `n${String(i).padStart(3, '0')}`, title: `Item ${i}`, content: `${plain ? 'lorem über [link](x)' : '- [x] lorem über'} ${'y'.repeat(100)}`, updated: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00.000Z` });
        }
        const other = database(SPACE, 'Acme Team', { notes: notes.slice(0, 50).map((note) => ({ ...note, id: `s-${note.id}` })) });
        const db = database(PERSONAL, null, { notes });
        // A scan is a query on notes that is not a lookup by id.
        const scans = (sqls) => sqls.filter((sql) => /FROM notes/.test(sql) && !/WHERE notes\.id IN \(SELECT value FROM json_each\(\?\)\)$/.test(sql.trim())).length;
        for (const query of ['lorem -is:checklist', 'über -is:checklist', 'lorem prop:word_count>50000', 'lorem -prop:"status missing"']) {
            db.sqls.length = 0;
            other.sqls.length = 0;
            const result = await searchDatabases({ databases: [db, other], query, limit: 3 });
            expect(scans(db.sqls), query).toBe(1);
            expect(scans(other.sqls), query).toBe(1);
            expect(result.stats.scans).toBe(2);
        }
        // Paging still works: every page is one scan per database from the cursor.
        const seen = [];
        let cursor = null;
        for (let page = 0; page < 20; page += 1) {
            db.sqls.length = 0;
            const result = await searchDatabases({ databases: [db], query: 'lorem -is:checklist', limit: 4, cursor });
            expect(scans(db.sqls)).toBe(1);
            seen.push(...ids(result));
            cursor = result.nextCursor;
            if (!cursor) break;
        }
        expect(seen).toHaveLength(40);
        expect(new Set(seen).size).toBe(40);
    }, 20000);

    it('says so when more candidates could match than one pass checks', async () => {
        const notes = Array.from({ length: 5003 }, (_, i) => ({ id: `n${String(i).padStart(5, '0')}`, title: `T${i}`, content: '- [x] lorem done', updated: day(1) }));
        const db = database(PERSONAL, null, { notes });
        // The page fills from the first candidates: nothing was missed.
        const result = await searchDatabases({ databases: [db], query: 'lorem is:checklist', limit: 2 });
        expect(result.results).toHaveLength(2);
        expect(result.notices).toEqual([]);
        const none = await searchDatabases({ databases: [db], query: 'lorem -is:checklist', limit: 2 });
        expect(none.results).toEqual([]);
        expect(none.notices).toEqual(['Only the first 5000 Documents that could match in a database were checked; add words or in: to narrow the search.']);
    }, 20000);

    it('reads no bodies to confirm a title-only check', async () => {
        const { databases } = fixture();
        const title = await searchDatabases({ databases, query: 'title:über' });
        expect(ids(title)).toEqual(['p5']);
        expect(title.stats.bodiesRead).toBe(0);
        const without = await searchDatabases({ databases, query: 'budget -title:über' });
        expect(ids(without)).toEqual(['s1', 'p4', 'p1', 's2', 'p2']);
        expect(without.stats.bodiesRead).toBe(0);
        // Snippets still come from the page's bodies.
        expect(title.results[0].content).toBe('Wir sind ÜBERALL.');
    });

    it('binds every value: hostile text is only ever a parameter', async () => {
        const { databases } = fixture();
        const result = await searchDatabases({ databases, query: "'); DROP TABLE notes; -- in:\"x'); --\" prop:\"a=') OR 1=1 --\"" });
        expect(result.results).toEqual([]);
        expect(ids(await searchDatabases({ databases, query: 'budget' }))).toHaveLength(5);
        // LIKE wildcards in a term match literally.
        expect(ids(await searchDatabases({ databases, query: '%' }))).toEqual([]);
        expect(ids(await searchDatabases({ databases, query: '_' }))).toEqual([]);
    });
});

/** The database with a metadata index built from its rows, as the app's index store builds it. */
function withIndex(db) {
    const index = new DocumentMetadataIndex();
    for (const row of db.execute('SELECT id, content FROM notes')) index.set(row.id, row.content);
    return {
        ...db,
        execute: db.execute,
        index: async () => ({ entries: () => index.documents(), idsWithTags: (names) => index.idsWithTags(names) }),
        metadata: index,
    };
}

function taggedFixture() {
    const fm = (lines, body) => `---\n${lines.join('\n')}\n---\n${body}`;
    const personal = database(PERSONAL, null, {
        folders: [['f-trash', 'Trash'], ['f-work', 'Work']],
        notes: [
            { id: 't1', title: 'Plan', content: fm(['tags: [Urgent, work]', 'status: draft'], 'budget plan'), folder: 'f-work', updated: day(1) },
            { id: 't2', title: 'Review', content: fm(['tags:', '  - urgent', 'status: final', 'owner: Kris'], 'budget review'), updated: day(2) },
            { id: 't3', title: 'Old', content: fm(['tags: urgent', 'status: draft'], 'budget old'), folder: 'f-trash', updated: day(3) },
            { id: 't4', title: 'Plain', content: 'budget with no front matter', updated: day(4) },
            { id: 't5', title: 'Due', content: fm(['due: 2026-12-01', 'status: "in progress"'], 'budget due'), updated: day(5) },
        ],
    });
    const space = database(SPACE, 'Acme Team', {
        notes: [
            { id: 'u1', title: 'Team plan', content: fm(['tags: [work, Urgent]', 'status: draft'], 'budget team'), updated: day(6) },
            { id: 'u2', title: 'Team notes', content: 'budget notes', updated: day(7) },
        ],
    });
    return { plain: [personal, space], indexed: [withIndex(personal), withIndex(space)] };
}

describe('searchDatabases with the metadata index (phases 3 and 4)', () => {
    const QUERIES = [
        'tag:urgent',
        'tag:URGENT tag:work',
        'budget -tag:urgent',
        'tag:urgent in:Trash',
        'tag:work in:"Acme Team"',
        'prop:status=draft',
        'prop:"status != draft"',
        'budget prop:"owner missing"',
        'budget -prop:status=draft',
        'prop:"due <= 2026-12-01"',
        'prop:status="in progress"',
        'prop:status~dr tag:urgent',
        'budget prop:"tags exists"',
    ];

    for (const query of QUERIES) {
        it(`gives the same Documents with and without the index for ${query}`, async () => {
            const { plain, indexed } = taggedFixture();
            const read = await searchDatabases({ databases: plain, query, limit: 50 });
            const fromIndex = await searchDatabases({ databases: indexed, query, limit: 50 });
            expect(ids(fromIndex)).toEqual(ids(read));
            expect(fromIndex.notices).toEqual(read.notices);
            // The index decides tag: and front matter prop: without reading a body.
            expect(fromIndex.stats.bodiesRead).toBe(0);
            expect(fromIndex.stats.indexed).toBeGreaterThan(0);
        });
    }

    it('finds tags across databases, leaves Trash out and needs every tag', async () => {
        const { indexed } = taggedFixture();
        expect(ids(await searchDatabases({ databases: indexed, query: 'tag:urgent' }))).toEqual(['u1', 't2', 't1']);
        expect(ids(await searchDatabases({ databases: indexed, query: 'tag:urgent tag:work' }))).toEqual(['u1', 't1']);
        const trash = await searchDatabases({ databases: indexed, query: 'tag:urgent in:Trash' });
        expect(ids(trash)).toEqual(['t3']);
        expect(trash.results[0].inTrash).toBe(true);
        expect(ids(await searchDatabases({ databases: indexed, query: 'tag:nothing' }))).toEqual([]);
        expect((await searchDatabases({ databases: indexed, query: 'tag:urgent' })).notices).toEqual([]);
    });

    it('gives the Documents the sidebar filter bar gives for the same tags', async () => {
        const { indexed } = taggedFixture();
        // The filter bar: idsWithTags per database, Trash left out (tagStore.findTaggedDocuments).
        const bar = [];
        for (const db of indexed) {
            const folders = db.execute('SELECT id, name, parent_id, created_at FROM folders');
            const trash = new Set(folders.filter((f) => f.name?.trim().toLowerCase() === 'trash' && !f.parent_id).map((f) => f.id));
            for (const id of db.metadata.idsWithTags(['urgent', 'work'])) {
                const [row] = db.execute('SELECT folder_id FROM notes WHERE id = ?', [id]);
                if (!row.folder_id || !trash.has(row.folder_id)) bar.push(id);
            }
        }
        const found = await searchDatabases({ databases: indexed, query: 'tag:urgent tag:work' });
        expect(ids(found).sort()).toEqual(bar.sort());
    });

    it('still reads bodies for word_count, and works for a database without an index', async () => {
        const { plain, indexed } = taggedFixture();
        const words = await searchDatabases({ databases: indexed, query: 'budget prop:word_count>3' });
        expect(words.stats.bodiesRead).toBeGreaterThan(0);
        expect(ids(words)).toEqual(ids(await searchDatabases({ databases: plain, query: 'budget prop:word_count>3' })));
        const mixed = await searchDatabases({ databases: [indexed[0], plain[1]], query: 'tag:urgent' });
        expect(ids(mixed)).toEqual(['u1', 't2', 't1']);
        const failing = { ...plain[1], index: async () => null };
        expect(ids(await searchDatabases({ databases: [indexed[0], failing], query: 'tag:work' }))).toEqual(['u1', 't1']);
    });

    it('turns parts into id lists: Documents without front matter pass missing and !=', () => {
        const index = new DocumentMetadataIndex();
        index.set('a', '---\nstatus: draft\n---\n');
        index.set('b', '---\nstatus: final\n---\n');
        index.set('c', 'no front matter');
        const source = { entries: () => index.documents(), idsWithTags: (names) => index.idsWithTags(names) };
        const of = (query) => metadataRestrictions(parseSearchQuery(query).parts, source);
        expect(of('prop:status=draft')).toMatchObject({ include: [['a']], exclude: [] });
        expect(of('prop:"status != draft"')).toMatchObject({ include: [], exclude: ['a'] });
        expect(of('-prop:status=draft')).toMatchObject({ include: [], exclude: ['a'] });
        expect(of('-prop:"status missing"')).toMatchObject({ include: [['a', 'b']], exclude: [] });
        expect(of('prop:word_count>3').decided.size).toBe(0);
    });
});
