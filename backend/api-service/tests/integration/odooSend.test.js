import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../testHelpers.js';
import { deleteTestDb, getDb, getSpacesDb, getUserDb } from '../../db.js';
import { resetOdooRateLimits } from '../../odoo.js';
import { resetFileFieldCache } from '../../odooClient.js';
import { addEditorMember, createSpace } from '../../spaces.js';
import { API_KEY, resetFakeOdoo, startFakeOdoo } from '../fakeOdoo.js';

const PDF_REQUEST = { htmlContent: '<h1>Quote</h1><p>Hello Odoo</p>', cssStyles: '', printStyles: {} };

describe('Sending a Document to Odoo Documents', () => {
    let app;
    let odoo;
    let user;
    let other;
    let token;
    let noteId;
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
        user = await setupTestUser(`odoo-send-${stamp}@example.test`, 'password123');
        other = await setupTestUser(`odoo-send-other-${stamp}@example.test`, 'password123');
        token = getTestToken(user.userId);
        dbKey = `user:${user.userId}`;
        noteId = uuidv4();
        const now = new Date().toISOString();
        getUserDb(user.userId).prepare(`
            INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
            VALUES (?, ?, NULL, ?, ?, ?, ?)
        `).run(noteId, user.userId, 'Quote / Acme: v1', '# Quote', now, now);
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
    const send = (body, t = token) => request(app).post('/addons/odoo/send').set('Authorization', `Bearer ${t}`)
        .send({ dbKey, noteId, title: 'Quote / Acme: v1', pdfRequest: PDF_REQUEST, ...body });
    const storedPdf = (docId) => odoo.state.attachments.get(odoo.state.docs.get(docId).attachment_id);
    const link = () => getUserDb(user.userId).prepare("SELECT * FROM odoo_links WHERE source_id = ? AND destination = 'documents'").get(noteId);

    it('creates the PDF in the chosen folder, checks it, and links it', async () => {
        await connect();
        const response = await send({ documents: { folderId: 41 } });
        expect(response.status).toBe(200);
        expect(response.body.documents).toMatchObject({ ok: true, created: true, recreated: false });
        // Built on the connection's address, not Odoo's own localhost:8069.
        expect(response.body.documents.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${odoo.port}/odoo/documents/tok\\d+$`));

        const [doc] = [...odoo.state.docs.values()];
        expect(doc).toMatchObject({ name: 'Quote Acme v1.pdf', folder_id: 41 });
        const pdf = storedPdf(doc.id);
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        const created = odoo.state.requests.find((r) => r.url === '/json/2/documents.document/create');
        expect(Object.keys(created.params.vals_list[0])).toContain('raw');
        expect(Object.keys(created.params.vals_list[0])).not.toContain('datas');

        expect(link()).toMatchObject({ odoo_record_id: doc.id, odoo_create_date: doc.create_date, first_sent_by: user.userId });
        const defaults = getUserDb(user.userId).prepare('SELECT folder_id FROM odoo_defaults').get();
        expect(defaults.folder_id).toBe(41);
    });

    it('uses datas on Odoo 19', async () => {
        odoo.state.version = 19;
        await connect();
        const response = await send({ documents: { folderId: 2 } });
        expect(response.body.documents.ok).toBe(true);
        const created = odoo.state.requests.find((r) => r.url === '/json/2/documents.document/create');
        expect(Object.keys(created.params.vals_list[0])).toContain('datas');
        const [doc] = [...odoo.state.docs.values()];
        expect(storedPdf(doc.id).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('overwrites the same document on the next send, without a folder', async () => {
        await connect();
        await send({ documents: { folderId: 41 } });
        const [first] = [...odoo.state.docs.values()];
        const response = await send({ title: 'Quote v2', documents: {} });
        expect(response.body.documents).toMatchObject({ ok: true, created: false });
        expect(odoo.state.docs.size).toBe(1);
        expect(odoo.state.docs.get(first.id).name).toBe('Quote v2.pdf');
    });

    it('recreates a document that was deleted in Odoo, in the remembered folder', async () => {
        await connect();
        await send({ documents: { folderId: 41 } });
        const [first] = [...odoo.state.docs.values()];
        odoo.state.docs.delete(first.id);
        const response = await send({ documents: {} });
        expect(response.body.documents).toMatchObject({ ok: true, created: true, recreated: true });
        const [second] = [...odoo.state.docs.values()];
        expect(second.id).not.toBe(first.id);
        expect(second.folder_id).toBe(41);
        expect(link().odoo_record_id).toBe(second.id);
    });

    it('never writes to a record that is not the one Panino created', async () => {
        await connect();
        await send({ documents: { folderId: 41 } });
        const [first] = [...odoo.state.docs.values()];
        // Same id, different record: e.g. a database restored behind the same URL.
        first.create_date = '2020-01-01 00:00:00';
        first.name = 'Someone else’s file.pdf';
        const response = await send({ documents: {} });
        expect(response.body.documents).toMatchObject({ ok: true, created: true, recreated: true });
        expect(first.name).toBe('Someone else’s file.pdf');
        expect(odoo.state.requests.filter((r) => r.url === '/json/2/documents.document/write')).toHaveLength(0);
    });

    it('reports an upload Odoo did not store, and keeps the link so a resend fixes it', async () => {
        await connect();
        odoo.state.ignoreContent = true;
        const response = await send({ documents: { folderId: 41 } });
        expect(response.body.documents).toMatchObject({ ok: false, error: 'upload_corrupt' });
        expect(link()).toBeTruthy();

        odoo.state.ignoreContent = false;
        const again = await send({ documents: {} });
        expect(again.body.documents).toMatchObject({ ok: true, created: false });
        expect(odoo.state.docs.size).toBe(1);
    });

    it('needs a folder for the first send', async () => {
        await connect();
        const response = await send({ documents: {} });
        expect(response.body.documents).toMatchObject({ ok: false, error: 'missing_folder' });
        expect(odoo.state.docs.size).toBe(0);
    });

    it('sends one at a time per Document', async () => {
        await connect();
        odoo.state.createDelayMs = 1500;
        const [a, b] = await Promise.all([
            send({ documents: { folderId: 41 } }),
            new Promise((resolve) => setTimeout(resolve, 300)).then(() => send({ documents: { folderId: 41 } })),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
        expect(odoo.state.docs.size).toBe(1);
    });

    it('records a rejected key on the connection', async () => {
        await connect();
        odoo.state.keyValid = false;
        const response = await send({ documents: { folderId: 41 } });
        expect(response.body.documents).toMatchObject({ ok: false, error: 'key_rejected' });
        const status = await request(app).get('/addons/odoo').set('Authorization', `Bearer ${token}`);
        expect(status.body.lastError).toBe('key_rejected');
    });

    it('refuses other people’s Documents, unknown Documents, and senders without a connection', async () => {
        await connect();
        await connect(getTestToken(other.userId));
        const otherToken = getTestToken(other.userId);
        expect((await send({ documents: { folderId: 41 } }, otherToken)).status).toBe(404);
        expect((await send({ noteId: uuidv4(), documents: { folderId: 41 } })).status).toBe(404);
        expect((await send({ dbKey: 'user:not-a-uuid', documents: { folderId: 41 } })).status).toBe(400);
        await request(app).delete('/addons/odoo').set('Authorization', `Bearer ${token}`);
        expect((await send({ documents: { folderId: 41 } })).status).toBe(409);
        expect(odoo.state.docs.size).toBe(0);
    });

    it('lists folders and what was sent, with who sent it', async () => {
        await connect();
        const folders = await request(app).get('/addons/odoo/folders?q=sal').set('Authorization', `Bearer ${token}`);
        expect(folders.body.folders).toContainEqual({ id: 41, name: 'Sales', parentName: 'Finance' });
        const search = odoo.state.requests.find((r) => r.url === '/json/2/documents.document/search_read');
        expect(search.params.domain).toEqual([['type', '=', 'folder'], ['name', 'ilike', 'sal']]);

        await send({ documents: { folderId: 41 } });
        const links = await request(app).get('/addons/odoo/links').query({ dbKey, noteId }).set('Authorization', `Bearer ${token}`);
        expect(links.status).toBe(200);
        expect(links.body.defaults).toEqual({ folderId: 41, parentArticleId: null });
        expect(links.body.links).toEqual([expect.objectContaining({
            destination: 'documents', sameOdoo: true, lastSentBy: 'Test User',
            url: expect.stringMatching(/\/odoo\/documents\/tok\d+$/),
        })]);
    });

    describe('in a shared space', () => {
        let spaceId;
        let outsider;

        beforeEach(async () => {
            process.env.SHARED_SPACES_ENABLED = 'true';
            outsider = await setupTestUser(`odoo-space-outsider-${Date.now()}@example.test`, 'password123');
            ({ spaceId } = createSpace({ actorUserId: other.userId, name: `Odoo space ${Date.now()}` }));
            addEditorMember({ actorUserId: other.userId, spaceId, userId: user.userId });
            dbKey = `space:${spaceId}`;
            const now = new Date().toISOString();
            getDb(dbKey).prepare('INSERT INTO notes (id, folder_id, title, content, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)')
                .run(noteId, 'Space quote', '# Space quote', now, now);
        });

        afterEach(() => {
            const spacesDb = getSpacesDb();
            spacesDb.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
            spacesDb.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
            deleteTestDb(`space:${spaceId}`);
            cleanupTestUser(outsider.userId);
            delete process.env.SHARED_SPACES_ENABLED;
        });

        it('lets an editor send with their own connection, and links it in the space', async () => {
            await connect();
            const response = await send({ documents: { folderId: 41 } });
            expect(response.body.documents.ok).toBe(true);
            const spaceLink = getDb(dbKey).prepare("SELECT * FROM odoo_links WHERE source_id = ?").get(noteId);
            expect(spaceLink).toMatchObject({ destination: 'documents', first_sent_by: user.userId });
            expect(getUserDb(user.userId).prepare('SELECT COUNT(*) AS n FROM odoo_links').get().n).toBe(0);
        });

        it('lets the owner update what the editor sent', async () => {
            await connect();
            await send({ documents: { folderId: 41 } });
            await connect(getTestToken(other.userId));
            const response = await send({ documents: {} }, getTestToken(other.userId));
            expect(response.body.documents).toMatchObject({ ok: true, created: false });
            expect(odoo.state.docs.size).toBe(1);
            const spaceLink = getDb(dbKey).prepare('SELECT * FROM odoo_links WHERE source_id = ?').get(noteId);
            expect(spaceLink).toMatchObject({ first_sent_by: user.userId, last_sent_by: other.userId });
        });

        it('refuses someone outside the space', async () => {
            await connect(getTestToken(outsider.userId));
            expect((await send({ documents: { folderId: 41 } }, getTestToken(outsider.userId))).status).toBe(404);
            const links = await request(app).get('/addons/odoo/links').query({ dbKey, noteId }).set('Authorization', `Bearer ${getTestToken(outsider.userId)}`);
            expect(links.status).toBe(404);
        });
    });
});
