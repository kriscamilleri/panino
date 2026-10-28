import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../testHelpers.js';
import { getUserDb } from '../../db.js';
import { resetOdooRateLimits } from '../../odoo.js';
import { resetFileFieldCache } from '../../odooClient.js';
import { API_KEY, resetFakeOdoo, startFakeOdoo } from '../fakeOdoo.js';

const HTML = '<h1>Quote / Acme: v1</h1><p>Hello <b>Odoo</b></p>'
    + '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked=""> done</li></ul>'
    + '<p><img src="/images/x.png" alt="Plan"></p><script>alert(1)</script>';
const BODY = '<p>Hello <b>Odoo</b></p><ul class="o_checklist"><li class="o_checked">done</li></ul>'
    + '<p><span class="o_panino_image_placeholder">Image not sent: Plan</span></p>';

describe('Sending a Document to Odoo Knowledge', () => {
    let app;
    let odoo;
    let user;
    let token;
    let noteId;
    let dbKey;
    const saved = {};

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
        await new Promise((resolve) => odoo.server.close(resolve));
    });

    beforeEach(async () => {
        process.env.ODOO_INTEGRATION_ENABLED = 'true';
        process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY = 'test-odoo-credential-key-0123456789abcdef';
        process.env.ODOO_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
        resetFakeOdoo(odoo.state);
        resetOdooRateLimits();
        resetFileFieldCache();
        user = await setupTestUser(`odoo-knowledge-${Date.now()}@example.test`, 'password123');
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
    });

    async function connect() {
        await request(app).put('/addons/odoo/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: true });
        const response = await request(app).put('/addons/odoo').set('Authorization', `Bearer ${token}`).send({
            baseUrl: `http://127.0.0.1:${odoo.port}`, databaseName: 'panino_ee', apiKey: API_KEY,
        });
        expect(response.status).toBe(200);
        return response.body;
    }
    const send = (body) => request(app).post('/addons/odoo/send').set('Authorization', `Bearer ${token}`)
        .send({ dbKey, noteId, title: 'Quote / Acme: v1', ...body });
    const link = () => getUserDb(user.userId).prepare("SELECT * FROM odoo_links WHERE source_id = ? AND destination = 'knowledge'").get(noteId);
    const defaults = () => getUserDb(user.userId).prepare('SELECT * FROM odoo_defaults').get();
    const calls = (suffix) => odoo.state.requests.filter((r) => r.url.endsWith(suffix));
    const created = () => [...odoo.state.articles.values()].filter((a) => a.id >= 100);

    it('creates the article under the chosen parent, with the converted body, and needs no PDF', async () => {
        await connect();
        const response = await send({ knowledge: { parentId: 11, html: HTML } });
        expect(response.status).toBe(200);
        expect(response.body.knowledge).toMatchObject({ ok: true, created: true, recreated: false });
        expect(response.body.documents).toBeUndefined();
        expect(response.body.chatter).toBeUndefined();

        const [article] = created();
        expect(article).toMatchObject({ name: 'Quote / Acme: v1', body: BODY, parent_id: [11, 'Sales playbook'] });
        expect(response.body.knowledge.url).toBe(`http://127.0.0.1:${odoo.port}/knowledge/article/${article.id}`);
        expect(link()).toMatchObject({ odoo_record_id: article.id, odoo_create_date: article.create_date, odoo_url_path: `/knowledge/article/${article.id}` });
        expect(defaults()).toMatchObject({ parent_article_id: 11, folder_id: null });
    });

    it('puts an article at the top level and remembers that', async () => {
        await connect();
        const response = await send({ knowledge: { parentId: 0, html: HTML } });
        expect(response.body.knowledge.ok).toBe(true);
        expect(created()[0].parent_id).toBe(false);
        expect(calls('/knowledge.article/create')[0].params.vals_list[0].parent_id).toBe(false);
        expect(defaults().parent_article_id).toBe(0);
    });

    it('overwrites the same article on the next send, ignoring the parent', async () => {
        await connect();
        await send({ knowledge: { parentId: 11, html: HTML } });
        const [first] = created();
        const response = await send({ title: 'Quote v2', knowledge: { parentId: 10, html: '<p>Changed</p>' } });
        expect(response.body.knowledge).toMatchObject({ ok: true, created: false });
        expect(created()).toHaveLength(1);
        expect(odoo.state.articles.get(first.id)).toMatchObject({ name: 'Quote v2', body: '<p>Changed</p>', parent_id: [11, 'Sales playbook'] });
        expect(calls('/knowledge.article/write')[0].params).toEqual({ ids: [first.id], vals: { name: 'Quote v2', body: '<p>Changed</p>' } });
        expect(link().odoo_record_id).toBe(first.id);
    });

    it('recreates an article that was deleted in Odoo, under the remembered parent', async () => {
        await connect();
        await send({ knowledge: { parentId: 11, html: HTML } });
        const [first] = created();
        odoo.state.articles.delete(first.id);
        const response = await send({ knowledge: { html: HTML } });
        expect(response.body.knowledge).toMatchObject({ ok: true, created: true, recreated: true });
        const [second] = created();
        expect(second.id).not.toBe(first.id);
        expect(second.parent_id).toEqual([11, 'Sales playbook']);
        expect(link().odoo_record_id).toBe(second.id);
    });

    it('never writes to an article that is not the one Panino created', async () => {
        await connect();
        await send({ knowledge: { parentId: 11, html: HTML } });
        const [first] = created();
        first.create_date = '2020-01-01 00:00:00';
        first.body = '<p>Someone else’s</p>';
        const response = await send({ knowledge: { html: HTML } });
        expect(response.body.knowledge).toMatchObject({ ok: true, created: true, recreated: true });
        expect(first.body).toBe('<p>Someone else’s</p>');
        expect(calls('/knowledge.article/write')).toHaveLength(0);
    });

    it('refuses a missing or oversized article, and a bad parent, before touching Odoo', async () => {
        await connect();
        odoo.state.requests = [];
        expect((await send({ knowledge: {} })).body).toEqual({ error: 'invalid', message: 'The article is missing.' });
        expect((await send({ knowledge: { html: 42 } })).status).toBe(400);
        expect((await send({ knowledge: { html: HTML, parentId: -1 } })).status).toBe(400);
        expect((await send({ knowledge: { html: HTML, parentId: 'x' } })).status).toBe(400);
        const big = await send({ knowledge: { html: 'a'.repeat(2 * 1024 * 1024 + 1) } });
        expect(big.status).toBe(413);
        expect(odoo.state.requests).toHaveLength(0);
        expect(created()).toHaveLength(0);
    });

    it('reports a missing Knowledge app without calling Odoo, and a gone parent', async () => {
        odoo.state.apps = ['documents', 'crm', 'sales'];
        await connect();
        odoo.state.requests = [];
        const response = await send({ knowledge: { parentId: 11, html: HTML } });
        expect(response.body.knowledge).toMatchObject({ ok: false, error: 'missing_app' });
        expect(odoo.state.requests).toHaveLength(0);

        resetFakeOdoo(odoo.state);
        await connect();
        const gone = await send({ knowledge: { parentId: 999, html: HTML } });
        expect(gone.body.knowledge).toMatchObject({ ok: false, error: 'record_gone' });
        expect(link()).toBeUndefined();
    });

    it('sends a PDF to Documents and an article to Knowledge in one go', async () => {
        await connect();
        const response = await send({
            pdfRequest: { htmlContent: '<h1>Quote</h1>', cssStyles: '', printStyles: {} },
            documents: { folderId: 41 },
            knowledge: { parentId: 10, html: HTML },
        });
        expect(response.body.documents).toMatchObject({ ok: true, created: true });
        expect(response.body.knowledge).toMatchObject({ ok: true, created: true });
        expect(odoo.state.docs.size).toBe(1);
        expect(created()).toHaveLength(1);
        expect(defaults()).toMatchObject({ folder_id: 41, parent_article_id: 10 });

        const links = await request(app).get('/addons/odoo/links').query({ dbKey, noteId }).set('Authorization', `Bearer ${token}`);
        expect(links.body.links.map((l) => l.destination).sort()).toEqual(['documents', 'knowledge']);
        expect(links.body.defaults).toEqual({ folderId: 41, parentArticleId: 10 });
        expect(links.body.links.find((l) => l.destination === 'knowledge').url).toMatch(/\/knowledge\/article\/\d+$/);
    });

    it('still needs the PDF when Documents or the chatter is chosen', async () => {
        await connect();
        const response = await send({ documents: { folderId: 41 }, knowledge: { html: HTML } });
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('The PDF is missing.');
    });

    it('lists articles for the parent picker', async () => {
        await connect();
        const response = await request(app).get('/addons/odoo/articles?q=sales').set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(response.body.articles).toEqual([{ id: 11, name: 'Sales playbook', parentName: 'Company handbook' }]);
        const [search] = calls('/knowledge.article/search_read');
        expect(search.params.domain).toEqual([['is_template', '=', false], ['name', 'ilike', 'sales']]);
        const all = await request(app).get('/addons/odoo/articles').set('Authorization', `Bearer ${token}`);
        expect(all.body.articles).toHaveLength(2);
    });
});
