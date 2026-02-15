// /frontend/src/store/importExportStore.js
import { defineStore } from 'pinia';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useSyncStore } from './syncStore';
import { useDocStore } from './docStore';
import { useAuthStore } from './authStore';
import { useGlobalVariablesStore } from './globalVariablesStore';
import { useMarkdownStore } from './markdownStore';
import { useUiStore } from './uiStore';
import { replaceImageReferences, blobToBase64, base64ToBlob } from '../utils/exportUtils';

const API_URL = import.meta.env.VITE_API_SERVICE_URL || '';
const IS_PRODUCTION = import.meta.env.PROD;

/** Build the correct image URL for the current environment. */
function buildImageUrl(imageId) {
    return IS_PRODUCTION ? `/api/images/${imageId}` : `${API_URL}/images/${imageId}`;
}

/**
 * Fetch all images from the server as { id, filename, mime_type, created_at, data }.
 * `data` is a base64 data-URL. Images that fail to download are silently skipped.
 */
async function fetchAllImageData(images, token) {
    const results = [];
    for (const img of images) {
        try {
            const url = buildImageUrl(img.id);
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) continue;
            const blob = await response.blob();
            results.push({
                id: img.id,
                filename: img.filename,
                mime_type: img.mime_type,
                created_at: img.created_at,
                data: await blobToBase64(blob),
            });
        } catch (err) {
            console.warn(`[export] Failed to fetch image ${img.id}:`, err);
        }
    }
    return results;
}

