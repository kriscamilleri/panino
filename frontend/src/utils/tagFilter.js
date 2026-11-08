/**
 * Pure helpers behind the sidebar tag filter (docs/specs/active/tag-system.md
 * §5.2): which folders are Trash, and a folder's path.
 *
 * The Trash rule is the API's (`findTrashFolderId` in the AI add-on's
 * `keyUtils.js`) and the search spec's (§4): the oldest top-level folder named
 * "Trash", ignoring case and surrounding white space, and everything below it.
 * It lives in `shared/trashFolder.js`, so the filter bar, search's `tag:` and
 * the API cannot disagree.
 */

import { findTrashFolderId, trashFolderIds as sharedTrashFolderIds } from '@panino/content-merge/trash-folder';

/**
 * @typedef {{ id: string, name?: string|null, parent_id?: string|null, created_at?: string|null }} FolderRow
 */

/**
 * The id of the database's Trash folder, or null: the shared rule
 * (`shared/trashFolder.js`) that search and the API use.
 * @param {FolderRow[]} folders
 * @returns {string|null}
 */
export function trashFolderId(folders) {
    return findTrashFolderId(folders || []);
}

/**
 * The Trash folder and every folder below it (shared rule).
 * @param {FolderRow[]} folders
 * @returns {Set<string>}
 */
export function trashFolderIds(folders) {
    return new Set(sharedTrashFolderIds(folders || []));
}

/**
 * A function giving each folder's path from the root (`Projects / 2026`), or
 * an empty string for no folder. A cycle or a missing parent ends the path.
 * @param {FolderRow[]} folders
 * @returns {(folderId: string|null|undefined) => string}
 */
export function folderPaths(folders) {
    const byId = new Map((folders || []).map((folder) => [folder.id, folder]));
    const cache = new Map();
    return (folderId) => {
        if (!folderId) return '';
        if (cache.has(folderId)) return cache.get(folderId);
        const names = [];
        const seen = new Set();
        let current = byId.get(folderId);
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            names.unshift(current.name || 'Untitled');
            current = current.parent_id ? byId.get(current.parent_id) : null;
        }
        const path = names.join(' / ');
        cache.set(folderId, path);
        return path;
    };
}
