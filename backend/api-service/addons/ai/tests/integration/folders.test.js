// Folders and Trash in the v1 API and MCP (docs/specs/proposed/ai-api-expansion.md §4.2).
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteTestDb, getDb, getSpacesDb, getUserDb } from '../../../../db.js';
import { createSpace } from '../../../../spaces.js';
import { aiUser, createKey, createTestApp, offerAiAddon, resetAiState } from '../aiTestSetup.js';

const V1 = '/addons/ai/v1';
const MCP = `${V1}/mcp`;
const T0 = '2026-11-01T09:00:00.000Z';

describe('AI agents add-on: folders and Trash', () => {
    let app;
    let server;
    let clients;
    let restore;
    let user;
    let secret;
    let spaceId;

    const auth = (key = secret) => ({ Authorization: `Bearer ${key}` });
    const db = () => getUserDb(user.userId);

    function folder(target, id, name, parentId = null, createdAt = T0) {
        if (target === db()) {
            target.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(id, user.userId, name, parentId, createdAt);
        } else {
            target.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)').run(id, name, parentId, createdAt);
        }
    }

    function note(target, id, title, folderId = null, updatedAt = '2026-11-01T10:00:00.000Z') {
        target.prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, target === db() ? user.userId : null, folderId, title, `# ${title}`, updatedAt, updatedAt);
    }

    const parentOf = (target, id) => target.prepare('SELECT parent_id FROM folders WHERE id = ?').get(id)?.parent_id ?? null;
    const folderOf = (target, id) => target.prepare('SELECT folder_id FROM notes WHERE id = ?').get(id)?.folder_id ?? null;
    const trashId = (target) => target.prepare("SELECT id FROM folders WHERE name = 'Trash' AND parent_id IS NULL").get()?.id;
    const origin = (target, id) => target.prepare('SELECT * FROM ai_trash_origins WHERE item_id = ?').get(id);

    let nextId = 1;
    const tool = (name, args, key = secret) => request(app).post(MCP).set(auth(key))
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
        user = await aiUser('folders');
        ({ secret } = await createKey(app, user, { name: 'Folder agent' }));
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
        spacesDb.prepare('DELETE FROM space_user_versions WHERE user_id = ?').run(user.userId);
        user.cleanup();
    });

    it('creates the trash-origins table in personal and space databases, as a server-only table', () => {
        spaceId = createSpace({ actorUserId: user.userId, name: 'Team' }).spaceId;
        for (const target of [db(), getDb(`space:${spaceId}`)]) {
            const names = target.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ai_trash_origins%'").all().map((row) => row.name);
            expect(names).toEqual(['ai_trash_origins']);
        }
    });

    describe('get_folder', () => {
        beforeEach(() => {
            folder(db(), 'f-top', 'Projects');
            folder(db(), 'f-mid', 'Panino', 'f-top');
            folder(db(), 'f-low', 'Design', 'f-mid');
            folder(db(), 'f-side', 'Archive', 'f-top');
            note(db(), 'n-1', 'Roadmap', 'f-top');
            note(db(), 'n-2', 'Specs', 'f-mid');
            note(db(), 'n-3', 'Mockups', 'f-low');
        });

        it('returns the folder, its subfolders, its Documents without bodies, and counts', async () => {
            const res = await request(app).get(`${V1}/folders/f-mid`).set(auth());
            expect(res.status).toBe(200);
            expect(res.body.folder).toEqual({
                id: 'f-mid', name: 'Panino', path: 'Projects/Panino', parentId: 'f-top', parentPath: 'Projects',
                space: null, createdAt: T0, inTrash: false,
            });
            expect(res.body.subfolders).toEqual([{ id: 'f-low', name: 'Design', path: 'Projects/Panino/Design', documentCount: 1, subfolderCount: 0 }]);
            expect(res.body.documents).toEqual([expect.objectContaining({ id: 'n-2', title: 'Specs', folderPath: 'Projects/Panino' })]);
            expect(res.body.documents[0]).not.toHaveProperty('content');
            expect(res.body.counts).toEqual({ documents: 1, subfolders: 1, allDocuments: 2 });

            const top = await request(app).get(`${V1}/folders/f-top`).set(auth());
            expect(top.body.subfolders.map((sub) => [sub.name, sub.documentCount])).toEqual([['Archive', 0], ['Panino', 2]]);
            expect(top.body.counts).toEqual({ documents: 1, subfolders: 2, allDocuments: 3 });
        });

        it('404s an unknown folder, and answers over MCP', async () => {
            const missing = await request(app).get(`${V1}/folders/nope`).set(auth());
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('FOLDER_NOT_FOUND');

            const viaTool = await tool('get_folder', { id: 'f-mid' });
            expect(text(viaTool)).toMatch(/^Folder: Projects\/Panino\nid: f-mid\n/);
            expect(text(viaTool)).toContain('parent: Projects (folder id f-top)');
            expect(text(viaTool)).toContain('1 Document directly here, 1 subfolder, 2 Documents in all');
            expect(text(viaTool)).toContain('1. Design/ — folder id f-low — 1 Document');
            expect(text(viaTool)).toContain('1. Specs — id n-2');
            expect(viaTool.body.result.structuredContent.counts.allDocuments).toBe(2);
            const notThere = await tool('get_folder', { id: 'nope' });
            expect(notThere.body.result.isError).toBe(true);
            expect(text(notThere)).toContain('list_folders');
        });
    });

    describe('rename and move', () => {
        beforeEach(() => {
            folder(db(), 'a', 'A');
            folder(db(), 'b', 'B', 'a');
            folder(db(), 'c', 'C', 'b');
            folder(db(), 'd', 'D', 'c');
            folder(db(), 'other', 'Other');
            note(db(), 'n-d', 'Deep', 'd');
        });

        it('renames, as a CRR change devices receive, and pokes them', async () => {
            const sent = [];
            clients.set({ readyState: 1, send: (msg) => sent.push(msg) }, { userId: user.userId, siteId: 'b'.repeat(32) });
            const res = await request(app).patch(`${V1}/folders/b`).set(auth()).send({ name: '  Beta  ' });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ changed: true, folder: { id: 'b', name: 'Beta', path: 'A/Beta' } });
            expect(sent).toContain(JSON.stringify({ type: 'sync' }));

            const pull = await request(app).post('/sync').set('Authorization', `Bearer ${user.jwt}`)
                .send({ since: 0, siteId: 'c'.repeat(32), changes: [] });
            const names = pull.body.changes.filter((change) => change.table === 'folders' && change.cid === 'name').map((change) => change.val);
            expect(names).toContain('Beta');

            const same = await request(app).patch(`${V1}/folders/b`).set(auth()).send({ name: 'Beta' });
            expect(same.body.changed).toBe(false);
            const empty = await request(app).patch(`${V1}/folders/b`).set(auth()).send({ name: ' ' });
            expect(empty.body.code).toBe('INVALID_INPUT');
            const nothing = await request(app).patch(`${V1}/folders/b`).set(auth()).send({});
            expect(nothing.body.code).toBe('NOTHING_TO_UPDATE');
        });

        it('moves, to a folder or the top level, and takes name and parentId together', async () => {
            const moved = await request(app).patch(`${V1}/folders/c`).set(auth()).send({ parentId: 'other' });
            expect(moved.body.folder).toMatchObject({ path: 'Other/C', parentId: 'other' });
            const top = await request(app).patch(`${V1}/folders/c`).set(auth()).send({ parentId: null });
            expect(top.body.folder).toMatchObject({ path: 'C', parentId: null });
            const both = await request(app).patch(`${V1}/folders/c`).set(auth()).send({ parentId: 'a', name: 'Gamma' });
            expect(both.body.folder).toMatchObject({ path: 'A/Gamma', parentId: 'a', name: 'Gamma' });
            expect(folderOf(db(), 'n-d')).toBe('d');

            const viaTool = await tool('move_folder', { id: 'c', parent_id: 'root' });
            expect(text(viaTool)).toBe('Moved folder "Gamma" to the top level (folder id c).');
            expect(parentOf(db(), 'c')).toBeNull();
            const renamed = await tool('rename_folder', { id: 'c', name: 'Delta' });
            expect(text(renamed)).toContain('Renamed the folder to "Delta"');
        });

        it('refuses a move into itself or any descendant, however deep, and a missing parent', async () => {
            for (const parentId of ['a', 'b', 'c', 'd']) {
                const res = await request(app).patch(`${V1}/folders/a`).set(auth()).send({ parentId });
                expect(res.status, parentId).toBe(400);
                expect(res.body.code, parentId).toBe('FOLDER_CYCLE');
            }
            expect(parentOf(db(), 'a')).toBeNull();
            const missing = await request(app).patch(`${V1}/folders/a`).set(auth()).send({ parentId: 'nope' });
            expect(missing.body.code).toBe('PARENT_NOT_FOUND');

            const viaTool = await tool('move_folder', { id: 'b', parent_id: 'd' });
            expect(viaTool.body.result.isError).toBe(true);
            expect(text(viaTool)).toContain('cannot be moved into itself');
        });

        it('keeps the name Trash for the Trash folder at the top level', async () => {
            const renamed = await request(app).patch(`${V1}/folders/a`).set(auth()).send({ name: 'trash' });
            expect(renamed.body.code).toBe('TRASH_NAME_RESERVED');
            const nested = await request(app).patch(`${V1}/folders/b`).set(auth()).send({ name: 'Trash' });
            expect(nested.status).toBe(200);
            const lifted = await request(app).patch(`${V1}/folders/b`).set(auth()).send({ parentId: 'root' });
            expect(lifted.body.code).toBe('TRASH_NAME_RESERVED');
            expect(parentOf(db(), 'b')).toBe('a');
        });
    });

    describe('Trash', () => {
        it('protects the Trash folder from rename, move and trash', async () => {
            folder(db(), 'f', 'Work');
            note(db(), 'n', 'Doc');
            await request(app).delete(`${V1}/documents/n`).set(auth()).expect(200);
            const trash = trashId(db());
            for (const call of [
                request(app).patch(`${V1}/folders/${trash}`).set(auth()).send({ name: 'Bin' }),
                request(app).patch(`${V1}/folders/${trash}`).set(auth()).send({ parentId: 'f' }),
                request(app).delete(`${V1}/folders/${trash}`).set(auth()),
                request(app).post(`${V1}/trash/${trash}/restore`).set(auth()).send({}),
            ]) {
                const res = await call;
                expect(res.status).toBe(400);
                expect(res.body.code).toBe('TRASH_FOLDER_PROTECTED');
            }
            const viaTool = await tool('rename_folder', { id: trash, name: 'Bin' });
            expect(text(viaTool)).toContain('Trash folder itself cannot be renamed');
            const read = await request(app).get(`${V1}/folders/${trash}`).set(auth());
            expect(read.body.folder).toMatchObject({ isTrash: true, inTrash: true });
        });

        it('trashes a folder with its contents, records where it was, and is idempotent', async () => {
            folder(db(), 'p', 'Projects');
            folder(db(), 'f', 'Old', 'p');
            folder(db(), 'g', 'Older', 'f');
            note(db(), 'n-f', 'In old', 'f');
            note(db(), 'n-g', 'In older', 'g');

            const res = await request(app).delete(`${V1}/folders/f`).set(auth());
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ previousParentId: 'p', alreadyInTrash: false, documentCount: 2, folder: { path: 'Trash/Old', inTrash: true } });
            expect(parentOf(db(), 'f')).toBe(trashId(db()));
            expect(origin(db(), 'f')).toMatchObject({ item_kind: 'folder', previous_parent_id: 'p' });
            // The Documents are untouched: only the folder row moved.
            expect(db().prepare("SELECT folder_id, updated_at FROM notes WHERE id = 'n-g'").get())
                .toEqual({ folder_id: 'g', updated_at: '2026-11-01T10:00:00.000Z' });

            const again = await request(app).delete(`${V1}/folders/f`).set(auth());
            expect(again.body.alreadyInTrash).toBe(true);
            const inside = await request(app).delete(`${V1}/folders/g`).set(auth());
            expect(inside.body.alreadyInTrash).toBe(true);
            expect(db().prepare("SELECT COUNT(*) AS c FROM folders WHERE name = 'Trash'").get().c).toBe(1);

            const search = await request(app).get(`${V1}/search?q=older`).set(auth());
            expect(search.body.results).toEqual([]);

            const viaTool = await tool('move_folder_to_trash', { id: 'p' });
            expect(text(viaTool)).toMatch(/^Moved folder "Projects" \(with 0 Documents\) to Trash\. Nothing is deleted: restore_from_trash/);
        });

        it('lists the direct children of Trash, newest trashed first, with where each would go', async () => {
            folder(db(), 'f', 'Work');
            folder(db(), 'old', 'Old stuff');
            note(db(), 'n-api', 'Trashed by the agent', 'f');
            note(db(), 'n-app', 'Trashed in the app');
            await request(app).delete(`${V1}/folders/old`).set(auth()).expect(200);
            await new Promise((resolve) => setTimeout(resolve, 5));
            await request(app).delete(`${V1}/documents/n-api`).set(auth()).expect(200);
            db().prepare("UPDATE notes SET folder_id = ? WHERE id = 'n-app'").run(trashId(db()));

            const res = await request(app).get(`${V1}/trash`).set(auth());
            expect(res.status).toBe(200);
            expect(res.body.total).toBe(3);
            expect(res.body.items.map((item) => [item.kind, item.id, item.restoresTo.reason])).toEqual([
                ['document', 'n-api', 'previous-location'],
                ['folder', 'old', 'previous-location'],
                ['document', 'n-app', 'no-record'],
            ]);
            expect(res.body.items[0]).toMatchObject({ trashedAt: expect.any(String), restoresTo: { folderId: 'f', path: 'Work' }, space: null, spaceName: 'Personal' });
            expect(res.body.items[2].trashedAt).toBeNull();

            const page = await request(app).get(`${V1}/trash?limit=2`).set(auth());
            expect(page.body.items).toHaveLength(2);
            expect(page.body.nextOffset).toBe(2);
            const rest = await request(app).get(`${V1}/trash?limit=2&offset=2`).set(auth());
            expect(rest.body.items.map((item) => item.id)).toEqual(['n-app']);
            expect(rest.body.nextOffset).toBeNull();

            const viaTool = await tool('list_trash', { limit: 2 });
            expect(text(viaTool)).toContain('1. [Document] Trashed by the agent — id n-api — trashed ');
            expect(text(viaTool)).toContain('restores to folder Work');
            expect(text(viaTool)).toContain('2. [folder] Old stuff/ — id old — 0 Documents');
            expect(text(viaTool)).toContain('next_offset: 2');
            const empty = await tool('list_trash', { space: 'personal', offset: 10 });
            expect(text(empty)).toBe('Trash is empty.');
        });

        it('restores a Document to its recorded folder and forgets the record', async () => {
            folder(db(), 'f', 'Work');
            note(db(), 'n', 'Plan', 'f');
            await request(app).delete(`${V1}/documents/n`).set(auth()).expect(200);
            expect(origin(db(), 'n')).toMatchObject({ item_kind: 'document', previous_parent_id: 'f' });

            const res = await request(app).post(`${V1}/trash/n/restore`).set(auth()).send({});
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ kind: 'document', reason: 'previous-location', destination: { folderId: 'f', path: 'Work' } });
            expect(res.body.document).toMatchObject({ id: 'n', folderPath: 'Work' });
            expect(res.body.document.inTrash).toBeUndefined();
            expect(folderOf(db(), 'n')).toBe('f');
            expect(origin(db(), 'n')).toBeUndefined();

            const again = await request(app).post(`${V1}/trash/n/restore`).set(auth()).send({});
            expect(again.status).toBe(409);
            expect(again.body.code).toBe('NOT_IN_TRASH');
            const unknown = await request(app).post(`${V1}/trash/nope/restore`).set(auth()).send({});
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('ITEM_NOT_FOUND');
        });

        it('restores a folder with everything in it', async () => {
            folder(db(), 'p', 'Projects');
            folder(db(), 'f', 'Panino', 'p');
            folder(db(), 'g', 'Design', 'f');
            note(db(), 'n-g', 'Mockups', 'g');
            await request(app).delete(`${V1}/folders/f`).set(auth()).expect(200);

            const viaTool = await tool('restore_from_trash', { id: 'f' });
            expect(text(viaTool)).toBe('Restored folder "Panino" (id f) to folder Projects: where it was before it was moved to Trash.');
            expect(parentOf(db(), 'f')).toBe('p');
            const doc = await request(app).get(`${V1}/documents/n-g`).set(auth());
            expect(doc.body.document.folderPath).toBe('Projects/Panino/Design');
            expect(doc.body.document.inTrash).toBeUndefined();
        });

        it('restores to the top level when the recorded folder is gone or in Trash', async () => {
            folder(db(), 'gone', 'Gone');
            folder(db(), 'binned', 'Binned');
            note(db(), 'n-1', 'One', 'gone');
            note(db(), 'n-2', 'Two', 'binned');
            await request(app).delete(`${V1}/documents/n-1`).set(auth()).expect(200);
            await request(app).delete(`${V1}/documents/n-2`).set(auth()).expect(200);
            db().prepare("DELETE FROM folders WHERE id = 'gone'").run();
            await request(app).delete(`${V1}/folders/binned`).set(auth()).expect(200);

            const one = await request(app).post(`${V1}/trash/n-1/restore`).set(auth()).send({});
            expect(one.body).toMatchObject({ reason: 'previous-location-missing', destination: { folderId: null, path: '' } });
            const two = await tool('restore_from_trash', { id: 'n-2' });
            expect(text(two)).toBe('Restored "Two" (id n-2) to the top level: its previous folder is in Trash too.');
            expect(folderOf(db(), 'n-1')).toBeNull();
            expect(folderOf(db(), 'n-2')).toBeNull();
        });

        it('restores something trashed in the app, or nested in a trashed folder, to the top level', async () => {
            note(db(), 'n-app', 'App trashed');
            folder(db(), 'f', 'Work');
            folder(db(), 'inner', 'Inner', 'f');
            note(db(), 'n-inner', 'Nested', 'inner');
            await request(app).delete(`${V1}/folders/f`).set(auth()).expect(200);
            db().prepare("UPDATE notes SET folder_id = ? WHERE id = 'n-app'").run(trashId(db()));

            const app1 = await request(app).post(`${V1}/trash/n-app/restore`).set(auth()).send({});
            expect(app1.body).toMatchObject({ reason: 'no-record', destination: { folderId: null } });
            expect(folderOf(db(), 'n-app')).toBeNull();
            const nested = await request(app).post(`${V1}/trash/n-inner/restore`).set(auth()).send({});
            expect(nested.body).toMatchObject({ reason: 'no-record', destination: { folderId: null } });
            const nestedFolder = await request(app).post(`${V1}/trash/inner/restore`).set(auth()).send({});
            expect(nestedFolder.body).toMatchObject({ kind: 'folder', reason: 'no-record', folder: { path: 'Inner', inTrash: false } });
        });

        it('restores into a chosen folder, which must exist and be outside Trash', async () => {
            folder(db(), 'dest', 'Destination');
            folder(db(), 'binned', 'Binned');
            note(db(), 'n', 'Plan');
            await request(app).delete(`${V1}/documents/n`).set(auth()).expect(200);
            await request(app).delete(`${V1}/folders/binned`).set(auth()).expect(200);

            const missing = await request(app).post(`${V1}/trash/n/restore`).set(auth()).send({ folderId: 'nope' });
            expect(missing.status).toBe(400);
            expect(missing.body.code).toBe('FOLDER_NOT_FOUND');
            const intoTrash = await request(app).post(`${V1}/trash/n/restore`).set(auth()).send({ folderId: 'binned' });
            expect(intoTrash.status).toBe(400);
            expect(intoTrash.body.code).toBe('DESTINATION_IN_TRASH');
            const viaToolBad = await tool('restore_from_trash', { id: 'n', folder_id: 'binned' });
            expect(text(viaToolBad)).toContain('itself in Trash');

            const res = await request(app).post(`${V1}/trash/n/restore`).set(auth()).send({ folderId: 'dest' });
            expect(res.body).toMatchObject({ reason: 'requested', destination: { folderId: 'dest', path: 'Destination' } });
            const notInTrash = await tool('restore_from_trash', { id: 'n' });
            expect(text(notInTrash)).toContain('not in Trash');
            const binnedToRoot = await request(app).post(`${V1}/trash/binned/restore`).set(auth()).send({ folderId: 'root' });
            expect(binnedToRoot.body).toMatchObject({ reason: 'requested', destination: { folderId: null } });
        });

        it('a folder called Trash restores only into another folder', async () => {
            folder(db(), 'p', 'Projects');
            folder(db(), 't', 'Trash', 'p');
            await request(app).delete(`${V1}/folders/t`).set(auth()).expect(200);
            await request(app).delete(`${V1}/folders/p`).set(auth()).expect(200);
            const res = await request(app).post(`${V1}/trash/t/restore`).set(auth()).send({});
            expect(res.body.code).toBe('TRASH_NAME_RESERVED');
        });
    });

    describe('access', () => {
        it('a read key can read folders and Trash but not change them', async () => {
            folder(db(), 'f', 'Work');
            note(db(), 'n', 'Plan', 'f');
            await request(app).delete(`${V1}/documents/n`).set(auth()).expect(200);
            const { secret: readKey } = await createKey(app, user, { name: 'Reader', scope: 'read' });
            expect((await request(app).get(`${V1}/folders/f`).set(auth(readKey))).status).toBe(200);
            expect((await request(app).get(`${V1}/trash`).set(auth(readKey))).status).toBe(200);
            for (const call of [
                request(app).patch(`${V1}/folders/f`).set(auth(readKey)).send({ name: 'X' }),
                request(app).delete(`${V1}/folders/f`).set(auth(readKey)),
                request(app).post(`${V1}/trash/n/restore`).set(auth(readKey)).send({}),
            ]) {
                const res = await call;
                expect(res.status).toBe(403);
                expect(res.body.code).toBe('INSUFFICIENT_SCOPE');
            }
            for (const name of ['rename_folder', 'move_folder', 'move_folder_to_trash', 'restore_from_trash']) {
                const res = await tool(name, { id: 'f', name: 'X', parent_id: 'root' }, readKey);
                expect(res.body.result.isError, name).toBe(true);
                expect(text(res), name).toContain('read-only');
            }
            expect(folderOf(db(), 'n')).toBe(trashId(db()));
        });

        describe('spaces', () => {
            let spaceDb;
            beforeEach(() => {
                spaceId = createSpace({ actorUserId: user.userId, name: 'Team' }).spaceId;
                spaceDb = getDb(`space:${spaceId}`);
                folder(spaceDb, 's-f', 'Shared');
                note(spaceDb, 's-n', 'Shared plan', 's-f');
            });

            it('finds space folders by id alone, trashes and restores them, and lists their Trash', async () => {
                const read = await request(app).get(`${V1}/folders/s-f`).set(auth());
                expect(read.body.folder).toMatchObject({ space: spaceId, path: 'Shared' });

                const trashed = await request(app).delete(`${V1}/documents/s-n`).set(auth());
                expect(trashed.status).toBe(200);
                expect(spaceDb.prepare("SELECT user_id FROM folders WHERE name = 'Trash'").get().user_id).toBeNull();
                expect(origin(spaceDb, 's-n')).toMatchObject({ previous_parent_id: 's-f' });

                const all = await request(app).get(`${V1}/trash`).set(auth());
                expect(all.body.items).toEqual([expect.objectContaining({ id: 's-n', space: spaceId, spaceName: 'Team' })]);
                const personal = await request(app).get(`${V1}/trash?space=personal`).set(auth());
                expect(personal.body.items).toEqual([]);

                const restored = await request(app).post(`${V1}/trash/s-n/restore`).set(auth()).send({});
                expect(restored.body).toMatchObject({ reason: 'previous-location', destination: { folderId: 's-f' } });
                expect(restored.body.document.space).toBe(spaceId);
            });

            it('a live session blocks restoring its Document, but not moving its folder', async () => {
                await request(app).delete(`${V1}/documents/s-n`).set(auth()).expect(200);
                spaceDb.prepare(`INSERT INTO collab_sessions (note_id, session_id, ydoc_state, base_content, base_hash, started_at, updated_at)
                                 VALUES ('s-n', 'sess-1', x'00', 'x', 'h', '2026', '2026')`).run();
                const blocked = await request(app).post(`${V1}/trash/s-n/restore`).set(auth()).send({});
                expect(blocked.status).toBe(409);
                expect(blocked.body.code).toBe('DOCUMENT_IN_LIVE_SESSION');

                spaceDb.prepare("UPDATE notes SET folder_id = 's-f' WHERE id = 's-n'").run();
                const moved = await request(app).delete(`${V1}/folders/s-f`).set(auth());
                expect(moved.status).toBe(200);
                const back = await request(app).post(`${V1}/trash/s-f/restore`).set(auth()).send({});
                expect(back.status).toBe(200);
                expect(back.body.folder).toMatchObject({ parentId: null, inTrash: false });
            });

            it('a personal-only key cannot reach space folders or Trash', async () => {
                const { secret: personalKey } = await createKey(app, user, { name: 'Personal only', spaceAccess: 'personal' });
                const read = await request(app).get(`${V1}/folders/s-f`).set(auth(personalKey));
                expect(read.status).toBe(404);
                expect(read.body.code).toBe('FOLDER_NOT_FOUND');
                const explicit = await request(app).get(`${V1}/folders/s-f?space=${spaceId}`).set(auth(personalKey));
                expect(explicit.body.code).toBe('SPACE_NOT_FOUND');
                const trash = await request(app).get(`${V1}/trash?space=${spaceId}`).set(auth(personalKey));
                expect(trash.body.code).toBe('SPACE_NOT_FOUND');
                const restoreIt = await request(app).post(`${V1}/trash/s-n/restore`).set(auth(personalKey)).send({});
                expect(restoreIt.body.code).toBe('ITEM_NOT_FOUND');
                const moveIt = await request(app).patch(`${V1}/folders/s-f`).set(auth(personalKey)).send({ name: 'X' });
                expect(moveIt.status).toBe(404);
                expect(spaceDb.prepare("SELECT name FROM folders WHERE id = 's-f'").get().name).toBe('Shared');
            });
        });
    });
});
