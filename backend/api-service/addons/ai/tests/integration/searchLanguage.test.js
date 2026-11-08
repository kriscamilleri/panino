// The API's search on the shared query language (docs/specs/active/advanced-search.md §6.5):
// every new part through REST and MCP, `in=title` with `in:` folders, `folder_id` with `in:`,
// Trash, `prop:` on its own (truncated / scanned), notices, and parity with the app's engine:
// the same fixture and query through `@panino/content-merge/document-search` (the app's search)
// and through `GET /search` give the same Documents in the same order.
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PERSONAL_LABELS, searchDatabases } from '@panino/content-merge/document-search';
import { deleteTestDb, getDb, getSpacesDb, getUserDb } from '../../../../db.js';
import { createSpace } from '../../../../spaces.js';
import { aiUser, createKey, createTestApp, offerAiAddon, resetAiState } from '../aiTestSetup.js';

const V1 = '/addons/ai/v1';
const day = (n) => `2026-11-${String(n).padStart(2, '0')}T10:00:00.000Z`;

describe('AI agents add-on: search query language', () => {
    let app;
    let server;
    let restore;
    let user;
    let secret;
    let spaceId;
    let spaceDb;

    const bearer = () => ({ Authorization: `Bearer ${secret}` });
    const db = () => getUserDb(user.userId);
    const search = (query) => request(app).get(`${V1}/search?${query}`).set(bearer());
    const q = (text, extra = '') => search(`q=${encodeURIComponent(text)}${extra}`);
    const ids = (res) => res.body.results.map((hit) => hit.id);

    let nextId = 1;
    const mcp = (name, args) => request(app).post(`${V1}/mcp`)
        .set('Authorization', `Bearer ${secret}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });

    function note(target, id, title, content, { folderId = null, updatedAt = day(1), createdAt = updatedAt } = {}) {
        target.prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, pinned, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, 0, ?, ?)`).run(id, user.userId, folderId, title, content, createdAt, updatedAt);
    }

    function folder(target, id, name, parentId = null) {
        target.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(id, user.userId, name, parentId, '2026-10-01T00:00:00.000Z');
    }

    beforeAll(() => {
        restore = offerAiAddon();
        ({ app, server } = createTestApp());
    });
    afterAll(() => {
        restore();
        return new Promise((resolve) => server.close(resolve));
    });
    beforeEach(async () => {
        resetAiState();
        user = await aiUser('search-language');
        ({ secret } = await createKey(app, user, { name: 'Claude Code', scope: 'read' }));
        spaceId = createSpace({ actorUserId: user.userId, name: 'Acme Team' }).spaceId;
        spaceDb = getDb(`space:${spaceId}`);

        const mine = db();
        folder(mine, 'f-projects', 'Projects');
        folder(mine, 'f-2026', '2026', 'f-projects');
        folder(mine, 'f-archive', 'Archive');
        folder(mine, 'f-trash', 'Trash');
        folder(mine, 'f-old', 'Old', 'f-trash');
        note(mine, 'p1', 'Budget plan', '---\nstatus: draft\n---\nThe budget for next year.', { folderId: 'f-2026', updatedAt: day(1) });
        note(mine, 'p2', 'Notes', 'budget talk, draft\n- [ ] call the bank', { folderId: 'f-projects', updatedAt: day(5) });
        note(mine, 'p3', 'Old budget', 'budget gone', { folderId: 'f-old', updatedAt: day(9) });
        note(mine, 'p4', 'Archive budget', '---\nstatus: final\n---\nbudget kept', { folderId: 'f-archive', updatedAt: day(2) });
        note(mine, 'p5', 'Über uns', 'Wir sind ÜBERALL. budget', { updatedAt: day(3) });

        folder(spaceDb, 's-contracts', 'Contracts');
        folder(spaceDb, 's-trash', 'trash ');
        note(spaceDb, 's1', 'Budget review', 'team budget\n1. [x] signed', { folderId: 's-contracts', updatedAt: day(4) });
        note(spaceDb, 's2', 'Kickoff', 'mentions the budget, a draft', { updatedAt: day(6) });
        note(spaceDb, 's3', 'Binned', 'budget in the bin', { folderId: 's-trash', updatedAt: day(7) });
        note(spaceDb, 's4', 'Uber eats', 'über alles budget', { updatedAt: day(8) });
    });
    afterEach(() => {
        const spacesDb = getSpacesDb();
        spacesDb.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
        spacesDb.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
        spacesDb.prepare('DELETE FROM space_user_versions WHERE user_id = ?').run(user.userId);
        deleteTestDb(`space:${spaceId}`);
        user.cleanup();
    });

    it('reads title:, phrases and - as the app does', async () => {
        expect(ids(await q('title:budget'))).toEqual(['s1', 'p4', 'p1']);
        expect(ids(await q('"budget talk"'))).toEqual(['p2']);
        const res = await q('budget -draft -title:review');
        expect(ids(res)).toEqual(['p4', 's4', 'p5']);
        expect(res.body).toMatchObject({ terms: ['budget'], notices: [] });
        expect(ids(await q('über -überall'))).toEqual(['s4']);
    });

    it('reads in: as a folder path, a space name leading, and keeps the in parameter for fields', async () => {
        expect(ids(await q('budget in:projects'))).toEqual(['p1', 'p2']);
        expect(ids(await q('budget in:"Acme Team"'))).toEqual(['s1', 's4', 's2']);
        expect(ids(await q('in:"Acme Team/Contracts"'))).toEqual(['s1']);
        expect(ids(await q('budget -in:Projects -in:"Acme Team"'))).toEqual(['p4', 'p5']);
        // in=title chooses fields, in: chooses folders: both apply.
        expect(ids(await q('budget in:Projects', '&in=title'))).toEqual(['p1']);
        expect(ids(await q('talk in:Projects', '&in=content'))).toEqual(['p2']);
        const nowhere = await q('budget in:Nowhere');
        expect(nowhere.body).toMatchObject({ results: [], notices: ['No folder matches in:Nowhere'] });
    });

    it('takes folder_id and in: together: Documents in both', async () => {
        expect(ids(await q('budget in:"Projects/2026"', '&folderId=f-projects'))).toEqual(['p1']);
        expect(ids(await q('budget in:Archive', '&folderId=f-projects'))).toEqual([]);
    });

    it('leaves Trash out unless in:Trash, includeTrash or a folder inside Trash asks', async () => {
        expect(ids(await q('budget'))).not.toContain('p3');
        const trash = await q('budget in:Trash');
        expect(ids(trash)).toEqual(['p3', 's3']);
        expect(trash.body.results.every((hit) => hit.inTrash)).toBe(true);
        expect(ids(await q('budget', '&includeTrash=true'))).toEqual(expect.arrayContaining(['p3', 's3']));
        expect(ids(await q('budget', '&folderId=f-old'))).toEqual(['p3']);
    });

    it('filters is:checklist and prop:, and reports the property scan', async () => {
        expect(ids(await q('budget is:checklist'))).toEqual(['s1', 'p2']);
        expect(ids(await q('budget -is:checklist'))).not.toContain('p2');
        const withWord = await q('budget prop:status=draft');
        expect(ids(withWord)).toEqual(['p1']);
        expect(withWord.body).toMatchObject({ truncated: false, scanned: 'front_matter' });
        const alone = await q('prop:status=final');
        expect(ids(alone)).toEqual(['p4']);
        expect(alone.body).toMatchObject({ terms: [], truncated: false, scanned: 'front_matter' });
        expect(alone.body.results[0]).toMatchObject({ matchedTitle: false, matchCount: 0 });
        const negated = await q('budget -prop:status=draft in:Projects');
        expect(ids(negated)).toEqual(['p2']);
        expect(negated.body.scanned).toBe('all');
        expect(ids(await q('prop:"modified_on >= 2026-11-08"'))).toEqual(['s4']);
        // Revision history is on the server, so author conditions are kept here.
        const author = await q('budget prop:"created_by exists"');
        expect(author.body.notices).toEqual([]);
        // No word, no plain query: the field without prop: is unchanged.
        expect((await q('budget')).body).not.toHaveProperty('truncated');
    });

    it('explains parts it cannot read and searches the rest', async () => {
        const res = await q('budget prop:status tag:urgent is:archived');
        expect(ids(res)).toHaveLength(7);
        expect(res.body.notices).toEqual([
            expect.stringMatching(/^prop:status: "status" has no operator/),
            'Tags are not available yet',
            'is:archived is not known; use is:checklist',
        ]);
        const bad = await q('-budget');
        expect(bad.status).toBe(400);
        expect(bad.body.error).toMatch(/only exclusions/);
        expect((await q('prop:')).status).toBe(400);
        expect((await q(Array.from({ length: 21 }, (_, i) => `w${i}`).join(' '))).status).toBe(400);
    });

    it('works through MCP, with the notices in the text', async () => {
        const res = await mcp('search_documents', { query: 'budget in:"Acme Team/Contracts" tag:x' });
        const { text } = res.body.result.content[0];
        expect(text).toMatch(/^1\. Budget review/);
        expect(text).toContain('Note: Tags are not available yet');
        expect(res.body.result.structuredContent.notices).toEqual(['Tags are not available yet']);
        const none = await mcp('search_documents', { query: 'prop:status=gone' });
        expect(none.body.result.content[0].text).toBe('No Documents match prop:status=gone.');
    });

    describe('parity with the app`s engine', () => {
        // The app's engine over the same two databases, read through better-sqlite3.
        const appDatabases = () => [
            { dbKey: `user:${user.userId}`, name: null, labels: [...PERSONAL_LABELS], execute: (sql, params = []) => db().prepare(sql).all(...params) },
            { dbKey: `space:${spaceId}`, name: 'Acme Team', labels: ['Acme Team'], execute: (sql, params = []) => spaceDb.prepare(sql).all(...params) },
        ];

        const QUERIES = [
            'budget',
            'budget in:Trash',
            'title:budget',
            '"budget talk"',
            'budget -draft',
            'über',
            'ÜBER',
            'budget in:"Acme Team"',
            'budget in:Projects',
            'budget in:"My Notes/Projects/2026"',
            'budget is:checklist',
            'budget -is:checklist',
            'prop:status=draft',
            'budget prop:"status != draft"',
            'budget -in:Projects',
        ];

        for (const query of QUERIES) {
            it(`gives the same Documents in the same order for ${query}`, async () => {
                const api = await q(query, '&limit=100');
                expect(api.status).toBe(200);
                const found = await searchDatabases({ databases: appDatabases(), query, limit: 100 });
                expect(found.results.map((row) => row.id)).toEqual(ids(api));
                expect(found.results.map((row) => row.inTrash)).toEqual(api.body.results.map((hit) => Boolean(hit.inTrash)));
                expect(found.terms).toEqual(api.body.terms);
            });
        }

        it('pages the same way', async () => {
            const api = [...ids(await q('budget', '&limit=3')), ...ids(await q('budget', '&limit=3&offset=3'))];
            const first = await searchDatabases({ databases: appDatabases(), query: 'budget', limit: 3 });
            const second = await searchDatabases({ databases: appDatabases(), query: 'budget', limit: 3, cursor: first.nextCursor });
            expect([...first.results, ...second.results].map((row) => row.id)).toEqual(api);
        });
    });
});
