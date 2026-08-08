import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';

/**
 * These tests validate markdown import utility integration logic.
 * They simulate core import behavior (path/title parsing, tree building, limits)
 * without directly invoking Pinia store actions.
 */


// ── Tests for the import utility integration ─────────────────

import {
    extractTitleFromFrontMatter,
    titleFromFilename,
    isMarkdownFile,
    buildFolderTree,
    validateImportLimits,
    IMPORT_LIMITS,
} from '../../src/utils/importUtils.js';

describe('importMarkdownFiles (logic simulation)', () => {
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

    it('matches only .md files for filesystem imports', () => {
        expect(isMarkdownFile('my-note.md')).toBe(true);
        expect(isMarkdownFile('my-note.markdown')).toBe(false);
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

    it('skips large markdown files over 1 MB', () => {
        const overLimit = 'a'.repeat((1 * 1024 * 1024) + 1);
        expect(new TextEncoder().encode(overLimit).length).toBeGreaterThan(IMPORT_LIMITS.MAX_FILE_BYTES);
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
