import { describe, it, expect } from 'vitest';
import { normalizeRecentDocument } from '../../src/utils/recentDocuments.js';

describe('normalizeRecentDocument', () => {
    it('maps title, folder, date, excerpt, and word count', () => {
        const row = {
            id: 'note-1',
            title: '  Project Plan  ',
            folderPath: 'Work / Planning',
            updated_at: '2026-02-15T10:00:00.000Z',
            created_at: '2026-02-14T10:00:00.000Z',
            content: 'First paragraph with several words.',
        };

        const result = normalizeRecentDocument(row);

        expect(result).toEqual({
            id: 'note-1',
            type: 'file',
            name: 'Project Plan',
            folderName: 'Work / Planning',
            displayedDate: '2026-02-15T10:00:00.000Z',
            excerpt: 'First paragraph with several words.',
            wordCount: 5,
        });
    });

    it('falls back for empty title and folder', () => {
        const row = {
            id: 'note-2',
            title: '   ',
            folderName: '   ',
            updated_at: '',
            created_at: '2026-02-14T10:00:00.000Z',
            content: '',
        };

        const result = normalizeRecentDocument(row);

        expect(result.type).toBe('file');
        expect(result.name).toBe('Untitled');
        expect(result.folderName).toBe('Root');
        expect(result.displayedDate).toBe('2026-02-14T10:00:00.000Z');
        expect(result.excerpt).toBe('');
        expect(result.wordCount).toBe(0);
    });

    it('truncates long excerpts to 120 characters with ellipsis', () => {
        const longText = 'a'.repeat(140);
        const result = normalizeRecentDocument({
            id: 'note-3',
            title: 'Long',
            folderName: 'Notes',
            content: longText,
        });

        expect(result.excerpt.length).toBe(120);
        expect(result.excerpt.endsWith('…')).toBe(true);
    });
});
