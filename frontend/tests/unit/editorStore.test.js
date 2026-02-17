import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useEditorStore } from '../../src/store/editorStore.js';

describe('editorStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.restoreAllMocks();
    });

    it('forwards insertImageFromLibrary to exposed editor method', () => {
        const store = useEditorStore();
        const insertImagesFromLibrary = vi.fn();

        store.setEditorRef({ insertImagesFromLibrary });

        const images = [
            { id: 'img-1', filename: 'a.png', imageUrl: 'http://localhost:8000/images/img-1' },
            { id: 'img-2', filename: 'b.png', imageUrl: 'http://localhost:8000/images/img-2' },
        ];

        store.insertImageFromLibrary(images);

        expect(insertImagesFromLibrary).toHaveBeenCalledWith(images);
    });

    it('does not throw when image library insert is unavailable', () => {
        const store = useEditorStore();
        store.setEditorRef({});

        expect(() => store.insertImageFromLibrary([{ id: 'img-1' }])).not.toThrow();
    });
});
