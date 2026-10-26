import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../testHelpers.js';
import { deleteTestDb, getDb, getSpacesDb, getUserDb } from '../../db.js';
import { resetOdooRateLimits } from '../../odoo.js';
import { resetFileFieldCache } from '../../odooClient.js';
import { addEditorMember, createSpace } from '../../spaces.js';

const API_KEY = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678';
const sha1 = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex');

/**
 * A stand-in Odoo Documents behaving as Odoo 19 and 20 did in Phase 0:
 * - v19 takes base64 in `datas`; v20 has no `datas` and takes base64 in `raw`;
 *   the wrong field is accepted and stores nothing (Odoo 20) or the base64 text (Odoo 19);
 * - `read` of a missing id answers `[]`;
 * - `access_url` is built on Odoo's own `web.base.url`.
 */
function startFakeOdoo() {
    const state = {
        version: 20, keyValid: true, ignoreContent: false, createDelayMs: 0,
        nextId: 100, docs: new Map(), attachments: new Map(), requests: [],
    };
    const fileFieldName = () => (state.version >= 20 ? 'raw' : 'datas');
    const store = (vals) => {
        const field = fileFieldName();
        if (state.ignoreContent || !(field in vals)) return Buffer.alloc(0);
        return Buffer.from(vals[field], 'base64');
    };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
            const params = body ? JSON.parse(body) : {};
            state.requests.push({ url: req.url, params });
            const send = (status, value) => {
                res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(value));
            };
            if (req.url === '/web/version') return send(200, { version_info: [state.version, 0, 0, 'final', 0, 'e'], version: `${state.version}.0+e` });
            if (req.headers.authorization !== `bearer ${API_KEY}` || !state.keyValid) {
                return send(401, { name: 'werkzeug.exceptions.Unauthorized', message: 'Invalid apikey', debug: 'Traceback…' });
            }
            switch (req.url) {
                case '/json/2/res.users/context_get': return send(200, { uid: 2 });
                case '/json/2/res.users/read': return send(200, [{ id: 2, name: 'Mitchell Admin' }]);
                case '/json/2/documents.document/search_count':
                case '/json/2/crm.lead/search_count': return send(200, 0);
                case '/json/2/documents.document/fields_get':
                    return send(200, state.version >= 20 ? { raw: { type: 'binary' } } : { datas: { type: 'binary' }, raw: { type: 'binary' } });
                case '/json/2/documents.document/search_read':
                    return send(200, [{ id: 2, name: 'Inbox', folder_id: false }, { id: 41, name: 'Sales', folder_id: [3, 'Finance'] }]);
                case '/json/2/documents.document/create': {
                    if (state.createDelayMs) await new Promise((r) => setTimeout(r, state.createDelayMs));
                    const ids = params.vals_list.map((vals) => {
                        const id = state.nextId++;
                        const attachmentId = state.nextId++;
                        state.attachments.set(attachmentId, store(vals));
                        state.docs.set(id, { id, name: vals.name, folder_id: vals.folder_id, attachment_id: attachmentId, create_date: `2026-10-27 09:00:${String(id % 60).padStart(2, '0')}` });
                        return id;
                    });
                    return send(200, ids);
                }
                case '/json/2/documents.document/read':
                    return send(200, params.ids.filter((id) => state.docs.has(id)).map((id) => {
                        const doc = state.docs.get(id);
                        return { id, create_date: doc.create_date, attachment_id: [doc.attachment_id, doc.name], access_url: `http://localhost:8069/odoo/documents/tok${id}` };
                    }));
                case '/json/2/documents.document/write':
                    for (const id of params.ids) {
                        const doc = state.docs.get(id);
                        if (!doc) return send(500, { name: 'odoo.exceptions.MissingError', message: 'gone' });
                        if (params.vals.name) doc.name = params.vals.name;
                        state.attachments.set(doc.attachment_id, store(params.vals));
                    }
                    return send(200, true);
                case '/json/2/ir.attachment/read':
                    return send(200, params.ids.filter((id) => state.attachments.has(id)).map((id) => ({ id, checksum: sha1(state.attachments.get(id)) })));
                default:
                    return send(404, { name: 'werkzeug.exceptions.NotFound', message: 'the model does not exist' });
            }
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}

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
        Object.assign(odoo.state, { version: 20, keyValid: true, ignoreContent: false, createDelayMs: 0 });
        odoo.state.docs.clear();
        odoo.state.attachments.clear();
        odoo.state.requests = [];
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
        const response = await request(app).put('/integrations/odoo').set('Authorization', `Bearer ${t}`).send({
            baseUrl: `http://127.0.0.1:${odoo.port}`, databaseName: 'panino_ee', apiKey: API_KEY,
        });
        expect(response.status).toBe(200);
    }
    const send = (body, t = token) => request(app).post('/integrations/odoo/send').set('Authorization', `Bearer ${t}`)
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
        const status = await request(app).get('/integrations/odoo').set('Authorization', `Bearer ${token}`);
        expect(status.body.lastError).toBe('key_rejected');
    });

    it('refuses other people’s Documents, unknown Documents, and senders without a connection', async () => {
        await connect();
        await connect(getTestToken(other.userId));
        const otherToken = getTestToken(other.userId);
        expect((await send({ documents: { folderId: 41 } }, otherToken)).status).toBe(404);
        expect((await send({ noteId: uuidv4(), documents: { folderId: 41 } })).status).toBe(404);
        expect((await send({ dbKey: 'user:not-a-uuid', documents: { folderId: 41 } })).status).toBe(400);
        await request(app).delete('/integrations/odoo').set('Authorization', `Bearer ${token}`);
        expect((await send({ documents: { folderId: 41 } })).status).toBe(409);
        expect(odoo.state.docs.size).toBe(0);
    });

    it('lists folders and what was sent, with who sent it', async () => {
        await connect();
        const folders = await request(app).get('/integrations/odoo/folders?q=sal').set('Authorization', `Bearer ${token}`);
        expect(folders.body.folders).toContainEqual({ id: 41, name: 'Sales', parentName: 'Finance' });
        const search = odoo.state.requests.find((r) => r.url === '/json/2/documents.document/search_read');
        expect(search.params.domain).toEqual([['type', '=', 'folder'], ['name', 'ilike', 'sal']]);

        await send({ documents: { folderId: 41 } });
        const links = await request(app).get('/integrations/odoo/links').query({ dbKey, noteId }).set('Authorization', `Bearer ${token}`);
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
            const links = await request(app).get('/integrations/odoo/links').query({ dbKey, noteId }).set('Authorization', `Bearer ${getTestToken(outsider.userId)}`);
            expect(links.status).toBe(404);
        });
    });
});