export const useImportExportStore = defineStore('importExportStore', () => {
    const syncStore = useSyncStore();
    const docStore = useDocStore();

    // ─── helpers ──────────────────────────────────────────────

    /** Query all core tables needed for a full export. */
    async function queryAllData() {
        const [folders, notes, images, settings, globals] = await Promise.all([
            syncStore.execute('SELECT * FROM folders'),
            syncStore.execute('SELECT * FROM notes'),
            syncStore.execute('SELECT * FROM images'),
            syncStore.execute('SELECT * FROM settings'),
            syncStore.execute('SELECT * FROM globals'),
        ]);
        return {
            folders: folders || [],
            notes: notes || [],
            images: images || [],
            settings: settings || [],
            globals: globals || [],
        };
    }

    // ─── JSON export ─────────────────────────────────────────

    /**
     * Exports all user data (folders, notes, images, settings, globals)
     * from the local SQLite DB into a JSON string.
     */
    async function exportDataAsJsonString() {
        if (!syncStore.isInitialized) throw new Error('Sync not ready.');
        const authStore = useAuthStore();
        const { folders, notes, images, settings, globals } = await queryAllData();

        let imageData = [];
        if (authStore.isAuthenticated && images.length) {
            imageData = await fetchAllImageData(images, authStore.token);
        }

        const data = {
            version: 2,
            folders,
            notes,
            images: imageData,
            settings,
            globals,
        };

        return JSON.stringify(data, null, 2);
    }

    // ─── ZIP export ──────────────────────────────────────────

    /**
     * Exports all user data into a ZIP archive with a proper folder structure,
     * plus an `_images/` directory and `_panino_metadata.json` for settings/globals.
     */
    async function exportDataAsZip() {
        if (!syncStore.isInitialized) throw new Error('Sync not ready.');
        const authStore = useAuthStore();

        const zip = new JSZip();

        const { folders, notes, images, settings, globals } = await queryAllData();

        const folderMap = new Map(folders.map(f => [f.id, f]));

        // Create a path for each folder and note
        const paths = new Map();
        function getPath(itemId, isFolder) {
            if (paths.has(itemId)) return paths.get(itemId);

            const item = isFolder ? folderMap.get(itemId) : notes.find(n => n.id === itemId);
            if (!item) return '';

            // Sanitize names to prevent invalid paths
            const saneName = (item.name || item.title || "Untitled").replace(/[\/\\?%*:|"<>]/g, '_');

            const parentId = isFolder ? item.parent_id : item.folder_id;
            if (!parentId) {
                paths.set(itemId, saneName);
                return saneName;
            }

            const parentPath = getPath(parentId, true);
            const path = `${parentPath}/${saneName}`;
            paths.set(itemId, path);
            return path;
        }

        // Add folders to zip
        for (const folder of folders) {
            const path = getPath(folder.id, true);
            if (path) {
                zip.folder(path);
            }
        }

        // Add notes to zip
        for (const note of notes) {
            const path = getPath(note.id, false);
            if (path) {
                zip.file(`${path}.md`, note.content || '');
            }
        }

        // Add images to zip
        const imageMetadata = [];
        if (authStore.isAuthenticated && images.length) {
            const imgFolder = zip.folder('_images');
            for (const img of images) {
                try {
                    const url = buildImageUrl(img.id);
                    const response = await fetch(url, {
                        headers: { 'Authorization': `Bearer ${authStore.token}` }
                    });
                    if (!response.ok) continue;
                    const blob = await response.blob();
                    const ext = (img.filename || '').split('.').pop() || 'bin';
                    const zipFilename = `${img.id}.${ext}`;
                    imgFolder.file(zipFilename, blob);
                    imageMetadata.push({
                        id: img.id,
                        filename: img.filename,
                        mime_type: img.mime_type,
                        created_at: img.created_at,
                        zipPath: `_images/${zipFilename}`,
                    });
                } catch (err) {
                    console.warn(`[export] Failed to fetch image ${img.id} for ZIP:`, err);
                }
            }
        }

        // Add metadata file
        zip.file('_panino_metadata.json', JSON.stringify({
            version: 2,
            settings,
            globals,
            images: imageMetadata,
        }, null, 2));

        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, 'panino-export.zip');
    }

    // ─── StackEdit export ────────────────────────────────────

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

    // ─── JSON import ─────────────────────────────────────────

    /**
     * Upload an image from an export entry and return { oldId, newId }.
     * Returns null if the upload fails.
     */
    async function uploadImageFromExport(imageEntry, token) {
        try {
            const blob = base64ToBlob(imageEntry.data);
            const file = new File([blob], imageEntry.filename || 'image.png', {
                type: imageEntry.mime_type || 'application/octet-stream',
            });
            const formData = new FormData();
            formData.append('image', file);

            const uploadUrl = IS_PRODUCTION ? '/api/images' : `${API_URL}/images`;
            const response = await fetch(uploadUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });
            if (!response.ok) return null;
            const result = await response.json();
            return { oldId: imageEntry.id, newId: result.id };
        } catch (err) {
            console.warn(`[import] Failed to upload image ${imageEntry.id}:`, err);
            return null;
        }
    }

    /**
     * Imports data from a JSON object into the local SQLite database.
     * Supports both v1 (folders + notes only) and v2 (with images, settings, globals).
     */
    async function importData(data) {
        if (!syncStore.isInitialized) throw new Error('Sync not ready.');
        const authStore = useAuthStore();
        if (!authStore.user?.id) throw new Error("User is not authenticated for import.");

        if (!data || !Array.isArray(data.folders) || !Array.isArray(data.notes)) {
            throw new Error('Invalid import data format. Expected { folders: [], notes: [] }');
        }

        const hasImages = Array.isArray(data.images) && data.images.length > 0;
        const hasSettings = Array.isArray(data.settings) && data.settings.length > 0;
        const hasGlobals = Array.isArray(data.globals) && data.globals.length > 0;

        // ── Re-upload images first (before we insert notes) ──
        const idMapping = new Map(); // old image ID → new image ID
        if (hasImages && authStore.isAuthenticated) {
            for (const imgEntry of data.images) {
                if (!imgEntry.data) continue; // skip entries without image data
                const result = await uploadImageFromExport(imgEntry, authStore.token);
                if (result) {
                    idMapping.set(result.oldId, result.newId);
                }
            }
        }

        // ── Remap image references in note content ──
        const remappedNotes = data.notes.map(note => {
            if (idMapping.size === 0 || !note.content) return note;
            return { ...note, content: replaceImageReferences(note.content, idMapping, buildImageUrl) };
        });

        // ── Clear existing data ──
        await syncStore.execute('DELETE FROM notes');
        await syncStore.execute('DELETE FROM folders');

        try {
            await syncStore.db.value.exec('BEGIN TRANSACTION;');

            // Insert folders
            for (const folder of data.folders) {
                await syncStore.db.value.exec(
                    'INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)',
                    [folder.id, authStore.user.id, folder.name, folder.parent_id, folder.created_at]
                );
            }

            // Insert notes (with remapped image URLs)
            for (const note of remappedNotes) {
                await syncStore.db.value.exec(
                    'INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [note.id, authStore.user.id, note.folder_id, note.title, note.content, note.created_at, note.updated_at]
                );
            }

            // Insert settings (replace existing)
            if (hasSettings) {
                await syncStore.db.value.exec('DELETE FROM settings;');
                for (const setting of data.settings) {
                    await syncStore.db.value.exec(
                        'INSERT INTO settings (id, value) VALUES (?, ?)',
                        [setting.id, setting.value]
                    );
                }
            }

            // Insert globals (replace existing)
            if (hasGlobals) {
                await syncStore.db.value.exec('DELETE FROM globals;');
                for (const g of data.globals) {
                    await syncStore.db.value.exec(
                        'INSERT INTO globals (key, id, value, created_at, updated_at, display_key) VALUES (?, ?, ?, ?, ?, ?)',
                        [g.key, g.id || '', g.value || '', g.created_at || new Date().toISOString(), g.updated_at || new Date().toISOString(), g.display_key || g.key]
                    );
                }
            }

            await syncStore.db.value.exec('COMMIT;');
        } catch (e) {
            console.error('Import transaction failed, rolling back.', e);
            await syncStore.db.value.exec('ROLLBACK;');
            throw e;
        }

        // Refresh all dependent stores
        await docStore.loadInitialData();
        const globalVariablesStore = useGlobalVariablesStore();
        await globalVariablesStore.loadGlobals();
        if (hasSettings) {
            const markdownStore = useMarkdownStore();
            const uiStore = useUiStore();
            await markdownStore.loadStylesFromDB();
            await uiStore.loadSettingsFromDB();
        }
        console.log('Import completed successfully.');
    }

    // ─── StackEdit import ────────────────────────────────────

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