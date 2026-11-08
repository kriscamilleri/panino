// Which folder is Trash and the folder walks behind `in:` (docs/specs/active/advanced-search.md
// §4, §6.1), shared by the app's search and the API's.
import { describe, expect, it } from 'vitest';
import {
    buildFolderIndex,
    findFoldersByPath,
    findTrashFolderId,
    folderSubtree,
    trashFolderIds,
} from '../trashFolder.js';
import { resolveFolderScope } from '../documentSearch.js';

const folder = (id, name, parentId = null, createdAt = '2026-01-01T00:00:00.000Z') => ({ id, name, parent_id: parentId, created_at: createdAt });

describe('findTrashFolderId', () => {
    it('ignores case and surrounding spaces', () => {
        expect(findTrashFolderId([folder('t', '  tRaSh ')])).toBe('t');
        expect(findTrashFolderId([folder('x', 'Trashcan')])).toBeNull();
    });

    it('takes the oldest of two root folders named Trash', () => {
        expect(findTrashFolderId([
            folder('new', 'Trash', null, '2026-02-01T00:00:00.000Z'),
            folder('old', 'trash', null, '2026-01-01T00:00:00.000Z'),
        ])).toBe('old');
    });

    it('does not take a nested folder named Trash', () => {
        expect(findTrashFolderId([folder('p', 'Projects'), folder('t', 'Trash', 'p')])).toBeNull();
    });
});

describe('folder walks', () => {
    const folders = [
        folder('trash', 'Trash'), folder('old', 'Old', 'trash'), folder('older', 'Older', 'old'),
        folder('p', 'Projects'), folder('y', '2026', 'p'), folder('q', 'Q1', 'y'),
        folder('p2', 'projects '), folder('y2', '2026', 'p2'),
        // A cycle in corrupted data stops the walks.
        folder('c1', 'Loop', 'c2'), folder('c2', 'Loop', 'c1'),
    ];

    it('collects a subtree and the Trash subtree', () => {
        expect([...folderSubtree(folders, ['p'])].sort()).toEqual(['p', 'q', 'y']);
        expect([...folderSubtree(folders, ['c1'])].sort()).toEqual(['c1', 'c2']);
        expect(trashFolderIds(folders).sort()).toEqual(['old', 'older', 'trash']);
        expect(trashFolderIds([folder('p', 'Projects')])).toEqual([]);
    });

    it('finds every folder a path names, from the top level, ignoring case', () => {
        expect(findFoldersByPath(folders, ['PROJECTS', '2026']).sort()).toEqual(['y', 'y2']);
        expect(findFoldersByPath(folders, ['2026'])).toEqual([]);
        expect(findFoldersByPath(folders, [])).toEqual([]);
    });

    it('builds paths and tells what is in Trash', () => {
        const index = buildFolderIndex(folders);
        expect(index.pathOf('q')).toBe('Projects/2026/Q1');
        expect(index.segmentsOf('q')).toEqual(['Projects', '2026', 'Q1']);
        expect(index.isInTrash('older')).toBe(true);
        expect(index.isInTrash('q')).toBe(false);
        expect(index.pathOf(null)).toBe('');
    });

    it('resolves in: parts and leaves Trash out unless one names it', () => {
        const part = (path, negated = false) => ({ type: 'in', path, negated });
        const plain = resolveFolderScope(folders, []);
        expect(plain.exclude.sort()).toEqual(['old', 'older', 'trash']);
        const inTrash = resolveFolderScope(folders, [part(['Trash'])]);
        expect(inTrash.trashIncluded).toBe(true);
        expect(inTrash.exclude).toEqual([]);
        expect(inTrash.include[0].sort()).toEqual(['old', 'older', 'trash']);
        const space = resolveFolderScope(folders, [part(['Acme Team'])], ['Acme Team']);
        expect(space).toMatchObject({ skip: false, include: [], resolved: [true] });
        const spacePath = resolveFolderScope(folders, [part(['acme team', 'Projects'])], ['Acme Team']);
        // Both folders named "Projects" (one with a trailing space) are that path.
        expect(spacePath.include[0].sort()).toEqual(['p', 'p2', 'q', 'y', 'y2']);
        expect(resolveFolderScope(folders, [part(['Nowhere'])])).toMatchObject({ skip: true, resolved: [false] });
        expect(resolveFolderScope(folders, [part(['Acme Team'], true)], ['Acme Team']).skip).toBe(true);
        const without = resolveFolderScope(folders, [part(['Projects'], true)]);
        expect(without.exclude).toEqual(expect.arrayContaining(['p', 'y', 'q', 'trash']));
        expect(resolveFolderScope(folders, [], [], { includeTrash: true }).exclude).toEqual([]);
    });
});
