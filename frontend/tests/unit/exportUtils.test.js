import { describe, it, expect } from 'vitest';
import { replaceImageReferences, base64ToBlob, blobToBase64 } from '../../src/utils/exportUtils.js';

describe('replaceImageReferences', () => {
    const buildUrl = (id) => `/api/images/${id}`;

    it('replaces a single image reference', () => {
        const oldId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const newId = 'f0f0f0f0-1111-2222-3333-444444444444';
        const content = `![alt text](/api/images/${oldId})`;
        const mapping = new Map([[oldId, newId]]);

        const result = replaceImageReferences(content, mapping, buildUrl);
        expect(result).toBe(`![alt text](/api/images/${newId})`);
    });

    it('replaces multiple different image references', () => {
        const old1 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        const new1 = '11111111-2222-3333-4444-555555555555';
        const old2 = 'ffffffff-0000-1111-2222-333333333333';
        const new2 = '66666666-7777-8888-9999-aaaaaaaaaaaa';
        const content = `![img1](/api/images/${old1})\nSome text\n![img2](http://localhost:8000/images/${old2})`;
        const mapping = new Map([[old1, new1], [old2, new2]]);

        const result = replaceImageReferences(content, mapping, buildUrl);
        expect(result).toContain(`/api/images/${new1}`);
        expect(result).toContain(`/api/images/${new2}`);
        expect(result).not.toContain(old1);
        expect(result).not.toContain(old2);
    });

    it('leaves unmatched image IDs unchanged', () => {
        const oldId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const unmatchedId = 'ffffffff-0000-1111-2222-333333333333';
        const content = `![alt](/api/images/${unmatchedId})`;
        const mapping = new Map([[oldId, 'new-id-here-0000-000000000000']]);

        const result = replaceImageReferences(content, mapping, buildUrl);
        expect(result).toBe(content);
    });

    it('returns content unchanged when mapping is empty', () => {
        const content = '![alt](/api/images/a1b2c3d4-e5f6-7890-abcd-ef1234567890)';
        const result = replaceImageReferences(content, new Map(), buildUrl);
        expect(result).toBe(content);
    });

    it('returns empty/null content unchanged', () => {
        expect(replaceImageReferences('', new Map(), buildUrl)).toBe('');
        expect(replaceImageReferences(null, new Map(), buildUrl)).toBe(null);
    });

    it('handles dev URLs with localhost prefix', () => {
        const oldId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const newId = 'f0f0f0f0-1111-2222-3333-444444444444';
        const content = `![screenshot](http://localhost:8000/images/${oldId})`;
        const mapping = new Map([[oldId, newId]]);

        const result = replaceImageReferences(content, mapping, buildUrl);
        expect(result).toContain(`/api/images/${newId}`);
    });

    it('handles image references embedded in longer markdown', () => {
        const oldId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const newId = 'f0f0f0f0-1111-2222-3333-444444444444';
        const content = `# Title\n\nSome text\n\n![photo](/api/images/${oldId})\n\nMore text`;
        const mapping = new Map([[oldId, newId]]);

        const result = replaceImageReferences(content, mapping, buildUrl);
        expect(result).toBe(`# Title\n\nSome text\n\n![photo](/api/images/${newId})\n\nMore text`);
    });
});

describe('base64ToBlob', () => {
    it('converts a data URL to a Blob with correct type', () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
        const blob = base64ToBlob(dataUrl);
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('image/png');
    });

    it('preserves binary data round-trip', () => {
        // A tiny valid base64 payload
        const payload = btoa('hello world');
        const dataUrl = `data:text/plain;base64,${payload}`;
        const blob = base64ToBlob(dataUrl);
        expect(blob.size).toBe(11); // 'hello world'.length
    });
});
