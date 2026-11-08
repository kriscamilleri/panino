/**
 * Pure helpers behind the sidebar tag filter (docs/specs/active/tag-system.md
 * §5.2): which folders are Trash, and a folder's path.
 *
 * The Trash rule is the API's (`findTrashFolderId` in the AI add-on's
 * `keyUtils.js`) and the search spec's (§4): the oldest top-level folder named
 * "Trash", ignoring case and surrounding white space, and everything below it.
 * Search moves that rule to `shared/trashFolder.js`; once it is there, this
 * should call it, so the filter bar and `tag:` cannot disagree.
 */

/**
 * @typedef {{ id: string, name?: string|null, parent_id?: string|null, created_at?: string|null }} FolderRow
 */

/**
 * The id of the database's Trash folder, or null.
 * @param {FolderRow[]} folders
 * @returns {string|null}
 */
export function trashFolderId(folders) {
    const candidates = (folders || [])
        .filter((folder) => !folder.parent_id && String(folder.name || '').trim().toLowerCase() === 'trash')
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))
            || String(a.id).localeCompare(String(b.id)));
    return candidates[0]?.id ?? null;
}

/**
 * The Trash folder and every folder below it.
 * @param {FolderRow[]} folders
 * @returns {Set<string>}
 */
export function trashFolderIds(folders) {
    const root = trashFolderId(folders);
    const ids = new Set();
    if (!root) return ids;
    const children = new Map();
    for (const folder of folders) {
        if (!folder.parent_id) continue;
        if (!children.has(folder.parent_id)) children.set(folder.parent_id, []);
        children.get(folder.parent_id).push(folder.id);
    }
    const queue = [root];
    while (queue.length) {
        const id = queue.pop();
        if (ids.has(id)) continue;
        ids.add(id);
        for (const child of children.get(id) || []) queue.push(child);
    }
    return ids;
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
