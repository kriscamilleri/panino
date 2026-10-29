import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../testHelpers.js';
import { getUserDb } from '../../db.js';
import { resetOdooRateLimits } from '../../odoo.js';
import { resetFileFieldCache } from '../../odooClient.js';
import { createSync, readSync } from '../../odooSync.js';
import { __configureSyncSchedulerForTests, runSyncNow } from '../../odooSyncScheduler.js';
import { API_KEY, resetFakeOdoo, startFakeOdoo } from '../fakeOdoo.js';

describe('PDFs filed by a sync (Phase 12)', () => {
    let app;
    let odoo;
    let user;
    let token;
    let dbKey;
    let db;
    const saved = {};
    const now = () => new Date().toISOString();

    beforeAll(async () => {
        for (const name of ['ODOO_INTEGRATION_ENABLED', 'ODOO_CREDENTIAL_ENCRYPTION_KEY', 'ODOO_ALLOWED_PRIVATE_HOSTS']) saved[name] = process.env[name];
        ({ app } = createTestApp());
        odoo = await startFakeOdoo();
    });

    afterAll(async () => {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        __configureSyncSchedulerForTests({ debounce: 3 * 60 * 1000, settle: 2000 });
        await new Promise((resolve) => odoo.server.close(resolve));
    });

    beforeEach(async () => {
        process.env.ODOO_INTEGRATION_ENABLED = 'true';
        process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY = 'test-odoo-credential-key-0123456789abcdef';
        process.env.ODOO_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
        resetFakeOdoo(odoo.state);
        resetOdooRateLimits();
        resetFileFieldCache();
        __configureSyncSchedulerForTests({ debounce: 150, settle: 0 });
        user = await setupTestUser(`odoo-sync-pdf-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@example.test`, 'password123');
        token = getTestToken(user.userId);
        dbKey = `user:${user.userId}`;
        db = getUserDb(user.userId);
    });

    afterEach(() => {
        __configureSyncSchedulerForTests({});
        cleanupTestUser(user.userId);
    });

    const auth = () => ({ Authorization: `Bearer ${token}` });
    async function connect() {
        await request(app).put('/addons/odoo/enabled').set(auth()).send({ enabled: true });
        const response = await request(app).put('/addons/odoo').set(auth()).send({
            baseUrl: `http://127.0.0.1:${odoo.port}`, databaseName: 'panino_ee', apiKey: API_KEY,
        });
        expect(response.status).toBe(200);
    }
    const target = () => `http://127.0.0.1:${odoo.port}|panino_ee`;
    function folder(name, parentId = null) {
        const id = uuidv4();
        db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)').run(id, user.userId, name, parentId, now());
        return id;
    }
    function note(title, content, folderId = null) {
        const id = uuidv4();
        db.prepare('INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(id, user.userId, folderId, title, content, now(), now());
        return id;
    }
    const docs = () => [...odoo.state.docs.values()];
    const calls = (suffix) => odoo.state.requests.filter((r) => r.url.endsWith(suffix));
    const run = (syncId, options) => runSyncNow(dbKey, syncId, options).then((r) => r.result);
    const pdfLink = (noteId) => db.prepare("SELECT * FROM odoo_links WHERE destination = 'documents' AND source_id = ?").get(noteId);

    it('files a PDF of each Document in the chosen Documents folder and only re-renders what changed', async () => {
        await connect();
        const folderId = folder('Docs');
        const a = note('Alpha', '# Alpha\n\nFirst', folderId);
        note('Beta', 'Second', folderId);
        const sync = createSync(db, { scope: 'folder', sourceId: folderId, odooTarget: target(), parentArticleId: 10, documentsFolderId: 41, runAs: user.userId, createdBy: user.userId });
        const result = await run(sync.id);
        expect(result).toMatchObject({ created: 2, pdfs: 2, failures: [] });

        expect(docs().map((d) => [d.name, d.folder_id]).sort()).toEqual([['Alpha.pdf', 41], ['Beta.pdf', 41]]);
        for (const doc of docs()) {
            expect(odoo.state.attachments.get(doc.attachment_id).subarray(0, 5).toString()).toBe('%PDF-');
        }
        expect(pdfLink(a)).toMatchObject({ sync_id: sync.id });
        expect(pdfLink(a).content_hash).toMatch(/^[0-9a-f]{64}$/);

        odoo.state.requests = [];
        expect(await run(sync.id)).toMatchObject({ unchanged: 2, pdfs: 0 });
        expect(calls('/documents.document/write')).toHaveLength(0);
        expect(calls('/documents.document/create')).toHaveLength(0);

        db.prepare('UPDATE notes SET content = ? WHERE id = ?').run('Changed', a);
        expect(await run(sync.id)).toMatchObject({ updated: 1, pdfs: 1 });
        expect(calls('/documents.document/write')).toHaveLength(1);
        expect(docs()).toHaveLength(2);

        // A print style change alone re-renders too, with nothing else to write.
        db.prepare("INSERT OR REPLACE INTO settings (id, value) VALUES ('printStyles', ?)").run(JSON.stringify({ h1: 'color: red' }));
        odoo.state.requests = [];
        expect(await run(sync.id)).toMatchObject({ unchanged: 2, pdfs: 2 });
        expect(calls('/knowledge.article/write')).toHaveLength(0);
        expect(calls('/documents.document/write')).toHaveLength(2);
    });

    it('is off unless a folder was chosen, and reports a PDF that could not be filed', async () => {
        await connect();
        const folderId = folder('Docs');
        note('Alpha', 'First', folderId);
        const plain = createSync(db, { scope: 'folder', sourceId: folderId, odooTarget: target(), parentArticleId: 10, runAs: user.userId, createdBy: user.userId });
        expect(await run(plain.id)).toMatchObject({ created: 1, pdfs: 0 });
        expect(docs()).toHaveLength(0);

        odoo.state.ignoreContent = true;
        const withPdfs = createSync(db, { scope: 'note', sourceId: note('Gamma', 'Third'), odooTarget: target(), documentsFolderId: 41, runAs: user.userId, createdBy: user.userId });
        const result = await run(withPdfs.id);
        expect(result).toMatchObject({ created: 1, pdfs: 0 });
        expect(result.failures).toEqual([{ sourceId: expect.any(String), name: 'Gamma', error: 'upload_corrupt', pdf: true }]);
        expect(JSON.parse(readSync(db, withPdfs.id).last_result).failures).toHaveLength(1);
    });

    it('takes the Documents folder from the route and validates it', async () => {
        await connect();
        const folderId = folder('Docs');
        note('Alpha', 'First', folderId);
        const bad = await request(app).post('/addons/odoo/syncs').set(auth()).send({ dbKey, scope: 'folder', sourceId: folderId, parentArticleId: 10, documentsFolderId: 'x' });
        expect(bad.status).toBe(400);
        const gone = await request(app).post('/addons/odoo/syncs').set(auth()).send({ dbKey, scope: 'folder', sourceId: folderId, parentArticleId: 10, documentsFolderId: 999 });
        expect(gone.body).toMatchObject({ error: 'record_gone' });

        const created = await request(app).post('/addons/odoo/syncs').set(auth()).send({ dbKey, scope: 'folder', sourceId: folderId, parentArticleId: 10, documentsFolderId: 41 });
        expect(created.status).toBe(201);
        expect(created.body.sync.documentsFolderId).toBe(41);
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(docs().map((d) => d.name)).toEqual(['Alpha.pdf']);
        const listed = await request(app).get('/addons/odoo/syncs').query({ dbKey }).set(auth());
        expect(listed.body.syncs[0].lastResult).toMatchObject({ created: 1, pdfs: 1 });
    });

    it('recreates on the daily reconcile a PDF deleted or replaced in Odoo, and reports one it cannot', async () => {
        await connect();
        const a = note('Alpha', 'First');
        const sync = createSync(db, { scope: 'note', sourceId: a, odooTarget: target(), documentsFolderId: 41, runAs: user.userId, createdBy: user.userId });
        expect(await run(sync.id)).toMatchObject({ created: 1, pdfs: 1 });
        const first = pdfLink(a).odoo_record_id;

        // Deleted in Odoo: an ordinary run keeps trusting the hash, the daily pass notices.
        odoo.state.docs.delete(first);
        odoo.state.requests = [];
        expect(await run(sync.id)).toMatchObject({ unchanged: 1, pdfs: 0, failures: [] });
        expect(calls('/documents.document/read')).toHaveLength(0);
        expect(await run(sync.id, { reconcile: true })).toMatchObject({ unchanged: 1, pdfs: 1, failures: [] });
        expect(docs().map((d) => d.name)).toEqual(['Alpha.pdf']);
        const second = pdfLink(a).odoo_record_id;
        expect(second).not.toBe(first);

        // Another record under the same id: not Panino's, so it is left alone and a new one filed.
        odoo.state.docs.get(second).create_date = '2000-01-01 00:00:00';
        expect(await run(sync.id, { reconcile: true })).toMatchObject({ pdfs: 1, failures: [] });
        expect(docs()).toHaveLength(2);
        expect(pdfLink(a).odoo_record_id).not.toBe(second);

        // Still there and still ours: nothing to render.
        odoo.state.requests = [];
        expect(await run(sync.id, { reconcile: true })).toMatchObject({ unchanged: 1, pdfs: 0 });
        expect(calls('/documents.document/create')).toHaveLength(0);
        expect(calls('/documents.document/write')).toHaveLength(0);

        // A repair that fails is a PDF failure; the article is untouched.
        odoo.state.docs.delete(pdfLink(a).odoo_record_id);
        odoo.state.ignoreContent = true;
        const failed = await run(sync.id, { reconcile: true });
        expect(failed).toMatchObject({ unchanged: 1, pdfs: 0 });
        expect(failed.failures).toEqual([{ sourceId: a, name: 'Alpha', error: 'upload_corrupt', pdf: true }]);
    });
});
