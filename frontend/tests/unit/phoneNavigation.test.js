// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isListPath, goUp } from '@/utils/phoneNavigation';

describe('phoneNavigation', () => {
    afterEach(() => window.history.replaceState(null, ''));

    it('recognises the list screens', () => {
        for (const path of ['/', '/?filter=inbox', '/folder/abc?dbKey=user%3Ax', '/folders', '/folders?tab=shared', '/search?q=rail']) {
            expect(isListPath(path)).toBe(true);
        }
        for (const path of ['/doc/abc', '/print-styles', '/styles', '/settings', '/searching', '/foldersx', null, undefined]) {
            expect(isListPath(path)).toBe(false);
        }
    });

    it('goes back only to a list, and otherwise replaces with the parent', () => {
        const router = { back: vi.fn(), replace: vi.fn() };
        window.history.replaceState({ back: '/' }, '');
        goUp(router, { name: 'home' });
        expect(router.back).toHaveBeenCalledTimes(1);

        // Coming from a styles page must not send the user back to it.
        window.history.replaceState({ back: '/print-styles' }, '');
        goUp(router, { name: 'folder', params: { folderId: 'f' } });
        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.replace).toHaveBeenCalledWith({ name: 'folder', params: { folderId: 'f' } });
    });
});
