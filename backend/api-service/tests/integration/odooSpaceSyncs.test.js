import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../testHelpers.js';
import { deleteTestDb, getDb, getSpacesDb } from '../../db.js';
import { resetOdooRateLimits } from '../../odoo.js';
import { resetFileFieldCache } from '../../odooClient.js';
import { readSync } from '../../odooSync.js';
import { __configureSyncSchedulerForTests, runSyncNow } from '../../odooSyncScheduler.js';
import { addEditorMember, createSpace, removeEditorMember } from '../../spaces.js';
import { API_KEY, OTHER_API_KEY, resetFakeOdoo, startFakeOdoo } from '../fakeOdoo.js';

describe('Keeping a shared space in sync with Odoo Knowledge', () => {
    let app;
    let odoo;
    let owner;
    let editor;
    let spaceId;
    let dbKey;
    let db;
    const saved = {};
    const now = () => new Date().toISOString();

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
        __configureSyncSchedulerForTests({ debounce: 3 * 60 * 1000, settle: 2000 });
        await new Promise((resolve) => odoo.server.close(resolve));
    });

    beforeEach(async () => {
        process.env.ODOO_INTEGRATION_ENABLED = 'true';
        process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY = 'test-odoo-credential-key-0123456789abcdef';
        process.env.ODOO_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
        process.env.SHARED_SPACES_ENABLED = 'true';
        resetFakeOdoo(odoo.state);
        resetOdooRateLimits();
        resetFileFieldCache();
        __configureSyncSchedulerForTests({ debounce: 150, settle: 0 });
        const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
        owner = await setupTestUser(`odoo-space-owner-${stamp}@example.test`, 'password123');
        editor = await setupTestUser(`odoo-space-editor-${stamp}@example.test`, 'password123');
        ({ spaceId } = createSpace({ actorUserId: owner.userId, name: `Odoo space ${stamp}` }));
        addEditorMember({ actorUserId: owner.userId, spaceId, userId: editor.userId });
        dbKey = `space:${spaceId}`;
        db = getDb(dbKey);
    });

    afterEach(() => {
        __configureSyncSchedulerForTests({});
        const spacesDb = getSpacesDb();
        spacesDb.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
        spacesDb.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
        deleteTestDb(dbKey);
        cleanupTestUser(owner.userId);
        cleanupTestUser(editor.userId);
    });

    const auth = (user) => ({ Authorization: `Bearer ${getTestToken(user.userId)}` });
    const enable = (user) => request(app).put('/addons/odoo/enabled').set(auth(user)).send({ enabled: true });
    async function connect(user, apiKey = API_KEY) {
        await request(app).put('/addons/odoo/enabled').set(auth(user)).send({ enabled: true });
        const response = await request(app).put('/addons/odoo').set(auth(user)).send({
            baseUrl: `http://127.0.0.1:${odoo.port}`, databaseName: 'panino_ee', apiKey,
        });
        expect(response.status).toBe(200);
    }
    function folder(name, parentId = null) {
        const id = uuidv4();
        db.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)').run(id, name, parentId, now());
        return id;
    }
    function note(title, content, folderId = null) {
        const id = uuidv4();
        db.prepare('INSERT INTO notes (id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, folderId, title, content, now(), now());
        return id;
    }
    const articles = () => [...odoo.state.articles.values()].filter((a) => a.id >= 100);
    const byName = (name) => articles().find((a) => a.name === name);
    const post = (user, body) => request(app).post('/addons/odoo/syncs').set(auth(user)).send({ dbKey, ...body });

    it('syncs a whole space, set up by an editor, with the top level as roots', async () => {
        await connect(editor);
        const docs = folder('Docs');
        note('Charter', '# Charter\n\nWhy we exist');
        note('Minutes', 'Notes', docs);
        const created = await post(editor, { scope: 'space', parentArticleId: 10 });
        expect(created.status).toBe(201);
        expect(created.body.sync).toMatchObject({ scope: 'space', sourceId: null, sourceName: null, runAs: editor.userId, status: 'active' });
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(articles().map((a) => a.name).sort()).toEqual(['Charter', 'Docs', 'Minutes']);
        expect(byName('Charter').parent_id).toEqual([10, 'Company handbook']);
        expect(byName('Charter').internal_permission).toBe('read');
        expect(byName('Minutes').parent_id).toEqual([byName('Docs').id, 'Docs']);
        expect(db.prepare("SELECT COUNT(*) AS n FROM odoo_links WHERE sync_id = ?").get(created.body.sync.id).n).toBe(3);

        // Every member with the add-on on sees it; a second space sync is refused.
        await enable(owner);
        const listed = await request(app).get('/addons/odoo/syncs').query({ dbKey }).set(auth(owner));
        expect(listed.body.syncs).toHaveLength(1);
        expect(listed.body.syncs[0].runAsName).toBe('Test User');
        expect((await post(owner, { scope: 'folder', sourceId: docs })).status).toBe(409);
        expect((await post(owner, { scope: 'space' })).status).toBe(409);
        expect((await request(app).post('/addons/odoo/syncs').set(auth(owner)).send({ dbKey: `user:${owner.userId}`, scope: 'space' })).status).toBe(400);
    });

    it('pauses when the runner leaves the space, and an owner can take it over', async () => {
        await connect(editor);
        await connect(owner, OTHER_API_KEY);
        note('Charter', 'Why');
        const created = await post(editor, { scope: 'space' });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const syncId = created.body.sync.id;
        expect(articles()).toHaveLength(1);

        removeEditorMember({ actorUserId: owner.userId, spaceId, userId: editor.userId });
        const result = await runSyncNow(dbKey, syncId, { trigger: 'manual' });
        expect(result.result).toBeNull();
        expect(readSync(db, syncId)).toMatchObject({ status: 'paused', paused_reason: 'left_space' });

        // Not a member any more: no say over the sync at all.
        expect((await request(app).post(`/addons/odoo/syncs/${syncId}/run`).query({ dbKey }).set(auth(editor))).status).toBe(404);

        note('Roadmap', 'Soon');
        const taken = await request(app).post(`/addons/odoo/syncs/${syncId}/take-over`).query({ dbKey }).set(auth(owner));
        expect(taken.status).toBe(200);
        expect(taken.body.sync).toMatchObject({ status: 'active', runAs: owner.userId, pausedReason: null });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(articles().map((a) => a.name).sort()).toEqual(['Charter', 'Roadmap']);
        // The take-over checked write access with the owner's own key.
        const check = odoo.state.requests.find((r) => r.url.endsWith('/knowledge.article/has_access'));
        expect(check.params).toEqual({ ids: [byName('Charter').id], operation: 'write' });
    });

    it('refuses a take-over whose Odoo user cannot write the articles, or is on another Odoo', async () => {
        await connect(editor);
        await connect(owner, OTHER_API_KEY);
        note('Charter', 'Why');
        const created = await post(editor, { scope: 'space' });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const syncId = created.body.sync.id;

        odoo.state.writeDeniedKeys.add(OTHER_API_KEY);
        const denied = await request(app).post(`/addons/odoo/syncs/${syncId}/take-over`).query({ dbKey }).set(auth(owner));
        expect(denied.status).toBe(403);
        expect(denied.body).toMatchObject({ error: 'access_denied' });
        expect(readSync(db, syncId).run_as).toBe(editor.userId);

        await request(app).put('/addons/odoo').set(auth(owner)).send({ baseUrl: `http://127.0.0.1:${odoo.port}`, databaseName: 'other_db', apiKey: OTHER_API_KEY });
        const elsewhere = await request(app).post(`/addons/odoo/syncs/${syncId}/take-over`).query({ dbKey }).set(auth(owner));
        expect(elsewhere.status).toBe(409);
        expect(elsewhere.body.error).toBe('different_odoo');
    });

    it('pauses space syncs too when the runner switches the add-on off or disconnects', async () => {
        await connect(editor);
        note('Charter', 'Why');
        const created = await post(editor, { scope: 'space' });
        await new Promise((resolve) => setTimeout(resolve, 400));
        const syncId = created.body.sync.id;

        await request(app).put('/addons/odoo/enabled').set(auth(editor)).send({ enabled: false });
        expect(readSync(db, syncId)).toMatchObject({ status: 'paused', paused_reason: 'addon_disabled' });
        await request(app).put('/addons/odoo/enabled').set(auth(editor)).send({ enabled: true });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(readSync(db, syncId).status).toBe('active');

        await request(app).delete('/addons/odoo').set(auth(editor));
        expect(readSync(db, syncId)).toMatchObject({ status: 'paused', paused_reason: 'not_connected' });
    });

    it('lets a member send a synced space Document elsewhere but not to Knowledge by hand', async () => {
        await connect(editor);
        await connect(owner, OTHER_API_KEY);
        const charter = note('Charter', 'Why');
        await post(editor, { scope: 'space' });
        await new Promise((resolve) => setTimeout(resolve, 400));

        const sent = await request(app).post('/addons/odoo/send').set(auth(owner)).send({
            dbKey, noteId: charter, title: 'Charter', knowledge: { html: '<p>x</p>' },
        });
        expect(sent.body.knowledge).toMatchObject({ ok: false, error: 'synced' });
        const links = await request(app).get('/addons/odoo/links').query({ dbKey, noteId: charter }).set(auth(owner));
        expect(links.body.sync).toMatchObject({ scope: 'space', runAs: editor.userId });
    });
});
