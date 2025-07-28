// /frontend/src/store/importExportStore.js
import { defineStore } from 'pinia';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useSyncStore } from './syncStore';
import { useDocStore } from './docStore';
import { useAuthStore } from './authStore';

export const useImportExportStore = defineStore('importExportStore', () => {
    const syncStore = useSyncStore();
    const docStore = useDocStore();

    /**
     * Exports all user data (folders, notes) from the local SQLite DB into a JSON string.
     */
    async function exportDataAsJsonString() {
        if (!syncStore.isInitialized) throw new Error('Sync not ready.');

        // CORRECTED: Results are arrays directly
        const folders = await syncStore.execute('SELECT * FROM folders');
        const notes = await syncStore.execute('SELECT * FROM notes');

        const data = {
            folders: folders || [],
            notes: notes || []
        };

        return JSON.stringify(data, null, 2);
    }

    /**
     * Exports all user data into a ZIP archive with a proper folder structure.
     */
    async function exportDataAsZip() {
        if (!syncStore.isInitialized) throw new Error('Sync not ready.');

        const zip = new JSZip();

        const { rows: folderRows } = await syncStore.execute('SELECT * FROM folders');
        const { rows: noteRows } = await syncStore.execute('SELECT * FROM notes');
        const folders = folderRows?._array || [];
        const notes = noteRows?._array || [];

        const folderMap = new Map(folders.map(f => [f.id, f]));

        // Create a path for each folder and note
        const paths = new Map();
        function getPath(itemId, isFolder) {
            if (paths.has(itemId)) return paths.get(itemId);

            const item = isFolder ? folderMap.get(itemId) : notes.find(n => n.id === itemId);
            if (!item) return '';

            const parentId = isFolder ? item.parent_id : item.folder_id;
            if (!parentId) return item.name || item.title;

            const parentPath = getPath(parentId, true);
            const path = `${parentPath}/${item.name || item.title}`;
            paths.set(itemId, path);
            return path;
        }

        // Add folders to zip
        for (const folder of folders) {
            const path = getPath(folder.id, true);
            zip.folder(path);
        }

        // Add notes to zip
        for (const note of notes) {
            const path = getPath(note.id, false);
            zip.file(`${path}.md`, note.content || '');
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, 'panino-export.zip');
    }

    /**
     * Exports all user data into a StackEdit-compatible JSON string.
     */
    async function exportDataAsStackEditJsonString() {
        if (!syncStore.isInitialized) throw new Error('Sync not ready.');

        const folders = await syncStore.execute('SELECT * FROM folders');
        const notes = await syncStore.execute('SELECT * FROM notes');

        const stackEditData = {};
        const now = Date.now();

        // Add folders
        (folders || []).forEach(folder => {
            stackEditData[folder.id] = {
                id: folder.id,
                type: 'folder',
                name: folder.name,
                parentId: folder.parent_id,
                hash: now,
                tx: now,
            };
        });

        // Add files and their content
        (notes || []).forEach(note => {
            // File entry
            stackEditData[note.id] = {
                id: note.id,
                type: 'file',
                name: note.title,
                parentId: note.folder_id,
                hash: now,
                tx: now,
            };
            // Content entry
            stackEditData[`${note.id}/content`] = {
                id: `${note.id}/content`,
                type: 'content',
                text: note.content || '',
                properties: '\n', // Default value from example
                discussions: {},
                comments: {},
                hash: now,
                tx: now,
            };
        });

        return JSON.stringify(stackEditData, null, 2);
    }

    /**
     * Imports data from a JSON object into the local SQLite database.
     */
    async function importData(data) {
        if (!syncStore.isInitialized) throw new Error('Sync not ready.');
        const authStore = useAuthStore();
        if (!authStore.user?.id) throw new Error("User is not authenticated for import.");

        // The `data` here refers to the standard Panino export format
        if (!data || !Array.isArray(data.folders) || !Array.isArray(data.notes)) {
            throw new Error('Invalid import data format. Expected { folders: [], notes: [] }');
        }

        // It's safer to clear existing data to avoid conflicts.
        await syncStore.execute('DELETE FROM notes');
        await syncStore.execute('DELETE FROM folders');

        try {
            await syncStore.db.value.exec('BEGIN TRANSACTION;');
            // Batch insert folders
            for (const folder of data.folders) {
                await syncStore.db.value.exec(
                    'INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)',
                    [folder.id, authStore.user.id, folder.name, folder.parent_id, folder.created_at]
                );
            }
            // Batch insert notes
            for (const note of data.notes) {
                await syncStore.db.value.exec(
                    'INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [note.id, authStore.user.id, note.folder_id, note.title, note.content, note.created_at, note.updated_at]
                );
            }
            await syncStore.db.value.exec('COMMIT;');
        } catch (e) {
            console.error('Import transaction failed, rolling back.', e);
            await syncStore.db.value.exec('ROLLBACK;');
            throw e; // Re-throw
        }

        // Trigger a refresh of the stores
        await docStore.loadInitialData();
        console.log('Import completed successfully.');
    }

    /**
     * Imports data from a StackEdit JSON object into the local SQLite database.
     */
    async function importStackEditData(data) {
        if (!syncStore.isInitialized) throw new Error('Sync not ready.');
        if (typeof data !== 'object' || data === null) {
            throw new Error('Invalid import data format. Expected a JSON object.');
        }

        const authStore = useAuthStore();
        if (!authStore.user?.id) throw new Error("User is not authenticated for import.");

        const files = [];
        const folders = [];
        const contents = new Map();

        // Segregate items by type
        for (const key in data) {
            const item = data[key];
            if (item.type === 'folder') {
                folders.push(item);
            } else if (item.type === 'file') {
                files.push(item);
            } else if (item.type === 'content') {
                const fileId = key.split('/')[0];
                contents.set(fileId, item.text);
            }
        }

        // Clear existing data to avoid conflicts.
        await syncStore.execute('DELETE FROM notes');
        await syncStore.execute('DELETE FROM folders');

        try {
            await syncStore.db.value.exec('BEGIN TRANSACTION;');
            // Batch insert folders
            for (const folder of folders) {
                await syncStore.db.value.exec(
                    'INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)',
                    [folder.id, authStore.user.id, folder.name, folder.parentId, new Date(folder.tx || Date.now()).toISOString()]
                );
            }
            // Batch insert notes (files) with their content
            for (const file of files) {
                await syncStore.db.value.exec(
                    'INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [file.id, authStore.user.id, file.parentId, file.name, contents.get(file.id) || '', new Date(file.tx || Date.now()).toISOString(), new Date(file.tx || Date.now()).toISOString()]
                );
            }
            await syncStore.db.value.exec('COMMIT;');
        } catch (e) {
            console.error('StackEdit import transaction failed, rolling back.', e);
            await syncStore.db.value.exec('ROLLBACK;');
            throw e; // Re-throw
        }

        console.log('StackEdit import completed successfully.');
    }

    return {
        exportDataAsJsonString,
        exportDataAsZip,
        importData,
        exportDataAsStackEditJsonString,
        importStackEditData,
    };
});