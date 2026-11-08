/**
 * Which folder is Trash, and walks over a database's folder tree (docs/specs/active/
 * advanced-search.md §4, §6.1). The app and the AI agents add-on decide with these functions
 * which Documents are in Trash, which folders a path such as `in:Projects/2026` names, and
 * which folders sit below one, so search leaves out and includes the same Documents in both.
 *
 * Folders are rows `{ id, name, parent_id, created_at }`. Every walk stops at a cycle (corrupted
 * data) instead of looping, and is linear in the number of folders.
 */

/** Name of the folder API deletes move Documents into. */
export const TRASH_FOLDER_NAME = 'Trash';

/**
 * @typedef {{ id: string, name: string|null, parent_id: string|null, created_at?: string|null }} FolderRow
 */

function folderKey(name) {
    return String(name || '').trim().toLowerCase();
}

/**
 * The oldest root folder named "Trash" (any case, surrounding spaces ignored), or null.
 * @param {FolderRow[]} folders
 * @returns {string|null}
 */
export function findTrashFolderId(folders) {
    const candidates = folders
        .filter((folder) => !folder.parent_id && folderKey(folder.name) === 'trash')
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id));
    return candidates[0]?.id ?? null;
}

function childrenByParent(folders) {
    const children = new Map();
    for (const folder of folders) {
        const parent = folder.parent_id ?? null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(folder);
    }
    return children;
}

/**
 * The ids of the given folders and every folder below them.
 * @param {FolderRow[]} folders
 * @param {Iterable<string>} rootIds
 * @returns {Set<string>}
 */
export function folderSubtree(folders, rootIds) {
    const children = childrenByParent(folders);
    const ids = new Set();
    const queue = [];
    for (const id of rootIds) {
        if (id && !ids.has(id)) { ids.add(id); queue.push(id); }
    }
    for (let head = 0; head < queue.length; head += 1) {
        for (const child of children.get(queue[head]) || []) {
            if (ids.has(child.id)) continue;
            ids.add(child.id);
            queue.push(child.id);
        }
    }
    return ids;
}

/**
 * The ids of the Trash folder and every folder inside it; empty when there is no Trash.
 * @param {FolderRow[]} folders
 * @returns {string[]}
 */
export function trashFolderIds(folders) {
    const trash = findTrashFolderId(folders);
    return trash ? [...folderSubtree(folders, [trash])] : [];
}

/**
 * The folders a path names, matched from the top level down, one name per segment, ignoring
 * case and surrounding spaces. Several folders can share a path; all of them are returned.
 * @param {FolderRow[]} folders
 * @param {string[]} segments
 * @returns {string[]} folder ids
 */
export function findFoldersByPath(folders, segments) {
    if (!segments.length) return [];
    const children = childrenByParent(folders);
    let level = (children.get(null) || []).filter((folder) => folderKey(folder.name) === folderKey(segments[0]));
    const seen = new Set(level.map((folder) => folder.id));
    for (let depth = 1; depth < segments.length && level.length; depth += 1) {
        const wanted = folderKey(segments[depth]);
        const next = [];
        for (const folder of level) {
            for (const child of children.get(folder.id) || []) {
                if (seen.has(child.id) || folderKey(child.name) !== wanted) continue;
                seen.add(child.id);
                next.push(child);
            }
        }
        level = next;
    }
    return level.map((folder) => folder.id);
}

/**
 * Lookups over a database's folders: each folder's slash-joined path from the root, its path
 * as a list of names, and whether it is inside the root "Trash" folder.
 * @param {FolderRow[]} folders
 * @returns {{ pathOf: (folderId: string|null) => string, segmentsOf: (folderId: string|null) => string[],
 *   trashFolderId: string|null, isInTrash: (folderId: string|null) => boolean }}
 */
export function buildFolderIndex(folders) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const segmentCache = new Map();

    function chain(folderId) {
        const seen = new Set();
        const out = [];
        let current = folderId ? byId.get(folderId) : null;
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            out.push(current);
            current = current.parent_id ? byId.get(current.parent_id) : null;
        }
        return out;
    }

    function segmentsOf(folderId) {
        if (!folderId) return [];
        if (!segmentCache.has(folderId)) {
            segmentCache.set(folderId, chain(folderId).reverse().map((folder) => folder.name || 'Untitled'));
        }
        return segmentCache.get(folderId);
    }

    const trashFolderId = findTrashFolderId(folders);

    return {
        pathOf(folderId) {
            return segmentsOf(folderId).join('/');
        },
        segmentsOf,
        trashFolderId,
        isInTrash(folderId) {
            if (!trashFolderId || !folderId) return false;
            return chain(folderId).some((folder) => folder.id === trashFolderId);
        },
    };
}
