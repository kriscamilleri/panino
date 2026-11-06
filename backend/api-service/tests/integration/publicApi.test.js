// API keys and the v1 API (docs/specs/active/llm-api.md).
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupTestUser, createTestApp, getTestToken, setupTestUser } from '../testHelpers.js';
import { deleteTestDb, getAuthDb, getDb, getSpacesDb, getUserDb } from '../../db.js';
import { addEditorMember, createSpace, removeEditorMember } from '../../spaces.js';
import { resetApiKeyState } from '../../apiKeys.js';
import { buildOpenApiDocument } from '../../publicApiSpec.js';

const FLAG = 'SHARED_SPACES_ENABLED';
const ORIGINAL_FLAG = process.env[FLAG];

describe('API keys and the v1 API', () => {
    let app;
    let server;
    let clients;
    let owner;
    let other;
    let jwt;
    let spaceId;

    const bearer = (key) => ({ Authorization: `Bearer ${key}` });

    async function createKey(body = {}, token = jwt) {
        const res = await request(app)
            .post('/api-keys')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Claude Code', scope: 'write', ...body });
        expect(res.status).toBe(201);
        return res.body;
    }

    function insertNote(db, { id, title, content = '', folderId = null, updatedAt = '2026-11-01T10:00:00.000Z' }) {
        db.prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, owner.userId, folderId, title, content, updatedAt, updatedAt);
    }

    function insertFolder(db, { id, name, parentId = null, createdAt = '2026-11-01T09:00:00.000Z' }) {
        db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(id, owner.userId, name, parentId, createdAt);
    }

    beforeAll(() => {
        ({ app, server, clients } = createTestApp());
    });

    beforeEach(async () => {
        process.env[FLAG] = 'true';
        resetApiKeyState();
        const stamp = `${Date.now()}-${Math.random()}`;
        owner = await setupTestUser(`api-owner-${stamp}@example.com`, 'password123');
        other = await setupTestUser(`api-other-${stamp}@example.com`, 'password123');
        jwt = getTestToken(owner.userId);
        spaceId = null;
    });

    afterEach(() => {
        clients.clear();
        const spacesDb = getSpacesDb();
        if (spaceId) {
            spacesDb.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
            spacesDb.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
            deleteTestDb(`space:${spaceId}`);
        }
        for (const user of [owner, other]) {
            spacesDb.prepare('DELETE FROM space_user_versions WHERE user_id = ?').run(user.userId);
            cleanupTestUser(user.userId);
        }
    });

    afterAll(() => {
        if (ORIGINAL_FLAG === undefined) delete process.env[FLAG];
        else process.env[FLAG] = ORIGINAL_FLAG;
        return new Promise((resolve) => server.close(resolve));
    });

    describe('key management', () => {
        it('creates a key, shows the secret once, stores only its hash', async () => {
            const { key, secret } = await createKey({ expiresInDays: 30 });
            expect(secret).toMatch(/^pnk_/);
            expect(key).toMatchObject({ name: 'Claude Code', scope: 'write', spaceAccess: 'all', lastUsedAt: null, expired: false });
            expect(key.prefix).toBe(secret.slice(0, 12));
            expect(key.expiresAt).toBeTruthy();

            const row = getAuthDb().prepare('SELECT * FROM api_keys WHERE id = ?').get(key.id);
            expect(row.token_hash).not.toContain(secret);
            expect(JSON.stringify(row)).not.toContain(secret);

            const list = await request(app).get('/api-keys').set('Authorization', `Bearer ${jwt}`);
            expect(list.status).toBe(200);
            expect(list.body.keys).toHaveLength(1);
            expect(JSON.stringify(list.body)).not.toContain(secret);
            expect(list.body.keys[0]).not.toHaveProperty('token_hash');
        });

        it('validates input', async () => {
            const res = await request(app).post('/api-keys').set('Authorization', `Bearer ${jwt}`).send({ name: '', scope: 'write' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVALID_INPUT');
        });

        it('caps active keys at 10', async () => {
            for (let i = 0; i < 10; i += 1) await createKey({ name: `k${i}` });
            const res = await request(app).post('/api-keys').set('Authorization', `Bearer ${jwt}`).send({ name: 'eleven' });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('API_KEY_LIMIT');
        });

        it('revokes immediately, and only the caller\'s own key', async () => {
            const { key, secret } = await createKey();
            expect((await request(app).get('/v1/me').set(bearer(secret))).status).toBe(200);

            const otherJwt = getTestToken(other.userId);
            const stranger = await request(app).delete(`/api-keys/${key.id}`).set('Authorization', `Bearer ${otherJwt}`);
            expect(stranger.status).toBe(404);

            const revoked = await request(app).delete(`/api-keys/${key.id}`).set('Authorization', `Bearer ${jwt}`);
            expect(revoked.status).toBe(200);
            const after = await request(app).get('/v1/me').set(bearer(secret));
            expect(after.status).toBe(401);
            expect(after.body.code).toBe('INVALID_API_KEY');
            const list = await request(app).get('/api-keys').set('Authorization', `Bearer ${jwt}`);
            expect(list.body.keys).toHaveLength(0);
        });

        it('refuses an expired key', async () => {
            const { key, secret } = await createKey();
            getAuthDb().prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', key.id);
            const res = await request(app).get('/v1/me').set(bearer(secret));
            expect(res.status).toBe(401);
            expect(res.body.code).toBe('INVALID_API_KEY');
        });

        it('records last use', async () => {
            const { key, secret } = await createKey();
            await request(app).get('/v1/me').set(bearer(secret));
            const row = getAuthDb().prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(key.id);
            expect(row.last_used_at).toBeTruthy();
        });
    });

    describe('keys are not sessions', () => {
        it.each([
            ['post', '/sync'],
            ['post', '/refresh'],
            ['get', '/me'],
            ['post', '/me/password'],
            ['get', '/api-keys'],
            ['post', '/api-keys'],
            ['get', '/spaces'],
            ['post', '/spaces'],
            ['get', '/addons'],
            ['get', '/images'],
            ['get', '/space-transfers'],
        ])('%s %s refuses an API key', async (method, path) => {
            const { secret } = await createKey();
            const res = await request(app)[method](path).set(bearer(secret)).send({});
            expect([401, 403]).toContain(res.status);
        });

        it('v1 refuses a session JWT and a missing key', async () => {
            const withJwt = await request(app).get('/v1/me').set('Authorization', `Bearer ${jwt}`);
            expect(withJwt.status).toBe(401);
            expect(withJwt.body.code).toBe('INVALID_API_KEY');
            const none = await request(app).get('/v1/me');
            expect(none.status).toBe(401);
            expect(none.body.code).toBe('API_KEY_REQUIRED');
        });

        it('v1 ignores a ?token= query key', async () => {
            const { secret } = await createKey();
            const res = await request(app).get(`/v1/me?token=${secret}`);
            expect(res.status).toBe(401);
        });
    });

    describe('discovery', () => {
        it('serves the OpenAPI document without a key', async () => {
            const res = await request(app).get('/v1/openapi.json');
            expect(res.status).toBe(200);
            expect(res.body.openapi).toBe('3.1.0');
            expect(Object.keys(res.body.paths)).toContain('/documents/{id}/append');
        });

        it('every OpenAPI path is answered by the router', async () => {
            const { secret } = await createKey();
            const doc = buildOpenApiDocument();
            for (const [path, ops] of Object.entries(doc.paths)) {
                for (const method of Object.keys(ops)) {
                    const concrete = path.replace('{id}', '00000000-0000-4000-8000-000000000000');
                    const res = await request(app)[method](`/v1${concrete}`).set(bearer(secret)).send({});
                    expect(res.body.code, `${method} ${path}`).not.toBe('NO_ROUTE');
                }
            }
        });

        it('describes the key and its databases', async () => {
            const created = createSpace({ actorUserId: owner.userId, name: 'Team' });
            spaceId = created.spaceId;
            const { secret } = await createKey({ scope: 'read' });
            const res = await request(app).get('/v1/me').set(bearer(secret));
            expect(res.status).toBe(200);
            expect(res.body.user.id).toBe(owner.userId);
            expect(res.body.key).toMatchObject({ name: 'Claude Code', scope: 'read', spaceAccess: 'all' });
            expect(res.body.databases).toEqual([
                { id: 'personal', kind: 'personal', name: 'Personal', role: 'owner' },
                { id: spaceId, kind: 'space', name: 'Team', role: 'owner' },
            ]);
            const index = await request(app).get('/v1').set(bearer(secret));
            expect(index.body.usage).toContain('Bearer');
        });
    });

    describe('reading', () => {
        let secret;
        beforeEach(async () => {
            const db = getUserDb(owner.userId);
            insertFolder(db, { id: 'f-clients', name: 'Clients' });
            insertFolder(db, { id: 'f-acme', name: 'Acme', parentId: 'f-clients' });
            insertNote(db, { id: 'n-invoice', title: 'Invoice process', content: 'How we bill.', folderId: 'f-acme', updatedAt: '2026-11-01T10:00:00.000Z' });
            insertNote(db, { id: 'n-meeting', title: 'Meeting', content: 'Discussed the INVOICE backlog 100% done_.', updatedAt: '2026-11-02T10:00:00.000Z' });
            insertNote(db, { id: 'n-other', title: 'Other', content: 'Nothing here', updatedAt: '2026-11-03T10:00:00.000Z' });
            ({ secret } = await createKey({ scope: 'read' }));
        });

        it('searches titles first, then bodies, with snippets and paths', async () => {
            const res = await request(app).get('/v1/search?q=invoice').set(bearer(secret));
            expect(res.status).toBe(200);
            expect(res.body.results.map((hit) => hit.id)).toEqual(['n-invoice', 'n-meeting']);
            expect(res.body.results[0]).toMatchObject({ folderPath: 'Clients/Acme', matchedTitle: true, space: null });
            expect(res.body.results[1].snippet).toContain('INVOICE');
        });

        it('treats % and _ literally', async () => {
            const res = await request(app).get('/v1/search?q=%25%20done_').set(bearer(secret));
            expect(res.body.results.map((hit) => hit.id)).toEqual(['n-meeting']);
            const none = await request(app).get('/v1/search?q=_x').set(bearer(secret));
            expect(none.body.results).toEqual([]);
        });

        it('refuses a too-short query', async () => {
            const res = await request(app).get('/v1/search?q=a').set(bearer(secret));
            expect(res.status).toBe(400);
        });

        it('lists newest first with a cursor', async () => {
            const first = await request(app).get('/v1/documents?limit=2').set(bearer(secret));
            expect(first.body.documents.map((doc) => doc.id)).toEqual(['n-other', 'n-meeting']);
            expect(first.body.nextCursor).toBeTruthy();
            const second = await request(app).get(`/v1/documents?limit=2&cursor=${first.body.nextCursor}`).set(bearer(secret));
            expect(second.body.documents.map((doc) => doc.id)).toEqual(['n-invoice']);
            expect(second.body.nextCursor).toBeNull();
            const inFolder = await request(app).get('/v1/documents?folderId=f-acme').set(bearer(secret));
            expect(inFolder.body.documents.map((doc) => doc.id)).toEqual(['n-invoice']);
            const atRoot = await request(app).get('/v1/documents?folderId=root').set(bearer(secret));
            expect(atRoot.body.documents.map((doc) => doc.id).sort()).toEqual(['n-meeting', 'n-other']);
        });

        it('returns the tree without bodies', async () => {
            const res = await request(app).get('/v1/tree').set(bearer(secret));
            expect(res.body.folders.map((folder) => folder.name)).toEqual(['Acme', 'Clients']);
            expect(res.body.documents).toHaveLength(3);
            expect(res.body.documents[0]).not.toHaveProperty('content');
            expect(res.body.truncated).toBe(false);
        });

        it('reads one Document as JSON or Markdown', async () => {
            const res = await request(app).get('/v1/documents/n-invoice').set(bearer(secret));
            expect(res.body.document).toMatchObject({ id: 'n-invoice', content: 'How we bill.', folderPath: 'Clients/Acme', pinned: false });
            const md = await request(app).get('/v1/documents/n-invoice?format=markdown').set(bearer(secret));
            expect(md.headers['content-type']).toContain('text/markdown');
            expect(md.text).toBe('How we bill.');
            expect(decodeURIComponent(md.headers['x-panino-title'])).toBe('Invoice process');
            const accepted = await request(app).get('/v1/documents/n-invoice').set(bearer(secret)).set('Accept', 'text/markdown');
            expect(accepted.text).toBe('How we bill.');
        });

        it('404s an unknown Document', async () => {
            const res = await request(app).get('/v1/documents/nope').set(bearer(secret));
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('NOT_FOUND');
        });

        it('a read key cannot write', async () => {
            const res = await request(app).post('/v1/documents').set(bearer(secret)).send({ title: 'x' });
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('INSUFFICIENT_SCOPE');
        });

        it('cannot see another user\'s Documents', async () => {
            const otherDb = getUserDb(other.userId);
            otherDb.prepare(`INSERT INTO notes (id, user_id, title, content, created_at, updated_at)
                             VALUES ('n-secret', ?, 'Secret invoice', 'x', '2026', '2026')`).run(other.userId);
            expect((await request(app).get('/v1/documents/n-secret').set(bearer(secret))).status).toBe(404);
            const search = await request(app).get('/v1/search?q=secret').set(bearer(secret));
            expect(search.body.results).toEqual([]);
        });
    });

    describe('writing', () => {
        let secret;
        beforeEach(async () => {
            ({ secret } = await createKey());
        });

        function revisions(db, noteId) {
            return db.prepare('SELECT actor_kind, actor_user_id FROM note_revisions WHERE note_id = ? ORDER BY created_at, rowid').all(noteId);
        }

        it('creates a Document that /sync hands to devices, and pokes them', async () => {
            const sent = [];
            clients.set({ readyState: 1, send: (msg) => sent.push(msg) }, { userId: owner.userId, siteId: 'b'.repeat(32) });

            const res = await request(app).post('/v1/documents').set(bearer(secret)).send({ title: 'From the agent', content: '# Hi' });
            expect(res.status).toBe(201);
            const id = res.body.document.id;
            expect(res.body.document).toMatchObject({ title: 'From the agent', content: '# Hi', folderId: null, space: null });
            expect(sent).toContain(JSON.stringify({ type: 'sync' }));

            const db = getUserDb(owner.userId);
            expect(db.prepare('SELECT user_id FROM notes WHERE id = ?').get(id).user_id).toBe(owner.userId);
            expect(revisions(db, id)).toEqual([{ actor_kind: 'api', actor_user_id: owner.userId }]);

            const pull = await request(app).post('/sync').set('Authorization', `Bearer ${jwt}`)
                .send({ since: 0, siteId: 'c'.repeat(32), changes: [] });
            expect(pull.status).toBe(200);
            const titles = pull.body.changes.filter((change) => change.table === 'notes' && change.cid === 'title');
            expect(titles.map((change) => change.val)).toContain('From the agent');
        });

        it('defaults the body to a heading and refuses a missing folder', async () => {
            const res = await request(app).post('/v1/documents').set(bearer(secret)).send({ title: 'Plain' });
            expect(res.body.document.content).toBe('# Plain\n\n');
            const bad = await request(app).post('/v1/documents').set(bearer(secret)).send({ title: 'X', folderId: 'missing' });
            expect(bad.status).toBe(400);
            expect(bad.body.code).toBe('FOLDER_NOT_FOUND');
        });

        it('updates with revisions before and after, honouring expectedUpdatedAt', async () => {
            const db = getUserDb(owner.userId);
            insertNote(db, { id: 'n-1', title: 'Doc', content: 'original' });

            const stale = await request(app).patch('/v1/documents/n-1').set(bearer(secret))
                .send({ content: 'new', expectedUpdatedAt: '2025-01-01T00:00:00.000Z' });
            expect(stale.status).toBe(409);
            expect(stale.body.code).toBe('VERSION_CONFLICT');
            expect(db.prepare('SELECT content FROM notes WHERE id = ?').get('n-1').content).toBe('original');

            const res = await request(app).patch('/v1/documents/n-1').set(bearer(secret))
                .send({ content: 'replaced', title: 'Doc 2', expectedUpdatedAt: '2026-11-01T10:00:00.000Z' });
            expect(res.status).toBe(200);
            expect(res.body.document).toMatchObject({ content: 'replaced', title: 'Doc 2' });
            expect(res.body.document.updatedAt).not.toBe('2026-11-01T10:00:00.000Z');
            expect(revisions(db, 'n-1')).toEqual([
                { actor_kind: null, actor_user_id: null },
                { actor_kind: 'api', actor_user_id: owner.userId },
            ]);
        });

        it('moves, pins, and refuses an empty update', async () => {
            const db = getUserDb(owner.userId);
            insertFolder(db, { id: 'f-1', name: 'Box' });
            insertNote(db, { id: 'n-1', title: 'Doc', content: 'x' });
            const moved = await request(app).patch('/v1/documents/n-1').set(bearer(secret)).send({ folderId: 'f-1', pinned: true });
            expect(moved.body.document).toMatchObject({ folderId: 'f-1', folderPath: 'Box', pinned: true });
            expect(revisions(db, 'n-1')).toEqual([]);
            const empty = await request(app).patch('/v1/documents/n-1').set(bearer(secret)).send({});
            expect(empty.body.code).toBe('NOTHING_TO_UPDATE');
        });

        it('appends with a blank line, or a given separator', async () => {
            const db = getUserDb(owner.userId);
            insertNote(db, { id: 'n-log', title: 'Log', content: '# Log\n\n- one\n' });
            insertNote(db, { id: 'n-empty', title: 'Empty', content: '' });
            const res = await request(app).post('/v1/documents/n-log/append').set(bearer(secret)).send({ content: '- two' });
            expect(res.body.document.content).toBe('# Log\n\n- one\n\n- two');
            const sep = await request(app).post('/v1/documents/n-log/append').set(bearer(secret)).send({ content: '- three', separator: '\n' });
            expect(sep.body.document.content).toBe('# Log\n\n- one\n\n- two\n- three');
            const empty = await request(app).post('/v1/documents/n-empty/append').set(bearer(secret)).send({ content: 'first' });
            expect(empty.body.document.content).toBe('first');
        });

        it('refuses a body over 2 MiB', async () => {
            const res = await request(app).post('/v1/documents').set(bearer(secret))
                .send({ title: 'Big', content: 'x'.repeat(2 * 1024 * 1024 + 1) });
            expect(res.status).toBe(413);
            expect(res.body.code).toBe('DOCUMENT_TOO_LARGE');
        });

        it('soft-deletes into a Trash folder it creates once, hidden from search', async () => {
            const db = getUserDb(owner.userId);
            insertFolder(db, { id: 'f-1', name: 'Work' });
            insertNote(db, { id: 'n-a', title: 'Alpha plan', content: 'x', folderId: 'f-1' });
            insertNote(db, { id: 'n-b', title: 'Beta plan', content: 'y' });

            const first = await request(app).delete('/v1/documents/n-a').set(bearer(secret));
            expect(first.status).toBe(200);
            expect(first.body).toMatchObject({ previousFolderId: 'f-1', alreadyInTrash: false });
            expect(first.body.document).toMatchObject({ folderPath: 'Trash', inTrash: true });
            await request(app).delete('/v1/documents/n-b').set(bearer(secret));
            const trashFolders = db.prepare("SELECT id FROM folders WHERE name = 'Trash'").all();
            expect(trashFolders).toHaveLength(1);
            expect(db.prepare('SELECT COUNT(*) AS c FROM notes').get().c).toBe(2);

            const again = await request(app).delete('/v1/documents/n-a').set(bearer(secret));
            expect(again.body.alreadyInTrash).toBe(true);

            const search = await request(app).get('/v1/search?q=plan').set(bearer(secret));
            expect(search.body.results).toEqual([]);
            const withTrash = await request(app).get('/v1/search?q=plan&includeTrash=true').set(bearer(secret));
            expect(withTrash.body.results).toHaveLength(2);
            const list = await request(app).get('/v1/documents').set(bearer(secret));
            expect(list.body.documents).toEqual([]);

            const restored = await request(app).patch('/v1/documents/n-a').set(bearer(secret)).send({ folderId: 'f-1' });
            expect(restored.body.document.folderPath).toBe('Work');
        });

        it('creates folders, nested', async () => {
            const parent = await request(app).post('/v1/folders').set(bearer(secret)).send({ name: 'Projects' });
            expect(parent.status).toBe(201);
            const child = await request(app).post('/v1/folders').set(bearer(secret)).send({ name: 'Panino', parentId: parent.body.folder.id });
            expect(child.body.folder.path).toBe('Projects/Panino');
            const bad = await request(app).post('/v1/folders').set(bearer(secret)).send({ name: 'X', parentId: 'nope' });
            expect(bad.body.code).toBe('PARENT_NOT_FOUND');
        });

        it('rate limits a looping agent', async () => {
            const { API_RATE_LIMIT_PER_MINUTE } = await import('../../apiKeys.js');
            for (let i = 0; i < API_RATE_LIMIT_PER_MINUTE; i += 1) {
                await request(app).get('/v1/me').set(bearer(secret));
            }
            const res = await request(app).get('/v1/me').set(bearer(secret));
            expect(res.status).toBe(429);
            expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
        });
    });

    describe('spaces', () => {
        let spaceDb;
        beforeEach(() => {
            const created = createSpace({ actorUserId: owner.userId, name: 'Team space' });
            spaceId = created.spaceId;
            spaceDb = getDb(`space:${spaceId}`);
            spaceDb.prepare(`INSERT INTO notes (id, title, content, created_at, updated_at)
                             VALUES ('s-note', 'Shared invoice', 'team text', '2026-11-04T10:00:00.000Z', '2026-11-04T10:00:00.000Z')`).run();
        });

        it('searches across personal and spaces, and finds a space Document by id alone', async () => {
            insertNote(getUserDb(owner.userId), { id: 'p-note', title: 'Personal invoice', content: 'mine' });
            const { secret } = await createKey();
            const search = await request(app).get('/v1/search?q=invoice').set(bearer(secret));
            expect(search.body.results.map((hit) => [hit.id, hit.space, hit.spaceName])).toEqual([
                ['s-note', spaceId, 'Team space'],
                ['p-note', null, 'Personal'],
            ]);
            const read = await request(app).get('/v1/documents/s-note').set(bearer(secret));
            expect(read.body.document).toMatchObject({ space: spaceId, content: 'team text' });
            const onlyPersonal = await request(app).get('/v1/search?q=invoice&space=personal').set(bearer(secret));
            expect(onlyPersonal.body.results.map((hit) => hit.id)).toEqual(['p-note']);
        });

        it('creates in a space with no user_id and pokes subscribers; edits get api revisions', async () => {
            const { secret } = await createKey();
            const created = await request(app).post(`/v1/documents?space=${spaceId}`).set(bearer(secret)).send({ title: 'Team doc' });
            expect(created.status).toBe(201);
            expect(created.body.document.space).toBe(spaceId);
            expect(spaceDb.prepare('SELECT user_id FROM notes WHERE id = ?').get(created.body.document.id).user_id).toBeNull();

            const edit = await request(app).patch('/v1/documents/s-note').set(bearer(secret)).send({ content: 'edited' });
            expect(edit.status).toBe(200);
            const kinds = spaceDb.prepare("SELECT actor_kind FROM note_revisions WHERE note_id = 's-note'").all().map((r) => r.actor_kind);
            expect(kinds).toContain('api');
        });

        it('refuses to write a Document open in a live session', async () => {
            const { secret } = await createKey();
            spaceDb.prepare(`INSERT INTO collab_sessions (note_id, session_id, ydoc_state, base_content, base_hash, started_at, updated_at)
                             VALUES ('s-note', 'sess-1', x'00', 'team text', 'h', '2026', '2026')`).run();
            for (const call of [
                request(app).patch('/v1/documents/s-note').set(bearer(secret)).send({ content: 'x' }),
                request(app).post('/v1/documents/s-note/append').set(bearer(secret)).send({ content: 'x' }),
                request(app).delete('/v1/documents/s-note').set(bearer(secret)),
            ]) {
                const res = await call;
                expect(res.status).toBe(409);
                expect(res.body.code).toBe('DOCUMENT_IN_LIVE_SESSION');
            }
            expect(spaceDb.prepare("SELECT content FROM notes WHERE id = 's-note'").get().content).toBe('team text');
        });

        it('a personal-only key cannot reach spaces', async () => {
            const { secret } = await createKey({ spaceAccess: 'personal' });
            const read = await request(app).get('/v1/documents/s-note').set(bearer(secret));
            expect(read.status).toBe(404);
            const explicit = await request(app).get(`/v1/tree?space=${spaceId}`).set(bearer(secret));
            expect(explicit.status).toBe(404);
            expect(explicit.body.code).toBe('SPACE_NOT_FOUND');
            const me = await request(app).get('/v1/me').set(bearer(secret));
            expect(me.body.databases).toHaveLength(1);
        });

        it('a non-member gets the same 404, and losing membership cuts access at once', async () => {
            addEditorMember({ actorUserId: owner.userId, spaceId, userId: other.userId });
            const { secret } = await createKey({}, getTestToken(other.userId));
            expect((await request(app).get(`/v1/tree?space=${spaceId}`).set(bearer(secret))).status).toBe(200);
            removeEditorMember({ actorUserId: owner.userId, spaceId, userId: other.userId });
            const after = await request(app).get(`/v1/tree?space=${spaceId}`).set(bearer(secret));
            expect(after.status).toBe(404);
            expect(after.body.code).toBe('SPACE_NOT_FOUND');
            expect((await request(app).get('/v1/documents/s-note').set(bearer(secret))).status).toBe(404);
            const missing = await request(app).get('/v1/tree?space=00000000-0000-4000-8000-000000000000').set(bearer(secret));
            expect(missing.body).toEqual(after.body);
        });
    });
});
