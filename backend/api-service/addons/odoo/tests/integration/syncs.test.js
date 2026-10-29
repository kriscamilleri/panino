import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../../../../tests/testHelpers.js';
import { getUserDb } from '../../../../db.js';
import { resetOdooRateLimits } from '../../routes.js';
import { resetFileFieldCache } from '../../client.js';
import { createSync, deleteSync, listSyncs, readSync, setSyncStatus } from '../../sync.js';
import { __configureSyncSchedulerForTests, runSyncNow, scheduleSyncRunsAfterChanges, triggerDailyReconcile } from '../../syncScheduler.js';
import { API_KEY, resetFakeOdoo, startFakeOdoo } from '../fakeOdoo.js';
import { resolveDatabaseUploadRoot } from '../../../../spaceStorage.js';

describe('Keeping a folder or a Document in sync with Odoo Knowledge', () => {
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
        user = await setupTestUser(`odoo-sync-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@example.test`, 'password123');
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
    const articles = () => [...odoo.state.articles.values()].filter((a) => a.id >= 100);
    const byName = (name) => articles().find((a) => a.name === name);
    const linkOf = (sourceId) => db.prepare("SELECT * FROM odoo_links WHERE destination = 'knowledge' AND source_id = ?").get(sourceId);
    const calls = (suffix) => odoo.state.requests.filter((r) => r.url.endsWith(suffix));
    const run = (syncId, options) => runSyncNow(dbKey, syncId, options).then((r) => r.result);

    /** A folder "Docs" holding A, B and a subfolder "Sub" with C. */
    function seedTree() {
        const docs = folder('Docs');
        const sub = folder('Sub', docs);
        const a = note('Alpha', '# Alpha\n\nFirst', docs);
        const b = note('Beta', 'Second', docs);
        const c = note('Gamma', '- [ ] todo', sub);
        return { docs, sub, a, b, c };
    }
    function folderSync(docs, parentArticleId = 10) {
        return createSync(db, { scope: 'folder', sourceId: docs, odooTarget: target(), parentArticleId, runAs: user.userId, createdBy: user.userId });
    }

    it('creates the tree level by level, in title order, read-only for others', async () => {
        await connect();
        const { docs, sub, a, b, c } = seedTree();
        const sync = folderSync(docs);
        const result = await run(sync.id, { trigger: 'created' });
        expect(result).toMatchObject({ created: 4, updated: 0, unchanged: 0, archived: 0, failures: [] });

        // Two levels, one create call each.
        const creates = calls('/knowledge.article/create');
        expect(creates).toHaveLength(2);
        expect(creates[0].params.vals_list.map((v) => [v.name, v.sequence, v.parent_id])).toEqual([['Alpha', 0, 10], ['Beta', 1, 10], ['Sub', 2, 10]]);
        expect(creates[0].params.vals_list[0]).toMatchObject({ internal_permission: 'read', article_member_ids: [[0, 0, { partner_id: 3, permission: 'write' }]] });
        expect(creates[1].params.vals_list.map((v) => [v.name, v.sequence])).toEqual([['Gamma', 0]]);
        expect(creates[1].params.vals_list[0].parent_id).toBe(byName('Sub').id);
        expect(creates[1].params.vals_list[0].internal_permission).toBeUndefined();

        expect(byName('Alpha').body).toBe('<p>First</p>');
        expect(byName('Sub').body).toBe('');
        expect(byName('Gamma').body).toBe('<ul class="o_checklist"><li>todo</li></ul>');
        for (const id of [a, b, c, sub]) {
            expect(linkOf(id)).toMatchObject({ sync_id: sync.id, archived_at: null });
            expect(linkOf(id).content_hash).toMatch(/^[0-9a-f]{64}$/);
        }
        expect(linkOf(sub).source_type).toBe('folder');
        expect(readSync(db, sync.id).last_run_at).toBeTruthy();
        expect(JSON.parse(readSync(db, sync.id).last_result).created).toBe(4);
    });

    it('links every article a batch created even when the run stops on the first, so none is created twice', async () => {
        await connect();
        const docs = folder('Docs');
        const ids = ['One', 'Two', 'Three'].map((title) => note(title, title, docs));
        const sync = folderSync(docs);
        odoo.state.rejectKeyAfterArticleCreate = true;

        const first = await run(sync.id);
        expect(first.paused).toBe('key_rejected');
        expect(articles().map((a) => a.name).sort()).toEqual(['One', 'Three', 'Two']);
        for (const id of ids) expect(linkOf(id)).toMatchObject({ sync_id: sync.id });

        odoo.state.rejectKeyAfterArticleCreate = false;
        odoo.state.keyValid = true;
        setSyncStatus(db, sync.id, { status: 'active' });
        const second = await run(sync.id);
        expect(second).toMatchObject({ created: 0, failures: [] });
        expect(articles().map((a) => a.name).sort()).toEqual(['One', 'Three', 'Two']);
        for (const id of ids) expect(linkOf(id).content_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('runs once more when an edit arrives during a run, so the edit is not left for tomorrow', async () => {
        await connect();
        const docs = folder('Docs');
        const alpha = note('Alpha', 'First', docs);
        const sync = folderSync(docs);
        odoo.state.articleCreateDelayMs = 300;

        const running = runSyncNow(dbKey, sync.id, { trigger: 'created' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        db.prepare('UPDATE notes SET content = ? WHERE id = ?').run('Edited during the run', alpha);
        expect(await runSyncNow(dbKey, sync.id, { trigger: 'changes' })).toEqual({ started: false, reason: 'already-running' });
        await running;
        odoo.state.articleCreateDelayMs = 0;

        await vi.waitFor(() => expect(byName('Alpha').body).toBe('<p>Edited during the run</p>'));
        expect(articles().filter((a) => a.name === 'Alpha')).toHaveLength(1);
    });

    it('stops a run whose sync was removed, and a new sync of the folder adopts its Documents', async () => {
        await connect();
        const { docs } = seedTree();
        const sync = folderSync(docs);
        odoo.state.articleCreateDelayMs = 300;

        const running = run(sync.id, { trigger: 'created' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        deleteSync(db, sync.id);
        const result = await running;
        odoo.state.articleCreateDelayMs = 0;

        // The first level was already in flight; the second never started.
        expect(result.interrupted).toBe(true);
        expect(byName('Gamma')).toBeUndefined();

        const again = folderSync(docs);
        await run(again.id);
        expect(articles().filter((a) => a.name === 'Alpha')).toHaveLength(1);
        expect(articles().filter((a) => a.name === 'Beta')).toHaveLength(1);
        expect(byName('Gamma')).toBeTruthy();
    });

    it('never rejects, so a timer that does not wait for a run cannot crash the server', async () => {
        await expect(runSyncNow('user:not-a-database', 'no-sync', { trigger: 'changes' })).resolves.toEqual({ started: true, reason: 'failed' });
    });

    it('writes only what changed: an edit, a rename, a move, and nothing when nothing did', async () => {
        await connect();
        const { docs, sub, a, b } = seedTree();
        const sync = folderSync(docs);
        await run(sync.id);
        odoo.state.requests = [];

        expect(await run(sync.id)).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
        expect(calls('/knowledge.article/write')).toHaveLength(0);
        expect(calls('/knowledge.article/create')).toHaveLength(0);

        db.prepare('UPDATE notes SET content = ? WHERE id = ?').run('Changed', a);
        db.prepare('UPDATE notes SET title = ? WHERE id = ?').run('Beta renamed', b);
        const result = await run(sync.id);
        expect(result).toMatchObject({ updated: 2, unchanged: 2 });
        expect(byName('Alpha').body).toBe('<p>Changed</p>');
        expect(byName('Beta renamed')).toBeTruthy();
        expect(calls('/knowledge.article/write')).toHaveLength(2);

        db.prepare('UPDATE notes SET folder_id = ? WHERE id = ?').run(sub, b);
        odoo.state.requests = [];
        // Beta moved; Sub and Gamma changed place among their siblings; Alpha stayed put.
        expect(await run(sync.id)).toMatchObject({ updated: 3, unchanged: 1 });
        expect(byName('Beta renamed').parent_id).toEqual([byName('Sub').id, 'Sub']);
    });

    it('archives what is deleted or moved out, restores what comes back, and never deletes in Odoo', async () => {
        await connect();
        const { docs, c, a } = seedTree();
        const elsewhere = folder('Elsewhere');
        const sync = folderSync(docs);
        await run(sync.id);
        const gamma = byName('Gamma');

        const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(c);
        db.prepare('DELETE FROM notes WHERE id = ?').run(c);
        db.prepare('UPDATE notes SET folder_id = ? WHERE id = ?').run(elsewhere, a);
        const result = await run(sync.id);
        expect(result).toMatchObject({ archived: 2, failures: [] });
        expect(odoo.state.articles.get(gamma.id).active).toBe(false);
        expect(byName('Alpha').active).toBe(false);
        expect(linkOf(c).archived_at).toBeTruthy();
        expect(odoo.state.articles.size).toBeGreaterThan(0);
        expect(calls('/knowledge.article/unlink')).toHaveLength(0);

        db.prepare('INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(row.id, row.user_id, row.folder_id, row.title, 'Back again', row.created_at, now());
        const back = await run(sync.id);
        expect(back).toMatchObject({ restored: 1, updated: 1 });
        expect(odoo.state.articles.get(gamma.id)).toMatchObject({ active: true, body: '<p>Back again</p>' });
        expect(linkOf(c).archived_at).toBeNull();
    });

    it('recreates an article deleted in Odoo and keeps going past one refused record', async () => {
        await connect();
        const { docs, a } = seedTree();
        const sync = folderSync(docs);
        await run(sync.id);
        const alpha = byName('Alpha');
        odoo.state.articles.delete(alpha.id);
        db.prepare('UPDATE notes SET content = ? WHERE id = ?').run('Edited meanwhile', a);
        expect(await run(sync.id)).toMatchObject({ created: 1, unchanged: 3 });
        expect(byName('Alpha').id).not.toBe(alpha.id);
        expect(linkOf(a).odoo_record_id).toBe(byName('Alpha').id);

        // A new level where one record is refused: the batch falls back to one by one.
        note('Delta', 'ok', docs);
        note('Refused', 'no', docs);
        odoo.state.failArticleNames.add('Refused');
        const partial = await run(sync.id);
        expect(partial.created).toBe(1);
        expect(partial.failures).toEqual([{ sourceId: expect.any(String), name: 'Refused', error: 'odoo_error' }]);
        expect(byName('Delta')).toBeTruthy();
        expect(JSON.parse(readSync(db, sync.id).last_result).failures).toHaveLength(1);

        odoo.state.failArticleNames.clear();
        expect(await run(sync.id)).toMatchObject({ created: 1, failures: [] });
        expect(byName('Refused')).toBeTruthy();
    });

    it('runs once after a burst of changes', async () => {
        await connect();
        const { docs } = seedTree();
        const sync = folderSync(docs);
        scheduleSyncRunsAfterChanges(dbKey);
        await new Promise((resolve) => setTimeout(resolve, 60));
        scheduleSyncRunsAfterChanges(dbKey);
        await new Promise((resolve) => setTimeout(resolve, 60));
        scheduleSyncRunsAfterChanges(dbKey);
        expect(calls('/knowledge.article/create')).toHaveLength(0);
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(calls('/knowledge.article/create')).toHaveLength(2);
        expect(readSync(db, sync.id).last_run_at).toBeTruthy();
    });

    it('pauses on a rejected key and resumes when a new key is connected', async () => {
        await connect();
        const { docs } = seedTree();
        const sync = folderSync(docs);
        odoo.state.keyValid = false;
        const result = await run(sync.id);
        expect(result.paused).toBe('key_rejected');
        expect(readSync(db, sync.id)).toMatchObject({ status: 'paused', paused_reason: 'key_rejected' });
        expect((await request(app).get('/addons/odoo').set(auth())).body.lastError).toBe('key_rejected');
        expect((await request(app).post(`/addons/odoo/syncs/${sync.id}/run`).query({ dbKey }).set(auth())).status).toBe(409);

        odoo.state.keyValid = true;
        await connect();
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(readSync(db, sync.id).status).toBe('active');
        expect(articles().length).toBe(4);
    });

    it('pauses when the add-on is switched off and when Odoo is disconnected, and resumes', async () => {
        await connect();
        const { docs } = seedTree();
        const sync = folderSync(docs);
        await run(sync.id);
        await request(app).put('/addons/odoo/enabled').set(auth()).send({ enabled: false });
        expect(readSync(db, sync.id)).toMatchObject({ status: 'paused', paused_reason: 'addon_disabled' });
        await request(app).put('/addons/odoo/enabled').set(auth()).send({ enabled: true });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(readSync(db, sync.id).status).toBe('active');

        await request(app).delete('/addons/odoo').set(auth());
        expect(readSync(db, sync.id)).toMatchObject({ status: 'paused', paused_reason: 'not_connected' });
        await connect();
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(readSync(db, sync.id).status).toBe('active');
    });

    it('adopts an article sent by hand instead of making a second one', async () => {
        await connect();
        const { docs, a } = seedTree();
        const sent = await request(app).post('/addons/odoo/send').set(auth()).send({
            dbKey, noteId: a, title: 'Alpha', knowledge: { parentId: 11, html: '<h1>Alpha</h1><p>By hand</p>' },
        });
        expect(sent.body.knowledge.ok).toBe(true);
        const handMade = byName('Alpha');
        expect(handMade.parent_id).toEqual([11, 'Sales playbook']);

        const sync = folderSync(docs);
        expect(await run(sync.id)).toMatchObject({ created: 3, updated: 1 });
        expect(articles().filter((x) => x.name === 'Alpha')).toHaveLength(1);
        expect(odoo.state.articles.get(handMade.id)).toMatchObject({ parent_id: [10, 'Company handbook'], body: '<p>First</p>' });
        expect(linkOf(a)).toMatchObject({ odoo_record_id: handMade.id, sync_id: sync.id });

        // From now on a manual Knowledge send is refused for that Document.
        const again = await request(app).post('/addons/odoo/send').set(auth()).send({
            dbKey, noteId: a, title: 'Alpha', knowledge: { html: '<p>x</p>' },
        });
        expect(again.body.knowledge).toMatchObject({ ok: false, error: 'synced' });
        const info = await request(app).get('/addons/odoo/links').query({ dbKey, noteId: a }).set(auth());
        expect(info.body.sync).toMatchObject({ id: sync.id, scope: 'folder', sourceName: 'Docs' });
        expect(info.body.links[0].syncId).toBe(sync.id);
    });

    it('follows a synced Document, not its place', async () => {
        await connect();
        const { docs, a } = seedTree();
        const elsewhere = folder('Elsewhere');
        const sync = createSync(db, { scope: 'note', sourceId: a, odooTarget: target(), parentArticleId: null, runAs: user.userId, createdBy: user.userId });
        expect(await run(sync.id)).toMatchObject({ created: 1 });
        expect(byName('Alpha').parent_id).toBe(false);
        expect(calls('/knowledge.article/create')[0].params.vals_list[0].internal_permission).toBeUndefined();

        db.prepare('UPDATE notes SET folder_id = ? WHERE id = ?').run(elsewhere, a);
        odoo.state.requests = [];
        expect(await run(sync.id)).toMatchObject({ unchanged: 1 });
        expect(calls('/knowledge.article/write')).toHaveLength(0);

        db.prepare('DELETE FROM notes WHERE id = ?').run(a);
        expect(await run(sync.id)).toMatchObject({ archived: 1 });
        expect(byName('Alpha').active).toBe(false);
        expect(docs).toBeTruthy();
    });

    it('reconciles daily: rewrites what drifted in Odoo and re-archives what was unarchived there', async () => {
        await connect();
        const { docs, c } = seedTree();
        const sync = folderSync(docs);
        await run(sync.id);
        db.prepare('DELETE FROM notes WHERE id = ?').run(c);
        await run(sync.id);
        const gamma = byName('Gamma');
        const alpha = byName('Alpha');
        // Drift in Odoo.
        alpha.name = 'Renamed in Odoo';
        gamma.active = true;
        odoo.state.requests = [];

        expect(await run(sync.id)).toMatchObject({ unchanged: 3, archived: 0 });
        expect(alpha.name).toBe('Renamed in Odoo');

        db.prepare('UPDATE odoo_syncs SET last_reconcile_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', sync.id);
        triggerDailyReconcile(dbKey);
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(alpha.name).toBe('Alpha');
        expect(gamma.active).toBe(false);
        expect(JSON.parse(readSync(db, sync.id).last_result)).toMatchObject({ updated: 1, unchanged: 2, archived: 1 });
        expect(readSync(db, sync.id).last_reconcile_at).not.toBe('2020-01-01T00:00:00.000Z');
    });

    it('uploads a synced Document’s images onto its article (Phase 11)', async () => {
        await connect();
        const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DwHwyBFJAFBAAyGwX/eOd2EQAAAABJRU5ErkJggg==', 'base64');
        const imageId = uuidv4();
        const root = resolveDatabaseUploadRoot(dbKey);
        fs.mkdirSync(root, { recursive: true });
        const file = path.join(root, `${imageId}.png`);
        fs.writeFileSync(file, PNG);
        db.prepare('INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(imageId, user.userId, 'plan.png', 'image/png', `${imageId}.png`, PNG.length, crypto.createHash('sha256').update(PNG).digest('hex'), now());
        try {
            const docs = folder('Docs');
            const a = note('Plan', `# Plan\n\n![Floor](/images/${imageId})\n\n![Lost](/images/${uuidv4()})`, docs);
            const sync = folderSync(docs);
            expect(await run(sync.id)).toMatchObject({ created: 1, failures: [] });
            const article = byName('Plan');
            const [[attachmentId, meta]] = [...odoo.state.attachmentMeta.entries()].filter(([, m]) => m.res_model === 'knowledge.article' && m.res_id === article.id);
            expect(meta.name).toBe(`${imageId}.png`);
            expect(article.body).toBe(`<p><img src="/web/image/${attachmentId}" alt="Floor"></p>\n<p><span class="o_panino_image_placeholder">Image not sent: Lost</span></p>`);
            // The create carried placeholders; the image body came with the second write.
            expect(calls('/knowledge.article/create')[0].params.vals_list[0].body).not.toContain('/images/');
            expect(linkOf(a).content_hash).toBeTruthy();

            odoo.state.requests = [];
            expect(await run(sync.id)).toMatchObject({ unchanged: 1 });
            expect(calls('/ir.attachment/create')).toHaveLength(0);
        } finally {
            fs.rmSync(file, { force: true });
        }
    });

    it('repairs a body edited or emptied in Odoo on the daily reconcile, and leaves an equivalent one alone', async () => {
        await connect();
        const { docs } = seedTree();
        const sync = folderSync(docs);
        await run(sync.id);
        const alpha = byName('Alpha');
        const beta = byName('Beta');
        const gamma = byName('Gamma');
        alpha.body = '<p>Edited in Odoo</p>';
        beta.body = false;
        // Odoo's own formatting of the same checklist is not drift.
        gamma.body = '<ul class="o_checklist" data-oe-protected="false">\n  <li>todo</li>\n</ul>';
        odoo.state.requests = [];

        // An ordinary run trusts the hash and writes nothing.
        expect(await run(sync.id)).toMatchObject({ updated: 0, unchanged: 4 });
        expect(calls('/knowledge.article/write')).toHaveLength(0);
        expect(alpha.body).toBe('<p>Edited in Odoo</p>');

        expect(await run(sync.id, { reconcile: true })).toMatchObject({ updated: 2, unchanged: 2, failures: [] });
        expect(alpha.body).toBe('<p>First</p>');
        expect(beta.body).toBe('<p>Second</p>');
        expect(gamma.body).toContain('data-oe-protected');
        expect(calls('/knowledge.article/write').map((r) => r.params.ids[0]).sort()).toEqual([alpha.id, beta.id].sort());
    });

    it('keeps an article pending while its images are not up, and finishes it on the next run', async () => {
        await connect();
        const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DwHwyBFJAFBAAyGwX/eOd2EQAAAABJRU5ErkJggg==', 'base64');
        const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
        const root = resolveDatabaseUploadRoot(dbKey);
        fs.mkdirSync(root, { recursive: true });
        const files = [];
        const seedImage = (name, bytes, ext) => {
            const id = uuidv4();
            const file = path.join(root, `${id}.${ext}`);
            fs.writeFileSync(file, bytes);
            files.push(file);
            db.prepare('INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .run(id, user.userId, name, `image/${ext}`, `${id}.${ext}`, bytes.length, crypto.createHash('sha256').update(bytes).digest('hex'), now());
            return id;
        };
        const imageId = seedImage('plan.png', PNG, 'png');
        const secondId = seedImage('dot.gif', GIF, 'gif');
        try {
            const a = note('Plan', `![Floor](/images/${imageId})`);
            const sync = createSync(db, { scope: 'note', sourceId: a, odooTarget: target(), runAs: user.userId, createdBy: user.userId });

            // The article is created but the write that brings the image fails.
            odoo.state.failArticleWritesOnce = true;
            expect(await run(sync.id)).toMatchObject({ created: 0, failures: [{ sourceId: a, name: 'Plan', error: 'odoo_error' }] });
            const article = byName('Plan');
            expect(article.body).toContain('Image not sent');
            expect(linkOf(a)).toMatchObject({ odoo_record_id: article.id, sync_id: sync.id, content_hash: null });

            // The next run finishes the same article rather than skipping it or making another.
            expect(await run(sync.id)).toMatchObject({ updated: 1, failures: [] });
            expect(articles()).toHaveLength(1);
            expect(article.body).toMatch(/<img src="\/web\/image\/\d+" alt="Floor">/);
            expect(linkOf(a).content_hash).toMatch(/^[0-9a-f]{64}$/);
            odoo.state.requests = [];
            expect(await run(sync.id)).toMatchObject({ unchanged: 1 });
            expect(calls('/knowledge.article/write')).toHaveLength(0);

            // A new image whose upload Odoo refuses is reported and retried; the first image
            // is reused, and the article stays pending until the second is up.
            db.prepare('UPDATE notes SET content = ? WHERE id = ?').run(`![Floor](/images/${imageId})\n\n![Dot](/images/${secondId})`, a);
            odoo.state.failAttachmentCreates = true;
            expect(await run(sync.id)).toMatchObject({ updated: 1, failures: [{ sourceId: a, name: 'Plan', error: 'images_failed', images: 1 }] });
            expect(article.body).toMatch(/<img src="\/web\/image\/\d+" alt="Floor">/);
            expect(article.body).toContain('Image not sent: Dot');
            expect(linkOf(a).content_hash).toBeNull();
            odoo.state.failAttachmentCreates = false;
            expect(await run(sync.id)).toMatchObject({ updated: 1, failures: [] });
            expect(article.body).toMatch(/<p><img src="\/web\/image\/\d+" alt="Floor"><\/p>\n<p><img src="\/web\/image\/\d+" alt="Dot"><\/p>/);
            expect(linkOf(a).content_hash).toMatch(/^[0-9a-f]{64}$/);
            expect(await run(sync.id)).toMatchObject({ unchanged: 1, failures: [] });
        } finally {
            for (const file of files) fs.rmSync(file, { force: true });
        }
    });

    describe('routes', () => {
        it('creates, lists, runs and removes a folder sync', async () => {
            await connect();
            const { docs, a } = seedTree();
            const created = await request(app).post('/addons/odoo/syncs').set(auth()).send({ dbKey, scope: 'folder', sourceId: docs, parentArticleId: 10 });
            expect(created.status).toBe(201);
            expect(created.body.sync).toMatchObject({ scope: 'folder', sourceId: docs, sourceName: 'Docs', parentArticleId: 10, status: 'active', runAsName: 'Test User' });
            await new Promise((resolve) => setTimeout(resolve, 400));
            expect(articles()).toHaveLength(4);

            const listed = await request(app).get('/addons/odoo/syncs').query({ dbKey }).set(auth());
            expect(listed.body.syncs).toHaveLength(1);
            expect(listed.body.syncs[0].lastResult).toMatchObject({ created: 4 });
            expect(listed.body.syncs[0].odooHost).toBe(`http://127.0.0.1:${odoo.port}`);

            db.prepare('UPDATE notes SET content = ? WHERE id = ?').run('Now', a);
            const ran = await request(app).post(`/addons/odoo/syncs/${created.body.sync.id}/run`).query({ dbKey }).set(auth());
            // Answered before the run ends; the card polls GET /syncs for the outcome.
            expect(ran.status).toBe(202);
            expect(ran.body).toMatchObject({ started: true, queued: false });
            await vi.waitFor(async () => {
                const listed = await request(app).get('/addons/odoo/syncs').query({ dbKey }).set(auth());
                const sync = listed.body.syncs.find((s) => s.id === created.body.sync.id);
                expect(sync.running).toBe(false);
                expect(sync.lastResult).toMatchObject({ updated: 1 });
            });

            const removed = await request(app).delete(`/addons/odoo/syncs/${created.body.sync.id}`).query({ dbKey }).set(auth());
            expect(removed.status).toBe(204);
            expect(listSyncs(db)).toHaveLength(0);
            expect(linkOf(a).sync_id).toBeNull();
            expect(byName('Alpha').active).toBe(true);
        });

        it('refuses overlaps, unknown sources, a gone parent, other people, and a missing Knowledge app', async () => {
            await connect();
            const { docs, sub, a } = seedTree();
            const other = folder('Other');
            const post = (body, t = token) => request(app).post('/addons/odoo/syncs').set({ Authorization: `Bearer ${t}` }).send({ dbKey, ...body });
            expect((await post({ scope: 'folder', sourceId: docs, parentArticleId: 999 })).body).toMatchObject({ error: 'record_gone' });
            expect((await post({ scope: 'folder', sourceId: uuidv4() })).status).toBe(404);
            expect((await post({ scope: 'space' })).status).toBe(400);
            expect((await post({ scope: 'folder', sourceId: docs, parentArticleId: 'x' })).status).toBe(400);

            expect((await post({ scope: 'folder', sourceId: docs })).status).toBe(201);
            expect((await post({ scope: 'folder', sourceId: sub })).status).toBe(409);
            expect((await post({ scope: 'note', sourceId: a })).status).toBe(409);
            expect((await post({ scope: 'folder', sourceId: docs })).status).toBe(409);
            expect((await post({ scope: 'folder', sourceId: other })).status).toBe(201);

            const stranger = await setupTestUser(`odoo-sync-stranger-${Date.now()}@example.test`, 'password123');
            const strangerToken = getTestToken(stranger.userId);
            await request(app).put('/addons/odoo/enabled').set({ Authorization: `Bearer ${strangerToken}` }).send({ enabled: true });
            expect((await post({ scope: 'folder', sourceId: docs }, strangerToken)).status).toBe(404);
            expect((await request(app).get('/addons/odoo/syncs').query({ dbKey }).set({ Authorization: `Bearer ${strangerToken}` })).status).toBe(404);
            cleanupTestUser(stranger.userId);

            await request(app).delete('/addons/odoo').set(auth());
            odoo.state.apps = ['documents', 'crm', 'sales'];
            await connect();
            expect((await post({ scope: 'folder', sourceId: folder('Fresh') })).body).toMatchObject({ error: 'missing_app' });
        });
    });
});
