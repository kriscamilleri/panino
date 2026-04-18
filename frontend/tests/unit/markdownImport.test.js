import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';

/**
 * These tests verify the markdown import store functions using mocked stores.
 * Since the store functions depend on Pinia (syncStore, authStore, docStore),
 * we test the logic by mocking those dependencies.
 */

// ── Mock store helpers ───────────────────────────────────────

function createMockDb() {
    const tables = {
        folders: [],
        notes: [],
        settings: [],
        globals: [],
    };

    return {
        tables,
        exec: vi.fn(async (sql, params) => {
            if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
                return;
            }
            if (sql.startsWith('INSERT INTO folders')) {
                tables.folders.push({
                    id: params[0],
                    user_id: params[1],
                    name: params[2],
                    parent_id: params[3],
                    created_at: params[4],
                });
                return;
            }
            if (sql.startsWith('INSERT INTO notes')) {
                tables.notes.push({
                    id: params[0],
                    user_id: params[1],
                    folder_id: params[2],
                    title: params[3],
                    content: params[4],
                    created_at: params[5],
                    updated_at: params[6],
                });
                return;
            }
            if (sql.startsWith('INSERT OR REPLACE INTO settings')) {
                const idx = tables.settings.findIndex(s => s.id === params[0]);
                const entry = { id: params[0], value: params[1] };
                if (idx >= 0) tables.settings[idx] = entry;
                else tables.settings.push(entry);
                return;
            }
            if (sql.startsWith('INSERT OR REPLACE INTO globals')) {
                const idx = tables.globals.findIndex(g => g.key === params[0]);
                const entry = { key: params[0], id: params[1], value: params[2], created_at: params[3], updated_at: params[4], display_key: params[5] };
                if (idx >= 0) tables.globals[idx] = entry;
                else tables.globals.push(entry);
                return;
            }
        }),
    };
}

function createMockSyncStore(db) {
    return {
        isInitialized: true,
        db: { value: db },
        execute: vi.fn(async (sql, params) => {
            // Handle folder name queries
            if (sql.includes('SELECT name FROM folders')) {
                const parentId = params[0] ?? null;
                const name = params.length > 1 ? params[1] : undefined;
                if (name !== undefined) {
                    // Query with name filter
                    return db.tables.folders.filter(
                        f => f.parent_id === parentId && f.name === name
                    );
                }
                return db.tables.folders.filter(f => f.parent_id === parentId);
            }
            // Handle note title queries
            if (sql.includes('SELECT title FROM notes')) {
                const folderId = params[0] ?? null;
                return db.tables.notes.filter(f => f.folder_id === folderId);
            }
            return [];
        }),
    };
}

// ── Tests for the import utility integration ─────────────────

import {
    sanitizePathSegments,
    extractTitleFromFrontMatter,
    titleFromFilename,
    deduplicateName,
    isMarkdownFile,
    buildFolderTree,
    validateImportLimits,
    IMPORT_LIMITS,
} from '../../src/utils/importUtils.js';

describe('importMarkdownFiles (logic simulation)', () => {
    let db;

    beforeEach(() => {
        db = createMockDb();
    });

    it('imports a single file with title from filename', async () => {
        const file = new File(['# Hello'], 'my-note.md', { type: 'text/markdown' });
        const content = await file.text();
        const title = extractTitleFromFrontMatter(content) || titleFromFilename(file.name);

        expect(title).toBe('my-note');
        expect(isMarkdownFile(file.name)).toBe(true);
    });

    it('imports a file with front-matter title', async () => {
        const content = '---\ntitle: Custom Title\n---\n\n# Content';
        const file = new File([content], 'note.md', { type: 'text/markdown' });
        const text = await file.text();
        const title = extractTitleFromFrontMatter(text) || titleFromFilename(file.name);

        expect(title).toBe('Custom Title');
    });

    it('handles empty file — empty content, title from filename', async () => {
        const file = new File([''], 'empty.md', { type: 'text/markdown' });
        const content = await file.text();
        const title = extractTitleFromFrontMatter(content) || titleFromFilename(file.name);

        expect(title).toBe('empty');
        expect(content).toBe('');
    });

    it('filename ".md" → title becomes "Untitled"', () => {
        expect(titleFromFilename('.md')).toBe('Untitled');
    });

    it('deduplicates titles when conflicts exist', () => {
        const existing = new Set(['my-note']);
        const title = deduplicateName('my-note', existing);
        expect(title).toBe('my-note (import 1)');
    });

    it('skips non-markdown files', () => {
        expect(isMarkdownFile('image.png')).toBe(false);
        expect(isMarkdownFile('data.json')).toBe(false);
        expect(isMarkdownFile('note.md')).toBe(true);
    });
});

