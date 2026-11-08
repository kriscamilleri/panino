// The pure Document metadata index (tag-system.md §7, advanced-search.md §6.3).
import { describe, expect, it } from 'vitest';
import {
    DocumentMetadataIndex,
    EMPTY_METADATA,
    FRONT_MATTER_SCAN_CHARS,
    readDocumentMetadata,
} from '@/utils/documentMetadataIndex';

const doc = (frontMatter, body = 'Body') => `---\n${frontMatter}\n---\n\n${body}`;

describe('readDocumentMetadata', () => {
    it('reads canonical tags with their spelling and unquoted properties', () => {
        const metadata = readDocumentMetadata(doc('title: "Plan"\nstatus: draft\ntags:\n  - Work\n  - urgent'));
        expect(metadata).toEqual({
            tags: ['work', 'urgent'],
            tagLabels: { work: 'Work', urgent: 'urgent' },
            properties: { title: 'Plan', status: 'draft' },
        });
        expect(Object.isFrozen(metadata.tags)).toBe(true);
    });

    it('is empty without front matter', () => {
        expect(readDocumentMetadata('# Just text')).toBe(EMPTY_METADATA);
        expect(readDocumentMetadata('')).toBe(EMPTY_METADATA);
        expect(readDocumentMetadata(null)).toBe(EMPTY_METADATA);
    });

    it('reads only the first 16 KB, as the API does', () => {
        const longBlock = `---\ntags: [a]\nnote: ${'x'.repeat(FRONT_MATTER_SCAN_CHARS)}\n---\n`;
        expect(readDocumentMetadata(longBlock)).toBe(EMPTY_METADATA);
        const body = 'y'.repeat(FRONT_MATTER_SCAN_CHARS * 4);
        expect(readDocumentMetadata(doc('tags: a', body)).tags).toEqual(['a']);
    });
});

describe('DocumentMetadataIndex', () => {
    function seeded() {
        const index = new DocumentMetadataIndex();
        index.set('a', doc('status: draft\ntags: [Work, urgent]'));
        index.set('b', doc('Status: final\ntags:\n  - work'));
        index.set('c', doc('status: draft\npriority: 2'));
        index.set('d', 'No front matter');
        return index;
    }

    it('answers entry, null for unknown and empty for a known plain Document', () => {
        const index = seeded();
        expect(index.entry('a').tags).toEqual(['work', 'urgent']);
        expect(index.entry('d')).toBe(EMPTY_METADATA);
        expect(index.entry('nope')).toBeNull();
    });

    it('finds Documents carrying every tag, canonicalising names', () => {
        const index = seeded();
        expect(index.idsWithTags(['work'])).toEqual(new Set(['a', 'b']));
        expect(index.idsWithTags([' WORK ', 'Urgent'])).toEqual(new Set(['a']));
        expect(index.idsWithTags(['work', 'missing'])).toEqual(new Set());
        expect(index.idsWithTags([])).toEqual(new Set());
        expect(index.idsWithTags([''])).toEqual(new Set());
    });

    it('counts tags and gives the most used spelling', () => {
        const index = seeded();
        expect(index.tagCounts()).toEqual(new Map([['work', 2], ['urgent', 1]]));
        index.set('e', doc('tags: [work]'));
        index.set('f', doc('tags: [work]'));
        expect(index.tagLabel('work')).toBe('work');
        expect(index.tagLabel('urgent')).toBe('urgent');
        expect(index.tagLabel('missing')).toBeNull();
    });

    it('lists property keys case-insensitively, most used first, and their values', () => {
        const index = seeded();
        expect(index.propertyKeys()).toEqual([
            { key: 'status', count: 3 },
            { key: 'priority', count: 1 },
            { key: 'tags', count: 1 },
        ]);
        expect(index.propertyValues('STATUS')).toEqual([
            { value: 'draft', count: 2 },
            { value: 'final', count: 1 },
        ]);
        expect(index.propertyValues('missing')).toEqual([]);
    });

    it('updates a changed Document and reports whether anything changed', () => {
        const index = seeded();
        expect(index.set('a', doc('status: draft\ntags: [Work, urgent]'))).toBe(false);
        expect(index.set('a', doc('status: final\ntags: [later]'))).toBe(true);
        expect(index.idsWithTags(['work'])).toEqual(new Set(['b']));
        expect(index.idsWithTags(['later'])).toEqual(new Set(['a']));
        expect(index.tagCounts().has('urgent')).toBe(false);
        expect(index.propertyValues('status')).toEqual([
            { value: 'final', count: 2 },
            { value: 'draft', count: 1 },
        ]);
    });

    it('forgets a removed Document everywhere', () => {
        const index = seeded();
        expect(index.remove('a')).toBe(true);
        expect(index.remove('d')).toBe(false);
        expect(index.entry('a')).toBeNull();
        expect(index.entry('d')).toBeNull();
        expect(index.idsWithTags(['urgent'])).toEqual(new Set());
        expect(index.propertyKeys().find((entry) => entry.key.toLowerCase() === 'status').count).toBe(2);
    });
});
