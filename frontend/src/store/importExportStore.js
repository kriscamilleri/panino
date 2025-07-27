// /frontend/src/store/importExportStore.js
import { defineStore } from 'pinia';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useSyncStore } from './syncStore';
import { useDocStore } from './docStore';

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
     * Imports data from a JSON object into the local SQLite database.
     */
    async function importData(data) {
        if (!syncStore.isInitialized) throw new Error('Sync not ready.');
        if (!data || !Array.isArray(data.folders) || !Array.isArray(data.notes)) {
            throw new Error('Invalid import data format. Expected { folders: [], notes: [] }');
        }

        // It's safer to clear existing data to avoid conflicts.
        await syncStore.execute('DELETE FROM notes');
        await syncStore.execute('DELETE FROM folders');

        await syncStore.powerSync.writeTransaction(async (tx) => {
            // Batch insert folders
            for (const folder of data.folders) {
                await tx.executeAsync(
                    'INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)',
                    [folder.id, folder.user_id, folder.name, folder.parent_id, folder.created_at]
                );
            }
            // Batch insert notes
            for (const note of data.notes) {
                await tx.executeAsync(
                    'INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [note.id, note.user_id, note.folder_id, note.title, note.content, note.created_at, note.updated_at]
                );
            }
        });

        // Trigger a refresh of the stores
        await docStore.loadInitialData();
        console.log('Import completed successfully.');
    }

    return {
        exportDataAsJsonString,
        exportDataAsZip,
        importData,
    };
});