import { describe, expect, it } from 'vitest';
import { imageReaderFor, withoutPersonalImages } from '../../syncScheduler.js';

const IMAGE = '0f8fad5b-d9cb-469f-a165-70867728950e';
const SPACE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const USER = '16fd2706-8baf-433b-82eb-8c7fada847da';

describe('images in a space sync', () => {
    it('keeps an image the space owns, drops a personal one, and leaves other images alone', () => {
        const html = `<p><img src="/images/${IMAGE}?space=${SPACE}" alt="shared"></p>`
            + `<p><img alt="mine" src="/api/images/${IMAGE}"></p>`
            + '<p><img src="https://example.com/a.png"></p>';
        const out = withoutPersonalImages(html);
        expect(out).toContain(`?space=${SPACE}`);
        expect(out).not.toContain(`/api/images/${IMAGE}`);
        expect(out).toContain('<!-- image unavailable -->');
        expect(out).toContain('https://example.com/a.png');
    });

    it('never reads a personal image for a space, without even looking it up', () => {
        const read = imageReaderFor({ kind: 'space', id: SPACE }, USER);
        expect(read(`/images/${IMAGE}`)).toBeNull();
    });

    it('copes with nothing', () => {
        expect(withoutPersonalImages(undefined)).toBe('');
    });
});
