// Folder and Trash operations of the v1 API (docs/specs/active/ai-integration.md §7).
// Nothing here deletes: "trash" moves into the database's Trash folder.
import { v4 as uuidv4 } from 'uuid';
import {
    announce,
    assertFolder,
    assertNoLiveSession,
    fullDocument,
    locateDocument,
    notFound,
    readFolders,
    readNote,
    requireAgentScope,
    requireName,
    resolveOne,
    updateNote,
    writableDb,
} from './serviceCore.js';
import { buildFolderIndex, TRASH_FOLDER_NAME } from './keyUtils.js';

/** Move a Document into the database's Trash folder (created on first use). Nothing is deleted. */
export function trashDocument(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'write');
    const { target } = locateDocument(ctx, space, id);
    const db = writableDb(target, 'trash-document');
    const result = db.transaction(() => {
        const current = readNote(db, id);
        if (!current) throw notFound();
        assertNoLiveSession(db, target, current.id);
        const folderIndex = buildFolderIndex(readFolders(db));
        if (folderIndex.isInTrash(current.folder_id)) {
            return { row: current, previousFolderId: current.folder_id ?? null, alreadyInTrash: true };
        }
        let trashId = folderIndex.trashFolderId;
        if (!trashId) {
            trashId = uuidv4();
            const now = new Date().toISOString();
            if (target.kind === 'personal') {
                db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, NULL, ?)')
                    .run(trashId, ctx.userId, TRASH_FOLDER_NAME, now);
            } else {
                db.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, NULL, ?)')
                    .run(trashId, TRASH_FOLDER_NAME, now);
            }
        }
        const row = updateNote(db, current.id, { folder_id: trashId, updated_at: new Date().toISOString() });
        return { row, previousFolderId: current.folder_id ?? null, alreadyInTrash: false };
    })();
    if (!result.alreadyInTrash) announce(ctx, target);
    return {
        document: fullDocument(result.row, target, buildFolderIndex(readFolders(db))),
        previousFolderId: result.previousFolderId,
        alreadyInTrash: result.alreadyInTrash,
    };
}

/** Create a folder, at the top level or inside `parentId`. */
export function createFolder(ctx, { space, name, parentId } = {}) {
    requireAgentScope(ctx, 'write');
    const target = resolveOne(ctx, space);
    const folderName = requireName(name, 'folder name');
    const parent = parentId === undefined || parentId === '' || parentId === 'root' ? null : parentId;
    const db = writableDb(target, 'create-folder');
    const id = uuidv4();
    const now = new Date().toISOString();
    db.transaction(() => {
        assertFolder(db, parent, 'PARENT_NOT_FOUND');
        if (target.kind === 'personal') {
            db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(id, ctx.userId, folderName, parent, now);
        } else {
            db.prepare('INSERT INTO folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)')
                .run(id, folderName, parent, now);
        }
    })();
    announce(ctx, target);
    const folderIndex = buildFolderIndex(readFolders(db));
    return { folder: { id, name: folderName, parentId: parent, path: folderIndex.pathOf(id), space: target.spaceId } };
}
