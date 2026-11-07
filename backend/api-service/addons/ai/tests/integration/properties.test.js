// Document properties in the v1 API and MCP (docs/specs/proposed/ai-api-expansion.md §4.6):
// built-in ones (word count, created and modified on and by) and front matter.
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteTestDb, getDb, getSpacesDb, getUserDb } from '../../../../db.js';
import { createRevisionSnapshot } from '../../../../revision.js';
import { createSpace } from '../../../../spaces.js';
import { aiUser, createKey, createTestApp, offerAiAddon, resetAiState } from '../aiTestSetup.js';

const V1 = '/addons/ai/v1';
const MCP = `${V1}/mcp`;

describe('AI agents add-on: Document properties', () => {
    let app;
    let server;
    let clients;
    let restore;
    let user;
    let secret;
    let spaceId;

    const bearer = (key = secret) => ({ Authorization: `Bearer ${key}` });
    const db = () => getUserDb(user.userId);

    function note(target, id, title, content, updatedAt = '2026-11-01T10:00:00.000Z', createdAt = '2026-10-01T09:00:00.000Z', folderId = null) {
        target.prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, target === db() ? user.userId : null, folderId, title, content, createdAt, updatedAt);
    }
    const contentOf = (id, target = db()) => target.prepare('SELECT content FROM notes WHERE id = ?').get(id)?.content;

    let nextId = 1;
    const mcp = (name, args, key = secret) => request(app).post(MCP).set(bearer(key))
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
    const text = (res) => res.body.result.content[0].text;

    beforeAll(() => {
        restore = offerAiAddon();
        ({ app, server, clients } = createTestApp());
    });
    afterAll(() => {
        restore();
        return new Promise((resolve) => server.close(resolve));
    });
    beforeEach(async () => {
        resetAiState();
        user = await aiUser('properties');
        ({ secret } = await createKey(app, user, { name: 'Prop agent' }));
        spaceId = null;
        note(db(), 'p-1', 'Plan', '---\nstatus: draft\npriority: 3\nowner: "Kris"\n---\n\n# Plan\n\none two three four', '2026-11-03T10:00:00.000Z');
        note(db(), 'p-2', 'Report', '---\nstatus: final\npriority: 10\n---\n\nshort', '2026-11-02T10:00:00.000Z');
        note(db(), 'p-3', 'Notes', '# Notes\n\nno front matter here at all', '2026-11-01T10:00:00.000Z');
    });
    afterEach(() => {
        clients.clear();
        const spacesDb = getSpacesDb();
        if (spaceId) {
            spacesDb.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
            spacesDb.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
            deleteTestDb(`space:${spaceId}`);
        }
        spacesDb.prepare('DELETE FROM space_user_versions WHERE user_id = ?').run(user.userId);
        user.cleanup();
    });

    describe('reading', () => {
        it('returns built-in and front matter properties of one Document', async () => {
            const res = await request(app).get(`${V1}/documents/p-1/properties`).set(bearer());
            expect(res.status).toBe(200);
            expect(res.body.properties).toEqual({ status: 'draft', priority: '3', owner: 'Kris' });
            expect(res.body.order).toEqual(['status', 'priority', 'owner']);
            expect(res.body.builtIn).toMatchObject({
                title: 'Plan',
                folder: '',
                wordCount: 14,
                createdOn: '2026-10-01T09:00:00.000Z',
                modifiedOn: '2026-11-03T10:00:00.000Z',
                pinned: false,
            });
            // No history: in the personal database the owner is the only possible author.
            expect(res.body.builtIn.createdBy).toMatchObject({ kind: 'user', userId: user.userId, userName: 'Test User', text: 'by Test User', inferred: true });
            expect(res.body.builtIn.modifiedBy).toMatchObject({ kind: 'user', userId: user.userId });
        });

        it('names the key that created and the one that last changed a Document, from revision history', async () => {
            const created = await request(app).post(`${V1}/documents`).set(bearer()).send({ title: 'Agent doc', content: 'hello world' });
            const id = created.body.document.id;
            const { secret: other } = await createKey(app, user, { name: 'Second agent' });
            await request(app).post(`${V1}/documents/${id}/append`).set(bearer(other)).send({ content: 'more words here' });

            const res = await request(app).get(`${V1}/documents/${id}/properties`).set(bearer());
            expect(res.body.builtIn.createdBy).toMatchObject({ kind: 'api', label: 'Prop agent', text: 'by Test User via Prop agent (API key)' });
            expect(res.body.builtIn.modifiedBy).toMatchObject({ kind: 'api', label: 'Second agent' });
            expect(res.body.builtIn.wordCount).toBe(5);

            const doc = await request(app).get(`${V1}/documents/${id}`).set(bearer());
            expect(doc.body.document.createdBy.label).toBe('Prop agent');
            expect(doc.body.document.modifiedBy.label).toBe('Second agent');
            expect(doc.body.document.properties).toEqual({});

            const viaMcp = await mcp('get_document_properties', { id });
            expect(text(viaMcp)).toContain('created_by: by Test User via Prop agent (API key)');
            expect(text(viaMcp)).toContain('modified_by: by Test User via Second agent (API key)');
            expect(text(viaMcp)).toContain('word_count: 5');
        });

        it('lists front matter keys with counts and common values, and the built-in keys', async () => {
            const res = await request(app).get(`${V1}/properties`).set(bearer());
            expect(res.status).toBe(200);
            expect(res.body.builtInKeys.map((entry) => entry.key)).toEqual(['word_count', 'created_on', 'modified_on', 'created_by', 'modified_by']);
            const byKey = Object.fromEntries(res.body.keys.map((entry) => [entry.key, entry]));
            expect(byKey.status).toMatchObject({ documents: 2, distinctValues: 2 });
            expect(byKey.owner.commonValues).toEqual([{ value: 'Kris', count: 1 }]);
            expect(res.body.documentsWithProperties).toBe(2);

            const viaMcp = await mcp('list_document_properties', {});
            expect(text(viaMcp)).toContain('Built-in, on every Document: word_count');
            expect(text(viaMcp)).toMatch(/status — 2 Documents, 2 values/);
        });
    });

    describe('querying', () => {
        const query = (filter, extra = '') => request(app).get(`${V1}/properties/query?filter=${encodeURIComponent(filter)}${extra}`).set(bearer());

        it('filters on front matter, most recently updated first', async () => {
            const res = await query('priority >= 3');
            expect(res.status).toBe(200);
            expect(res.body.documents.map((doc) => doc.id)).toEqual(['p-1', 'p-2']);
            expect(res.body.total).toBe(2);
            expect(res.body.documents[0].properties.status).toBe('draft');
            expect(res.body.documents[0].builtIn.wordCount).toBe(14);

            expect((await query('status = DRAFT')).body.documents.map((doc) => doc.id)).toEqual(['p-1']);
            expect((await query('owner missing')).body.documents.map((doc) => doc.id)).toEqual(['p-2']);
        });

        it('filters on built-in properties, including Documents without front matter', async () => {
            expect((await query('word_count >= 8')).body.documents.map((doc) => doc.id)).toEqual(['p-1', 'p-3']);
            expect((await query('modified_on < 2026-11-02T12:00:00Z')).body.documents.map((doc) => doc.id)).toEqual(['p-2', 'p-3']);
            expect((await query('created_on >= 2026-10-01 AND status = final')).body.documents.map((doc) => doc.id)).toEqual(['p-2']);

            const created = await request(app).post(`${V1}/documents`).set(bearer()).send({ title: 'By agent', content: 'x' });
            const byAgent = await query('created_by = "Prop agent"');
            expect(byAgent.body.documents.map((doc) => doc.id)).toEqual([created.body.document.id]);
            expect((await query('modified_by ~ api key')).body.documents.map((doc) => doc.id)).toEqual([created.body.document.id]);
            // The owner made the others (inferred in the personal database).
            expect((await query('created_by = "Test User"')).body.total).toBe(4);
        });

        it('pages with offset and refuses a filter it cannot read', async () => {
            const first = await query('priority exists', '&limit=1');
            expect(first.body.documents.map((doc) => doc.id)).toEqual(['p-1']);
            expect(first.body.nextOffset).toBe(1);
            const second = await query('priority exists', '&limit=1&offset=1');
            expect(second.body.documents.map((doc) => doc.id)).toEqual(['p-2']);
            expect(second.body.nextOffset).toBeNull();

            const bad = await query('status');
            expect(bad.status).toBe(400);
            expect(bad.body.code).toBe('INVALID_FILTER');
            const viaMcp = await mcp('query_documents_by_property', { filter: 'status' });
            expect(viaMcp.body.result.isError).toBe(true);
            expect(text(viaMcp)).toContain('Operators:');
        });

        it('answers over MCP with each Document\'s properties', async () => {
            const res = await mcp('query_documents_by_property', { filter: 'status = draft' });
            expect(res.body.result.isError).toBeUndefined();
            expect(text(res)).toContain('1 Document match "status = draft".');
            expect(text(res)).toContain('status: draft; priority: 3; owner: Kris');
            expect(res.body.result.structuredContent.documents[0].id).toBe('p-1');
        });
    });

    describe('writing', () => {
        it('sets and removes one property, keeping the rest of the text, with attributed revisions', async () => {
            const set = await request(app).put(`${V1}/documents/p-1/properties/Status`).set(bearer()).send({ value: 'review' });
            expect(set.status).toBe(200);
            expect(set.body.changed).toBe(true);
            expect(contentOf('p-1')).toBe('---\nStatus: review\npriority: 3\nowner: "Kris"\n---\n\n# Plan\n\none two three four');

            const added = await mcp('set_document_property', { id: 'p-3', key: 'due', value: '2026-12-01' });
            expect(text(added)).toContain('due: 2026-12-01');
            expect(contentOf('p-3')).toBe('---\ndue: 2026-12-01\n---\n\n# Notes\n\nno front matter here at all');

            const removed = await request(app).delete(`${V1}/documents/p-3/properties/due`).set(bearer());
            expect(removed.body.changed).toBe(true);
            expect(contentOf('p-3')).toBe('# Notes\n\nno front matter here at all');

            const same = await request(app).delete(`${V1}/documents/p-3/properties/due`).set(bearer());
            expect(same.body.changed).toBe(false);

            const latest = db().prepare(`SELECT actor_kind, actor_label FROM note_revisions WHERE note_id = 'p-1'
                                          ORDER BY created_at DESC, rowid DESC LIMIT 1`).get();
            expect(latest).toEqual({ actor_kind: 'api', actor_label: 'Prop agent' });
        });

        it('refuses bad keys and values, stale versions, and read-only access', async () => {
            const badKey = await request(app).put(`${V1}/documents/p-1/properties/${encodeURIComponent('a:b')}`).set(bearer()).send({ value: 'x' });
            expect(badKey.body.code).toBe('INVALID_INPUT');
            const badValue = await request(app).put(`${V1}/documents/p-1/properties/status`).set(bearer()).send({ value: 'two\nlines' });
            expect(badValue.body.code).toBe('INVALID_INPUT');
            const stale = await request(app).put(`${V1}/documents/p-1/properties/status`).set(bearer()).send({ value: 'x', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
            expect(stale.status).toBe(409);
            expect(stale.body.code).toBe('VERSION_CONFLICT');

            const { secret: reader } = await createKey(app, user, { name: 'Reader', scope: 'read' });
            const refused = await request(app).put(`${V1}/documents/p-1/properties/status`).set(bearer(reader)).send({ value: 'x' });
            expect(refused.status).toBe(403);
            expect(refused.body.code).toBe('INSUFFICIENT_SCOPE');
            const tools = await request(app).post(MCP).set(bearer(reader)).set('Accept', 'application/json, text/event-stream')
                .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
            const names = tools.body.result.tools.map((tool) => tool.name);
            expect(names).toContain('query_documents_by_property');
            expect(names).not.toContain('set_document_property');
            expect(contentOf('p-1')).toContain('status: draft');
        });
    });

    describe('spaces', () => {
        let spaceDb;
        beforeEach(() => {
            spaceId = createSpace({ actorUserId: user.userId, name: 'Team' }).spaceId;
            spaceDb = getDb(`space:${spaceId}`);
            note(spaceDb, 's-1', 'Team plan', '---\nstatus: draft\n---\n\n# Team', '2026-11-05T10:00:00.000Z');
            createRevisionSnapshot(spaceDb, {
                noteId: 's-1', title: 'Team plan', content: '---\nstatus: draft\n---\n\n# Team', type: 'auto',
                skipDuplicateCheck: true, enforceAutoThrottle: false, runPruneGate: false,
                actorUserId: user.userId, actorKind: 'sync',
            });
        });

        it('queries every reachable database, and names space authors from history', async () => {
            const res = await request(app).get(`${V1}/properties/query?filter=${encodeURIComponent('status = draft')}`).set(bearer());
            expect(res.body.documents.map((doc) => doc.id)).toEqual(['s-1', 'p-1']);
            expect(res.body.documents[0]).toMatchObject({ space: spaceId, spaceName: 'Team' });
            expect(res.body.documents[0].builtIn.createdBy).toMatchObject({ kind: 'sync', text: 'by Test User (synced from a device)' });
        });

        it('hides spaces from a personal-only key and refuses writes in a live session', async () => {
            const { secret: personal } = await createKey(app, user, { name: 'Personal only', spaceAccess: 'personal' });
            const res = await request(app).get(`${V1}/properties/query?filter=${encodeURIComponent('status = draft')}`).set(bearer(personal));
            expect(res.body.documents.map((doc) => doc.id)).toEqual(['p-1']);
            const hidden = await request(app).get(`${V1}/documents/s-1/properties`).set(bearer(personal));
            expect(hidden.status).toBe(404);

            spaceDb.prepare(`INSERT INTO collab_sessions (note_id, session_id, ydoc_state, base_content, base_hash, started_at, updated_at)
                             VALUES ('s-1', 'sess-1', x'00', 'x', 'h', '2026', '2026')`).run();
            const live = await request(app).put(`${V1}/documents/s-1/properties/status`).set(bearer()).send({ value: 'final' });
            expect(live.status).toBe(409);
            expect(live.body.code).toBe('DOCUMENT_IN_LIVE_SESSION');
            expect(contentOf('s-1', spaceDb)).toContain('status: draft');
        });
    });

    it('keeps the Trash record right when update_document moves a Document in and out of Trash', async () => {
        const trashed = await request(app).delete(`${V1}/documents/p-2`).set(bearer());
        const trashId = trashed.body.document.folderId;
        const origin = () => db().prepare('SELECT previous_parent_id FROM ai_trash_origins WHERE item_id = ?').get('p-2');
        expect(origin()).toEqual({ previous_parent_id: null });

        db().prepare("INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES ('f-a', ?, 'Archive', NULL, '2026')").run(user.userId);
        await request(app).patch(`${V1}/documents/p-2`).set(bearer()).send({ folderId: 'f-a' });
        expect(origin()).toBeUndefined();

        await request(app).patch(`${V1}/documents/p-2`).set(bearer()).send({ folderId: trashId });
        expect(origin()).toEqual({ previous_parent_id: 'f-a' });
        const restored = await request(app).post(`${V1}/trash/p-2/restore`).set(bearer()).send({});
        expect(restored.body.destination.folderId).toBe('f-a');
    });
});
