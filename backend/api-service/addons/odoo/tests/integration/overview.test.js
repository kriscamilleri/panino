import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../../../../tests/testHelpers.js';
import { deleteTestDb, getDb, getSpacesDb, getUserDb } from '../../../../db.js';
import { resetOdooRateLimits } from '../../routes.js';
import { resetFileFieldCache } from '../../client.js';
import { createSync, saveSyncRun, setSyncStatus } from '../../sync.js';
import { addEditorMember, createSpace } from '../../../../spaces.js';
import { API_KEY, resetFakeOdoo, startFakeOdoo } from '../fakeOdoo.js';

const PDF_REQUEST = { htmlContent: '<h1>Quote</h1>', cssStyles: '', printStyles: {} };

describe('The Odoo overview', () => {
    let app;
    let odoo;
    let user;
    let other;
    let token;
    let dbKey;
    const saved = {};

    beforeAll(async () => {
        for (const name of ['ODOO_INTEGRATION_ENABLED', 'ODOO_CREDENTIAL_ENCRYPTION_KEY', 'ODOO_ALLOWED_PRIVATE_HOSTS', 'SHARED_SPACES_ENABLED']) saved[name] = process.env[name];
        ({ app } = createTestApp());
        odoo = await startFakeOdoo();
    });

    afterAll(async () => {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        await new Promise((resolve) => odoo.server.close(resolve));
    });

    beforeEach(async () => {
        process.env.ODOO_INTEGRATION_ENABLED = 'true';
        process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY = 'test-odoo-credential-key-0123456789abcdef';
        process.env.ODOO_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
        resetFakeOdoo(odoo.state);
        resetOdooRateLimits();
        resetFileFieldCache();
        const stamp = Date.now();
        user = await setupTestUser(`odoo-overview-${stamp}@example.test`, 'password123');
        other = await setupTestUser(`odoo-overview-other-${stamp}@example.test`, 'password123');
        token = getTestToken(user.userId);
        dbKey = `user:${user.userId}`;
    });

    afterEach(() => {
        cleanupTestUser(user.userId);
        cleanupTestUser(other.userId);
    });

    async function connect(t = token) {
        await request(app).put('/addons/odoo/enabled').set('Authorization', `Bearer ${t}`).send({ enabled: true });
        const response = await request(app).put('/addons/odoo').set('Authorization', `Bearer ${t}`).send({
            baseUrl: `http://127.0.0.1:${odoo.port}`, databaseName: 'panino_ee', apiKey: API_KEY,
        });
        expect(response.status).toBe(200);
    }

    function addNote(db, title, { at = new Date().toISOString() } = {}) {
        const id = uuidv4();
        db.prepare('INSERT INTO notes (id, folder_id, title, content, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)')
            .run(id, title, `# ${title}`, at, at);
        return id;
    }

    const send = (noteId, body, { key = dbKey, t = token } = {}) => request(app).post('/addons/odoo/send')
        .set('Authorization', `Bearer ${t}`)
        .send({ dbKey: key, noteId, title: 'Quote', pdfRequest: PDF_REQUEST, ...body });
    const overview = (t = token) => request(app).get('/addons/odoo/overview').set('Authorization', `Bearer ${t}`);
    const byNote = (body, noteId) => body.documents.find((doc) => doc.noteId === noteId);

    it('is behind the add-on gate', async () => {
        expect((await overview()).status).toBe(403);
    });

    it('lists a sent Document as current, and as changed after an edit but not after a pin', async () => {
        await connect();
        const db = getUserDb(user.userId);
        const noteId = addNote(db, 'Price list');
        expect((await send(noteId, { documents: { folderId: 41 } })).body.documents.ok).toBe(true);
        expect(db.prepare('SELECT sent_hash FROM odoo_links WHERE source_id = ?').get(noteId).sent_hash).toMatch(/^[0-9a-f]{64}$/);

        let body = (await overview()).body;
        expect(body.odooHost).toBe(`http://127.0.0.1:${odoo.port}`);
        expect(body.places).toEqual([{ dbKey, name: 'My Notes', role: 'owner' }]);
        expect(byNote(body, noteId)).toMatchObject({
            dbKey, title: 'Price list', state: 'current', canSend: true, lastSentBy: null, lastSentByMe: true, placeName: 'My Notes',
            records: [expect.objectContaining({ destination: 'documents', label: 'Documents PDF', sameOdoo: true, url: expect.stringMatching(/\/odoo\/documents\/tok\d+$/) })],
            failure: null,
        });

        // A pin moves updated_at only.
        db.prepare("UPDATE notes SET updated_at = '2999-01-01T00:00:00.000Z' WHERE id = ?").run(noteId);
        expect(byNote((await overview()).body, noteId).state).toBe('current');

        db.prepare("UPDATE notes SET content = '# Price list\n\nNew prices' WHERE id = ?").run(noteId);
        body = (await overview()).body;
        expect(byNote(body, noteId).state).toBe('changed');

        await send(noteId, { documents: {} });
        expect(byNote((await overview()).body, noteId).state).toBe('current');
    });

    it('falls back to the edit time for links sent before sent_hash', async () => {
        await connect();
        const db = getUserDb(user.userId);
        const noteId = addNote(db, 'Old one', { at: '2026-01-01T00:00:00.000Z' });
        await send(noteId, { documents: { folderId: 41 } });
        db.prepare("UPDATE odoo_links SET sent_hash = NULL, last_sent_at = '2026-02-01T00:00:00.000Z' WHERE source_id = ?").run(noteId);
        expect(byNote((await overview()).body, noteId).state).toBe('current');
        db.prepare("UPDATE notes SET updated_at = '2026-03-01T00:00:00.000Z' WHERE id = ?").run(noteId);
        expect(byNote((await overview()).body, noteId).state).toBe('changed');
    });

    it('never calls an internal note changed, and offers no update for it', async () => {
        await connect();
        const db = getUserDb(user.userId);
        const noteId = addNote(db, 'Offer');
        expect((await send(noteId, { chatter: { resModel: 'sale.order', resId: 1 } })).body.chatter.ok).toBe(true);
        db.prepare("UPDATE notes SET content = 'changed' WHERE id = ?").run(noteId);
        expect(byNote((await overview()).body, noteId)).toMatchObject({
            state: 'current', canSend: false,
            records: [expect.objectContaining({ destination: 'chatter', label: 'Internal note on Sales order #1' })],
        });
    });

    it('shows deleted Documents, Documents in another Odoo, and the state of their syncs', async () => {
        await connect();
        const db = getUserDb(user.userId);
        const gone = addNote(db, 'Gone');
        await send(gone, { documents: { folderId: 41 } });
        db.prepare('DELETE FROM notes WHERE id = ?').run(gone);

        const elsewhere = addNote(db, 'Elsewhere');
        await send(elsewhere, { documents: { folderId: 41 } });
        db.prepare("UPDATE odoo_links SET odoo_target = 'https://other.example|other' WHERE source_id = ?").run(elsewhere);

        const synced = addNote(db, 'Synced');
        const failing = addNote(db, 'Failing');
        const target = db.prepare('SELECT odoo_target FROM odoo_links WHERE source_id = ?').get(gone).odoo_target;
        const sync = createSync(db, { scope: 'note', sourceId: synced, odooTarget: target, parentArticleId: null, runAs: user.userId, createdBy: user.userId });
        const now = new Date().toISOString();
        const insertLink = db.prepare(`INSERT INTO odoo_links (source_id, destination, odoo_target, target_key, odoo_record_id, sync_id, first_sent_by, last_sent_at, last_sent_by)
            VALUES (?, 'knowledge', ?, '', ?, ?, ?, ?, ?)`);
        insertLink.run(synced, target, 501, sync.id, user.userId, now, user.userId);
        insertLink.run(failing, target, 502, sync.id, user.userId, now, user.userId);
        saveSyncRun(db, sync.id, { result: { created: 1, failures: [{ sourceId: failing, name: 'Failing', error: 'images_failed', images: 2 }] } });

        let body = (await overview()).body;
        expect(byNote(body, gone)).toMatchObject({ state: 'deleted', title: null, canSend: false });
        expect(byNote(body, elsewhere)).toMatchObject({ state: 'other_odoo', canSend: false, records: [expect.objectContaining({ sameOdoo: false, url: expect.stringMatching(/^https:\/\/other\.example\//) })] });
        expect(byNote(body, synced)).toMatchObject({ state: 'synced', canSend: false });
        expect(byNote(body, failing)).toMatchObject({ state: 'sync_failed', failure: { error: 'images_failed', message: 'Some images could not be uploaded to the article.' } });
        // Needs attention first.
        expect(body.documents[0].noteId).toBe(failing);
        expect(body.syncs).toEqual([expect.objectContaining({ id: sync.id, dbKey, placeName: 'My Notes', canEdit: true })]);

        setSyncStatus(db, sync.id, { status: 'paused', reason: 'key_rejected' });
        saveSyncRun(db, sync.id, { result: { created: 0, failures: [] } });
        body = (await overview()).body;
        expect(byNote(body, synced).state).toBe('sync_paused');
    });

    it('caps the list at 500, needs attention first', async () => {
        await connect();
        const db = getUserDb(user.userId);
        const now = new Date().toISOString();
        const insert = db.prepare(`INSERT INTO odoo_links (source_id, destination, odoo_target, target_key, odoo_record_id, first_sent_by, last_sent_at, last_sent_by)
            VALUES (?, 'documents', ?, '', ?, ?, ?, ?)`);
        const target = `http://127.0.0.1:${odoo.port}|panino_ee`;
        db.transaction(() => {
            for (let i = 0; i < 501; i += 1) insert.run(addNote(db, `Doc ${i}`), target, i + 1, user.userId, now, user.userId);
        })();
        const body = (await overview()).body;
        expect(body).toMatchObject({ truncated: true, total: 501 });
        expect(body.documents).toHaveLength(500);
    });

    describe('send updates', () => {
        const resend = (noteIds, { key = dbKey, t = token } = {}) => request(app).post('/addons/odoo/resend')
            .set('Authorization', `Bearer ${t}`).send({ dbKey: key, noteIds });

        it('is behind the add-on gate', async () => {
            expect((await resend(['x'])).status).toBe(403);
        });

        it('updates existing Documents and Knowledge records, rendered on the server, and clears changed', async () => {
            await connect();
            const db = getUserDb(user.userId);
            const noteId = addNote(db, 'Price list');
            await send(noteId, { documents: { folderId: 41 }, knowledge: { parentId: 0, html: '<h1>Price list</h1>' } });
            const docsBefore = odoo.state.docs.size;
            db.prepare("UPDATE notes SET content = '# Price list\n\nNew **prices**' WHERE id = ?").run(noteId);
            expect(byNote((await overview()).body, noteId).state).toBe('changed');

            const response = await resend([noteId]);
            expect(response.status).toBe(200);
            expect(response.body.results[noteId]).toMatchObject({
                ok: true,
                documents: { ok: true, created: false },
                knowledge: { ok: true, created: false },
            });
            expect(odoo.state.docs.size).toBe(docsBefore);
            const write = odoo.state.requests.filter((r) => r.url === '/json/2/knowledge.article/write').at(-1);
            expect(JSON.stringify(write.params)).toContain('<strong>prices</strong>');
            expect(byNote((await overview()).body, noteId).state).toBe('current');
        });

        it('never creates a record or posts to an opportunity or sales order', async () => {
            await connect();
            const db = getUserDb(user.userId);
            const chatterOnly = addNote(db, 'Offer');
            await send(chatterOnly, { chatter: { resModel: 'sale.order', resId: 1 } });
            const messages = odoo.state.messages.length;
            const response = await resend([chatterOnly, 'missing-note']);
            expect(response.body.results[chatterOnly]).toMatchObject({ ok: false, error: 'not_sent' });
            expect(response.body.results['missing-note']).toMatchObject({ ok: false, error: 'not_found' });
            expect(odoo.state.messages.length).toBe(messages);
            expect(odoo.state.docs.size).toBe(0);
        });

        it('skips a Knowledge article a sync looks after', async () => {
            await connect();
            const db = getUserDb(user.userId);
            const noteId = addNote(db, 'Synced');
            await send(noteId, { documents: { folderId: 41 } });
            const target = db.prepare('SELECT odoo_target FROM odoo_links WHERE source_id = ?').get(noteId).odoo_target;
            createSync(db, { scope: 'note', sourceId: noteId, odooTarget: target, parentArticleId: null, runAs: user.userId, createdBy: user.userId });
            db.prepare(`INSERT INTO odoo_links (source_id, destination, odoo_target, target_key, odoo_record_id, sync_id, first_sent_by, last_sent_at, last_sent_by)
                VALUES (?, 'knowledge', ?, '', 900, (SELECT id FROM odoo_syncs LIMIT 1), ?, ?, ?)`).run(noteId, target, user.userId, new Date().toISOString(), user.userId);
            const response = await resend([noteId]);
            expect(response.body.results[noteId]).toMatchObject({ ok: true, documents: { ok: true } });
            expect(response.body.results[noteId].knowledge).toBeUndefined();
        });

        it('refuses bad input, more than 25, another person’s database, and no connection', async () => {
            expect((await resend([])).status).toBe(403);
            await request(app).put('/addons/odoo/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: true });
            expect((await resend(['a'])).status).toBe(409);
            await connect();
            expect((await resend([])).status).toBe(400);
            expect((await resend(Array.from({ length: 26 }, (_, i) => `n${i}`))).body.error).toBe('too_many');
            expect((await resend(['a'], { key: `user:${other.userId}` })).status).toBe(404);
        });

        it('counts one press as one send against the rate limit', async () => {
            await connect();
            const db = getUserDb(user.userId);
            const ids = [];
            for (let i = 0; i < 12; i += 1) {
                const id = addNote(db, `Doc ${i}`);
                ids.push(id);
                db.prepare(`INSERT INTO odoo_links (source_id, destination, odoo_target, target_key, odoo_record_id, first_sent_by, last_sent_at, last_sent_by)
                    VALUES (?, 'chatter', 'x|y', 'sale.order:1', 1, ?, ?, ?)`).run(id, user.userId, new Date().toISOString(), user.userId);
            }
            const response = await resend(ids);
            expect(response.status).toBe(200);
            expect(Object.keys(response.body.results)).toHaveLength(12);
        });
    });

    describe('with shared spaces', () => {
        let spaceId;

        beforeEach(() => {
            process.env.SHARED_SPACES_ENABLED = 'true';
            ({ spaceId } = createSpace({ actorUserId: other.userId, name: 'Writers' }));
            addEditorMember({ actorUserId: other.userId, spaceId, userId: user.userId });
        });

        afterEach(() => {
            const spacesDb = getSpacesDb();
            spacesDb.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
            spacesDb.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
            deleteTestDb(`space:${spaceId}`);
            delete process.env.SHARED_SPACES_ENABLED;
        });

        it('includes what another member sent in a space, with their name', async () => {
            const spaceKey = `space:${spaceId}`;
            const noteId = addNote(getDb(spaceKey), 'Q3 proposal');
            const otherToken = getTestToken(other.userId);
            await connect(otherToken);
            expect((await send(noteId, { documents: { folderId: 41 } }, { key: spaceKey, t: otherToken })).body.documents.ok).toBe(true);

            await connect();
            const body = (await overview()).body;
            expect(body.places.map((place) => place.name)).toEqual(['Writers']);
            expect(byNote(body, noteId)).toMatchObject({
                dbKey: spaceKey, placeName: 'Writers', state: 'current', canSend: true, lastSentBy: 'Test User', lastSentByMe: false,
            });
        });

        it('leaves out a space the caller is no longer in', async () => {
            const spaceKey = `space:${spaceId}`;
            const noteId = addNote(getDb(spaceKey), 'Q3 proposal');
            await connect();
            await send(noteId, { documents: { folderId: 41 } }, { key: spaceKey });
            getSpacesDb().prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(spaceId, user.userId);
            const body = (await overview()).body;
            expect(body.documents).toEqual([]);
            expect(body.places).toEqual([]);
        });
    });
});