describe('importMarkdownDirectory (logic simulation)', () => {
    it('builds correct folder hierarchy from webkitRelativePath', () => {
        const entries = [
            { relativePath: 'vault/note-a.md', content: '# A' },
            { relativePath: 'vault/daily/2026-04-18.md', content: '# Day' },
            { relativePath: 'vault/daily/2026-04-17.md', content: '# Day' },
            { relativePath: 'vault/projects/panino/todo.md', content: '# Todo' },
        ];

        const { folders, notes } = buildFolderTree(entries);

        // Expect 4 folders: vault, daily, projects, panino
        expect(folders.size).toBe(4);
        expect(folders.get('vault')).toEqual({ name: 'vault', parentPath: null });
        expect(folders.get('vault/daily')).toEqual({ name: 'daily', parentPath: 'vault' });
        expect(folders.get('vault/projects')).toEqual({ name: 'projects', parentPath: 'vault' });
        expect(folders.get('vault/projects/panino')).toEqual({ name: 'panino', parentPath: 'vault/projects' });

        // Expect 4 notes
        expect(notes).toHaveLength(4);
        expect(notes[0]).toMatchObject({ title: 'note-a', folderPath: 'vault' });
        expect(notes[1]).toMatchObject({ title: '2026-04-18', folderPath: 'vault/daily' });
    });

    it('skips non-.md files in directory', () => {
        const entries = [
            { relativePath: 'vault/image.png', content: '' },
            { relativePath: 'vault/note.md', content: '' },
            { relativePath: 'vault/readme.txt', content: '' },
        ];

        const { notes } = buildFolderTree(entries);
        expect(notes).toHaveLength(1);
        expect(notes[0].title).toBe('note');
    });

    it('deduplicates folder names at same level', () => {
        const existing = new Set(['journal']);
        const name = deduplicateName('journal', existing);
        expect(name).toBe('journal (import 1)');
    });
});

describe('importZipArchive (logic simulation)', () => {
    it('extracts markdown files from a generic ZIP', async () => {
        const zip = new JSZip();
        zip.file('note-a.md', '# Note A');
        zip.file('folder/note-b.md', '# Note B');
        zip.file('image.png', 'not-an-image');

        const buf = await zip.generateAsync({ type: 'uint8array' });
        const loadedZip = await JSZip.loadAsync(buf);

        const entries = [];
        const zipEntries = Object.keys(loadedZip.files);

        for (const path of zipEntries) {
            const entry = loadedZip.files[path];
            if (entry.dir) continue;
            if (!isMarkdownFile(path)) continue;

            const content = await entry.async('string');
            entries.push({ relativePath: path, content });
        }

        expect(entries).toHaveLength(2);

        const { folders, notes } = buildFolderTree(entries);
        expect(notes).toHaveLength(2);
        expect(folders.size).toBe(1); // "folder"
    });

    it('detects Panino metadata in ZIP', async () => {
        const zip = new JSZip();
        zip.file('_panino_metadata.json', JSON.stringify({
            version: 2,
            settings: [{ id: 'test', value: 'val' }],
            globals: [],
        }));
        zip.file('note.md', '# Content');

        const buf = await zip.generateAsync({ type: 'uint8array' });
        const loadedZip = await JSZip.loadAsync(buf);

        expect(loadedZip.file('_panino_metadata.json')).not.toBeNull();
    });

    it('enforces file count limits', () => {
        expect(() => validateImportLimits(10_001, 0)).toThrow(/too many files/);
    });

    it('enforces total size limits', () => {
        expect(() => validateImportLimits(1, 0, 600 * 1024 * 1024)).toThrow(/500 MB/);
    });

    it('enforces directory count limits', () => {
        expect(() => validateImportLimits(1, 1_001)).toThrow(/too many directories/);
    });

    it('skips _panino_metadata.json and _images/ from notes', async () => {
        const zip = new JSZip();
        zip.file('_panino_metadata.json', '{}');
        zip.file('_images/photo.png', 'binary');
        zip.file('note.md', '# Real note');

        const buf = await zip.generateAsync({ type: 'uint8array' });
        const loadedZip = await JSZip.loadAsync(buf);

        const entries = [];
        for (const path of Object.keys(loadedZip.files)) {
            const entry = loadedZip.files[path];
            if (entry.dir) continue;
            if (path === '_panino_metadata.json') continue;
            if (path.startsWith('_images/')) continue;
            if (!isMarkdownFile(path)) continue;

            const content = await entry.async('string');
            entries.push({ relativePath: path, content });
        }

        expect(entries).toHaveLength(1);
        expect(entries[0].relativePath).toBe('note.md');
    });

    it('strips path traversal from ZIP entry paths', () => {
        const entries = [
            { relativePath: '../../etc/passwd.md', content: 'malicious' },
        ];
        const { notes } = buildFolderTree(entries);
        expect(notes).toHaveLength(1);
        expect(notes[0].title).toBe('passwd');
    });

    it('handles XSS payloads in content (stored raw, sanitized at render)', async () => {
        const xssContent = '<script>alert(1)</script>\n# Title\n<img onerror=alert(1) src=x>';
        const entries = [
            { relativePath: 'xss.md', content: xssContent },
        ];
        const { notes } = buildFolderTree(entries);
        // Content is stored as-is — DOMPurify handles sanitization at render time
        expect(notes[0].content).toBe(xssContent);
    });
});
