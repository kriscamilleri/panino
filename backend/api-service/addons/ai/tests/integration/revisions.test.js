// Revision history in the v1 API, over REST and MCP
// (docs/specs/proposed/ai-api-expansion.md §4.4).
import request from 'supertest';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteTestDb, getDb, getSpacesDb, getUserDb } from '../../../../db.js';
import { addEditorMember, createSpace } from '../../../../spaces.js';
import { describeActor } from '../../revisionService.js';
import { aiUser, createKey, createTestApp, offerAiAddon, resetAiState } from '../aiTestSetup.js';

const V1 = '/addons/ai/v1';
const MCP = `${V1}/mcp`;

function insertRevision(db, { id, noteId, title, content, type = 'auto', createdAt, actorUserId = null, actorKind = null, actorLabel = null }) {
    const gz = gzipSync(Buffer.from(content, 'utf8'));
    const sha = createHash('sha256').update(content, 'utf8').digest('hex');
    db.prepare(`INSERT INTO note_revisions (id, note_id, title, content_gzip, type, content_sha256,
                    uncompressed_bytes, compressed_bytes, created_at, actor_user_id, actor_kind, actor_label)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, noteId, title, gz, type, sha, Buffer.byteLength(content, 'utf8'), gz.length, createdAt, actorUserId, actorKind, actorLabel);
}

describe('AI agents add-on: revisions', () => {
    let app;
    let server;
    let clients;
    let restore;
    let user;
    let secret;
    let spaceId;
    let nextId = 1;
    const extraUsers = [];

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
        spaceId = null;
        user = await aiUser('revisions');
        ({ secret } = await createKey(app, user, { name: 'Claude Code' }));
    });
    afterEach(() => {
        clients.clear();
        const spacesDb = getSpacesDb();
        if (spaceId) {
            spacesDb.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
            spacesDb.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
            deleteTestDb(`space:${spaceId}`);
        }
        for (const person of [user, ...extraUsers.splice(0)]) {
            spacesDb.prepare('DELETE FROM space_user_versions WHERE user_id = ?').run(person.userId);
            person.cleanup();
        }
    });

    const bearer = (key = secret) => ({ Authorization: `Bearer ${key}` });
    const call = (name, args, key = secret) => request(app).post(MCP)
        .set('Authorization', `Bearer ${key}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
    const text = (res) => res.body.result.content[0].text;

    function insertNote(db, { id, title, content, updatedAt = '2026-11-01T10:00:00.000Z', personal = true }) {
        if (personal) {
            db.prepare(`INSERT INTO notes (id, user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
                .run(id, user.userId, title, content, updatedAt, updatedAt);
        } else {
            db.prepare(`INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
                .run(id, title, content, updatedAt, updatedAt);
        }
    }

    function rows(db, noteId) {
        return db.prepare(`SELECT id, type, title, actor_kind, actor_user_id, actor_label FROM note_revisions
                            WHERE note_id = ? ORDER BY created_at, rowid`).all(noteId);
    }

    function content(db, noteId) {
        return db.prepare('SELECT title, content FROM notes WHERE id = ?').get(noteId);
    }

    /** A Document with three revisions an hour apart: v1, v2, v3 (current is v3 plus an edit). */
    function seedHistory(db, noteId = 'n-1', { personal = true } = {}) {
        insertNote(db, { id: noteId, title: 'Plan', content: 'one\ntwo\nthree\nfour\n', personal });
        insertRevision(db, { id: `${noteId}-r1`, noteId, title: 'Plan v1', content: 'one\ntwo\n', createdAt: '2026-11-01T07:00:00.000Z', type: 'manual', actorUserId: user.userId, actorKind: 'system' });
        insertRevision(db, { id: `${noteId}-r2`, noteId, title: 'Plan', content: 'one\ntwo\nthree\n', createdAt: '2026-11-01T08:00:00.000Z' });
        insertRevision(db, { id: `${noteId}-r3`, noteId, title: 'Plan', content: 'one\nTWO\nthree\n', createdAt: '2026-11-01T09:00:00.000Z', actorUserId: user.userId, actorKind: 'api', actorLabel: 'n8n' });
    }

    describe('listing', () => {
        it('lists newest first, paged by cursor and by before, with who made each', async () => {
            const db = getUserDb(user.userId);
            seedHistory(db);

            const first = await request(app).get(`${V1}/documents/n-1/revisions?limit=2`).set(bearer());
            expect(first.status).toBe(200);
            expect(first.body.total).toBe(3);
            expect(first.body.document).toMatchObject({ id: 'n-1', title: 'Plan', space: null });
            expect(first.body.revisions.map((rev) => rev.id)).toEqual(['n-1-r3', 'n-1-r2']);
            expect(first.body.revisions[0]).toMatchObject({
                type: 'auto', createdAt: '2026-11-01T09:00:00.000Z', title: 'Plan', size: 14,
                who: { kind: 'api', label: 'n8n', userId: user.userId, text: expect.stringMatching(/via n8n \(API key\)$/) },
            });
            expect(first.body.revisions[0].who.text).toMatch(/^by /);
            expect(first.body.revisions[1].who).toMatchObject({ kind: 'unknown', label: null, userId: null, text: 'author not recorded' });
            expect(first.body.revisions[0]).not.toHaveProperty('content');
            expect(first.body.nextCursor).toBeTruthy();

            const second = await request(app).get(`${V1}/documents/n-1/revisions?limit=2&cursor=${first.body.nextCursor}`).set(bearer());
            expect(second.body.revisions.map((rev) => rev.id)).toEqual(['n-1-r1']);
            expect(second.body.revisions[0]).toMatchObject({ type: 'manual', who: { kind: 'user', userId: user.userId } });
            expect(second.body.nextCursor).toBeNull();

            const before = await request(app).get(`${V1}/documents/n-1/revisions?before=2026-11-01T08:30:00Z`).set(bearer());
            expect(before.body.revisions.map((rev) => rev.id)).toEqual(['n-1-r2', 'n-1-r1']);

            const bad = await request(app).get(`${V1}/documents/n-1/revisions?cursor=nope`).set(bearer());
            expect(bad.status).toBe(400);
            expect(bad.body.code).toBe('INVALID_INPUT');
            const missing = await request(app).get(`${V1}/documents/nope/revisions`).set(bearer());
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('NOT_FOUND');
        });

        it('names the key behind an API edit, in the order it was written', async () => {
            const db = getUserDb(user.userId);
            insertNote(db, { id: 'n-edit', title: 'Log', content: 'start' });
            await request(app).post(`${V1}/documents/n-edit/append`).set(bearer()).send({ content: 'more' }).expect(200);

            const res = await call('list_revisions', { id: 'n-edit' });
            expect(res.body.result.isError).toBeUndefined();
            const listed = res.body.result.structuredContent.revisions;
            // The after-snapshot (newest) is the key's; the before-snapshot is unattributed.
            expect(listed.map((rev) => rev.who.kind)).toEqual(['api', 'unknown']);
            expect(listed[0].who.label).toBe('Claude Code');
            expect(text(res)).toContain('Revisions of "Log" (id n-edit), newest first, 2 of 2:');
            expect(text(res)).toContain(`via Claude Code (API key) — revision id ${listed[0].id}`);
        });

        it('describes every kind of author in the app\'s wording', () => {
            const names = new Map([['u-1', 'Kris']]);
            const who = (row) => describeActor({ actor_user_id: null, actor_kind: null, actor_label: null, ...row }, names).text;
            expect(who({ actor_user_id: 'u-1', actor_kind: 'app', actor_label: 'Claude' })).toBe('by Kris via Claude (connected app)');
            expect(who({ actor_user_id: 'u-1', actor_kind: 'api', actor_label: 'n8n' })).toBe('by Kris via n8n (API key)');
            expect(who({ actor_kind: 'api' })).toBe('via API');
            expect(who({ actor_user_id: 'u-1', actor_kind: 'sync' })).toBe('by Kris (synced from a device)');
            expect(who({ actor_user_id: 'u-1', actor_kind: 'collab' })).toBe('by Kris (live session)');
            expect(who({ actor_user_id: 'u-1', actor_kind: 'system' })).toBe('by Kris');
            expect(who({ actor_user_id: 'u-gone', actor_kind: 'system' })).toBe('by a former member');
            expect(who({ actor_kind: 'system' })).toBe('by Panino');
        });
    });

    describe('reading and comparing', () => {
        it('reads a revision, whole or by lines, over REST and MCP', async () => {
            seedHistory(getUserDb(user.userId));
            const res = await request(app).get(`${V1}/documents/n-1/revisions/n-1-r2`).set(bearer());
            expect(res.status).toBe(200);
            expect(res.body.revision).toMatchObject({ id: 'n-1-r2', title: 'Plan', content: 'one\ntwo\nthree\n', type: 'auto' });
            const part = await request(app).get(`${V1}/documents/n-1/revisions/n-1-r2?startLine=2&endLine=3`).set(bearer());
            expect(part.body.revision).toMatchObject({ content: 'two\nthree', startLine: 2, endLine: 3, lineCount: 4 });

            const tool = await call('get_revision', { id: 'n-1', revision_id: 'n-1-r1' });
            expect(text(tool)).toContain('Revision: n-1-r1');
            expect(text(tool)).toContain('title: Plan v1');
            expect(text(tool)).toMatch(/\n\none\ntwo\n$/);

            const missing = await request(app).get(`${V1}/documents/n-1/revisions/nope`).set(bearer());
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('REVISION_NOT_FOUND');
            const missingTool = await call('get_revision', { id: 'n-1', revision_id: 'nope' });
            expect(missingTool.body.result.isError).toBe(true);
            expect(text(missingTool)).toContain('list_revisions');
        });

        it('does not read a revision through another Document', async () => {
            const db = getUserDb(user.userId);
            seedHistory(db);
            insertNote(db, { id: 'n-2', title: 'Other', content: 'x' });
            const res = await request(app).get(`${V1}/documents/n-2/revisions/n-1-r1`).set(bearer());
            expect(res.body.code).toBe('REVISION_NOT_FOUND');
        });

        it('maps a corrupt payload to REVISION_CORRUPT', async () => {
            const db = getUserDb(user.userId);
            seedHistory(db);
            db.prepare("UPDATE note_revisions SET content_gzip = x'00112233' WHERE id = 'n-1-r2'").run();
            const res = await request(app).get(`${V1}/documents/n-1/revisions/n-1-r2`).set(bearer());
            expect(res.status).toBe(422);
            expect(res.body).toEqual({ error: expect.any(String), code: 'REVISION_CORRUPT' });
            const tool = await call('compare_revisions', { id: 'n-1', revision_id: 'n-1-r2' });
            expect(tool.body.result.isError).toBe(true);
            expect(text(tool)).toContain('damaged');
        });

        it('diffs a revision against the current body and against another revision', async () => {
            seedHistory(getUserDb(user.userId));
            const current = await request(app).get(`${V1}/documents/n-1/revisions/n-1-r2/diff`).set(bearer());
            expect(current.status).toBe(200);
            expect(current.body).toMatchObject({ added: 1, removed: 0, identical: false, titleChanged: false, truncated: false, hunks: 1 });
            expect(current.body.from).toMatchObject({ id: 'n-1-r2' });
            expect(current.body.to).toMatchObject({ id: 'current', title: 'Plan' });
            expect(current.body.diff).toContain('@@ -1,3 +1,4 @@');
            expect(current.body.diff).toContain('\n+four\n');

            const other = await request(app).get(`${V1}/documents/n-1/revisions/n-1-r1/diff?against=n-1-r3&context=0`).set(bearer());
            expect(other.body).toMatchObject({ added: 2, removed: 1, titleChanged: true });
            expect(other.body.diff).toContain('-two\n+TWO\n+three\n');

            const tool = await call('compare_revisions', { id: 'n-1', revision_id: 'n-1-r1', against: 'n-1-r2' });
            expect(text(tool)).toContain('From revision n-1-r1');
            expect(text(tool)).toContain('Title: "Plan v1" → "Plan"');
            expect(text(tool)).toContain('1 line(s) added, 0 removed, in 1 hunk(s).');

            const same = await call('compare_revisions', { id: 'n-1', revision_id: 'n-1-r2', against: 'n-1-r2' });
            expect(text(same)).toContain('No differences.');

            const unknown = await request(app).get(`${V1}/documents/n-1/revisions/n-1-r1/diff?against=nope`).set(bearer());
            expect(unknown.body.code).toBe('REVISION_NOT_FOUND');
            const badContext = await request(app).get(`${V1}/documents/n-1/revisions/n-1-r1/diff?context=x`).set(bearer());
            expect(badContext.body.code).toBe('INVALID_INPUT');
        });

        it('refuses to compare versions that differ too much', async () => {
            const db = getUserDb(user.userId);
            const many = (prefix) => Array.from({ length: 1500 }, (_, i) => `${prefix} ${i}`).join('\n');
            insertNote(db, { id: 'n-big', title: 'Big', content: many('new') });
            insertRevision(db, { id: 'r-big', noteId: 'n-big', title: 'Big', content: many('old'), createdAt: '2026-11-01T08:00:00.000Z' });
            const res = await request(app).get(`${V1}/documents/n-big/revisions/r-big/diff`).set(bearer());
            expect(res.status).toBe(422);
            expect(res.body.code).toBe('DIFF_TOO_LARGE');
            const tool = await call('compare_revisions', { id: 'n-big', revision_id: 'r-big' });
            expect(text(tool)).toContain('get_revision');
        });
    });

    describe('saving', () => {
        it('saves an attributed manual checkpoint, and reports a duplicate without an error', async () => {
            const db = getUserDb(user.userId);
            insertNote(db, { id: 'n-save', title: 'Draft', content: 'body' });
            const sent = [];
            clients.set({ readyState: 1, send: (msg) => sent.push(msg) }, { userId: user.userId, siteId: 'b'.repeat(32) });

            const created = await request(app).post(`${V1}/documents/n-save/revisions`).set(bearer()).send({});
            expect(created.status).toBe(201);
            expect(created.body).toMatchObject({ created: true, revision: { type: 'manual', title: 'Draft', size: 4, who: { kind: 'api', label: 'Claude Code' } } });
            expect(rows(db, 'n-save')).toEqual([
                { id: created.body.revision.id, type: 'manual', title: 'Draft', actor_kind: 'api', actor_user_id: user.userId, actor_label: 'Claude Code' },
            ]);
            expect(sent).toContain(JSON.stringify({ type: 'sync' }));

            const again = await request(app).post(`${V1}/documents/n-save/revisions`).set(bearer()).send({});
            expect(again.status).toBe(200);
            expect(again.body).toMatchObject({ created: false, reason: 'duplicate-latest', revision: { id: created.body.revision.id } });
            const tool = await call('save_revision', { id: 'n-save' });
            expect(tool.body.result.isError).toBeUndefined();
            expect(text(tool)).toContain('Nothing new to save');
            expect(rows(db, 'n-save')).toHaveLength(1);
        });

        it('sees the after-snapshot of an API edit as the newest revision', async () => {
            const db = getUserDb(user.userId);
            insertNote(db, { id: 'n-dup', title: 'Log', content: 'start' });
            await request(app).post(`${V1}/documents/n-dup/append`).set(bearer()).send({ content: 'more' }).expect(200);
            const res = await call('save_revision', { id: 'n-dup' });
            expect(res.body.result.structuredContent.created).toBe(false);
            expect(rows(db, 'n-dup')).toHaveLength(2);
        });
    });

    describe('restoring', () => {
        it('saves a pre-restore revision, restores the body, and records who restored it', async () => {
            const db = getUserDb(user.userId);
            seedHistory(db);
            const sent = [];
            clients.set({ readyState: 1, send: (msg) => sent.push(msg) }, { userId: user.userId, siteId: 'b'.repeat(32) });

            const res = await request(app).post(`${V1}/documents/n-1/revisions/n-1-r1/restore`).set(bearer())
                .send({ expectedUpdatedAt: '2026-11-01T10:00:00.000Z' });
            expect(res.status).toBe(200);
            expect(res.body.document).toMatchObject({ id: 'n-1', title: 'Plan v1', content: 'one\ntwo\n' });
            expect(res.body.document.updatedAt).not.toBe('2026-11-01T10:00:00.000Z');
            expect(res.body.restoredFrom).toBe('n-1-r1');
            expect(content(db, 'n-1')).toEqual({ title: 'Plan v1', content: 'one\ntwo\n' });
            expect(sent).toContain(JSON.stringify({ type: 'sync' }));

            const history = rows(db, 'n-1');
            const pre = history.find((row) => row.id === res.body.preRestoreRevisionId);
            const after = history.find((row) => row.id === res.body.revisionId);
            expect(pre).toMatchObject({ type: 'pre-restore', title: 'Plan', actor_kind: null, actor_user_id: null });
            expect(after).toMatchObject({ type: 'auto', title: 'Plan v1', actor_kind: 'api', actor_user_id: user.userId, actor_label: 'Claude Code' });
            expect(history.slice(-2).map((row) => row.id)).toEqual([pre.id, after.id]);

            // Undo: restore the pre-restore revision, over MCP.
            const undo = await call('restore_revision', { id: 'n-1', revision_id: pre.id });
            expect(undo.body.result.isError).toBeUndefined();
            expect(text(undo)).toContain('pre-restore revision');
            expect(content(db, 'n-1')).toEqual({ title: 'Plan', content: 'one\ntwo\nthree\nfour\n' });
        });

        it('honours expectedUpdatedAt', async () => {
            const db = getUserDb(user.userId);
            seedHistory(db);
            const stale = await request(app).post(`${V1}/documents/n-1/revisions/n-1-r1/restore`).set(bearer())
                .send({ expectedUpdatedAt: '2025-01-01T00:00:00.000Z' });
            expect(stale.status).toBe(409);
            expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentUpdatedAt: '2026-11-01T10:00:00.000Z' } });
            const tool = await call('restore_revision', { id: 'n-1', revision_id: 'n-1-r1', expected_updated_at: 'stale' });
            expect(text(tool)).toContain('Its updated_at is now 2026-11-01T10:00:00.000Z');
            expect(content(db, 'n-1').content).toBe('one\ntwo\nthree\nfour\n');
            expect(rows(db, 'n-1')).toHaveLength(3);
        });

        it('404s an unknown revision and writes nothing', async () => {
            const db = getUserDb(user.userId);
            seedHistory(db);
            const res = await request(app).post(`${V1}/documents/n-1/revisions/nope/restore`).set(bearer()).send({});
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('REVISION_NOT_FOUND');
            expect(rows(db, 'n-1')).toHaveLength(3);
            const tool = await call('restore_revision', { id: 'n-1', revision_id: 'nope' });
            expect(tool.body.result.isError).toBe(true);
            expect(text(tool)).toContain('list_revisions');
        });

        it('refuses a corrupt revision and writes nothing', async () => {
            const db = getUserDb(user.userId);
            seedHistory(db);
            db.prepare("UPDATE note_revisions SET content_gzip = x'00' WHERE id = 'n-1-r1'").run();
            const res = await request(app).post(`${V1}/documents/n-1/revisions/n-1-r1/restore`).set(bearer()).send({});
            expect(res.status).toBe(422);
            expect(res.body.code).toBe('REVISION_CORRUPT');
            expect(rows(db, 'n-1')).toHaveLength(3);
        });
    });

    describe('read-only access', () => {
        it('cannot save or restore, over REST or MCP', async () => {
            const db = getUserDb(user.userId);
            seedHistory(db);
            const { secret: readKey } = await createKey(app, user, { name: 'Reader', scope: 'read' });
            for (const res of [
                await request(app).post(`${V1}/documents/n-1/revisions`).set(bearer(readKey)).send({}),
                await request(app).post(`${V1}/documents/n-1/revisions/n-1-r1/restore`).set(bearer(readKey)).send({}),
            ]) {
                expect(res.status).toBe(403);
                expect(res.body.code).toBe('INSUFFICIENT_SCOPE');
            }
            for (const name of ['save_revision', 'restore_revision']) {
                const res = await call(name, { id: 'n-1', revision_id: 'n-1-r1' }, readKey);
                expect(res.body.result.isError).toBe(true);
                expect(text(res)).toContain('read-only');
            }
            expect(rows(db, 'n-1')).toHaveLength(3);
            expect(content(db, 'n-1').content).toBe('one\ntwo\nthree\nfour\n');
            // Reading still works.
            expect((await request(app).get(`${V1}/documents/n-1/revisions`).set(bearer(readKey))).status).toBe(200);
        });
    });

    describe('spaces', () => {
        let spaceDb;
        beforeEach(() => {
            spaceId = createSpace({ actorUserId: user.userId, name: 'Team' }).spaceId;
            spaceDb = getDb(`space:${spaceId}`);
            seedHistory(spaceDb, 's-1', { personal: false });
        });

        it('reaches a space Document by id alone, and names current members only', async () => {
            const member = await aiUser('revisions-member');
            const stranger = await aiUser('revisions-stranger');
            extraUsers.push(member, stranger);
            addEditorMember({ actorUserId: user.userId, spaceId, userId: member.userId });
            insertRevision(spaceDb, { id: 's-1-r4', noteId: 's-1', title: 'Plan', content: 'x', createdAt: '2026-11-01T09:30:00.000Z', actorUserId: member.userId, actorKind: 'sync' });
            insertRevision(spaceDb, { id: 's-1-r5', noteId: 's-1', title: 'Plan', content: 'y', createdAt: '2026-11-01T09:40:00.000Z', actorUserId: stranger.userId, actorKind: 'collab' });

            const res = await request(app).get(`${V1}/documents/s-1/revisions`).set(bearer());
            expect(res.status).toBe(200);
            expect(res.body.document.space).toBe(spaceId);
            const byId = Object.fromEntries(res.body.revisions.map((rev) => [rev.id, rev.who]));
            expect(byId['s-1-r4']).toMatchObject({ kind: 'sync', userId: member.userId, userName: expect.any(String) });
            expect(byId['s-1-r5']).toEqual({ kind: 'collab', label: null, userId: null, userName: null, text: 'by a former member (live session)' });

            const explicit = await request(app).get(`${V1}/documents/s-1/revisions/s-1-r1?space=${spaceId}`).set(bearer());
            expect(explicit.body.revision.content).toBe('one\ntwo\n');
        });

        it('restores a space Document, attributed to the key', async () => {
            const res = await request(app).post(`${V1}/documents/s-1/revisions/s-1-r2/restore`).set(bearer()).send({});
            expect(res.status).toBe(200);
            expect(res.body.document).toMatchObject({ space: spaceId, content: 'one\ntwo\nthree\n' });
            const after = spaceDb.prepare('SELECT actor_kind, actor_label FROM note_revisions WHERE id = ?').get(res.body.revisionId);
            expect(after).toEqual({ actor_kind: 'api', actor_label: 'Claude Code' });
        });

        it('refuses to save over or restore a Document in a live session', async () => {
            spaceDb.prepare(`INSERT INTO collab_sessions (note_id, session_id, ydoc_state, base_content, base_hash, started_at, updated_at)
                             VALUES ('s-1', 'sess-1', x'00', 'x', 'h', '2026', '2026')`).run();
            const res = await request(app).post(`${V1}/documents/s-1/revisions/s-1-r1/restore`).set(bearer()).send({});
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('DOCUMENT_IN_LIVE_SESSION');
            const tool = await call('restore_revision', { id: 's-1', revision_id: 's-1-r1' });
            expect(text(tool)).toContain('live');
            expect(spaceDb.prepare("SELECT content FROM notes WHERE id = 's-1'").get().content).toBe('one\ntwo\nthree\nfour\n');
            // The stored body lags the session's, so a checkpoint is refused too.
            const save = await request(app).post(`${V1}/documents/s-1/revisions`).set(bearer()).send({});
            expect(save.status).toBe(409);
            expect(save.body.code).toBe('DOCUMENT_IN_LIVE_SESSION');
            expect(spaceDb.prepare("SELECT COUNT(*) AS n FROM note_revisions WHERE note_id = 's-1'").get().n).toBe(3);
        });

        it('hides a space from a personal-only key and from a non-member', async () => {
            const { secret: personalKey } = await createKey(app, user, { name: 'Personal only', spaceAccess: 'personal' });
            const hidden = await request(app).get(`${V1}/documents/s-1/revisions`).set(bearer(personalKey));
            expect(hidden.status).toBe(404);
            expect(hidden.body.code).toBe('NOT_FOUND');
            const explicit = await request(app).get(`${V1}/documents/s-1/revisions?space=${spaceId}`).set(bearer(personalKey));
            expect(explicit.body.code).toBe('SPACE_NOT_FOUND');

            const outsider = await aiUser('revisions-outsider');
            extraUsers.push(outsider);
            const { secret: outsiderKey } = await createKey(app, outsider);
            const res = await request(app).post(`${V1}/documents/s-1/revisions/s-1-r1/restore`).set(bearer(outsiderKey)).send({});
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('NOT_FOUND');
            expect(spaceDb.prepare("SELECT content FROM notes WHERE id = 's-1'").get().content).toBe('one\ntwo\nthree\nfour\n');
        });
    });
});
