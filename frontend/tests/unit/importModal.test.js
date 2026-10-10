import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    new URL('../../src/components/ImportModal.vue', import.meta.url),
    'utf8'
);

describe('ImportModal document with linked images', () => {
    it('offers a dedicated File System Access API import mode', () => {
        expect(source).toContain("title=\"Document with Linked Images\"");
        expect(source).toContain("selectMode('document-images')");
        expect(source).toContain('window.showDirectoryPicker');
        expect(source).toContain('File System Access API support');
    });

    it('lists discovered documents and imports the user-selected one with its source folder', () => {
        expect(source).toContain('docStore.listMarkdownDocumentsInDirectory(directoryHandle)');
        expect(source).toContain('selectedLinkedDocumentPath');
        expect(source).toContain('<option value="">Choose a document</option>');
        expect(source).toContain('docStore.importDocumentWithLinkedImages(');
        expect(source).toContain('linkedSourceDirectory.value');
    });
});

describe('ImportModal result messages', () => {
    it('queues result toasts for after the reload instead of losing them', () => {
        // The dialog reloads the page right after a successful import. Toasts
        // added only to the in-memory store vanish with that reload.
        const queueIndex = source.indexOf('queueDeferredToasts(window.sessionStorage, toasts)');
        const reloadIndex = source.indexOf('window.location.reload()');

        expect(queueIndex).toBeGreaterThan(-1);
        expect(reloadIndex).toBeGreaterThan(queueIndex);
        expect(source).toContain('const willReload = shouldReloadAfterImport(result)');
    });

    it('includes the skipped-item warning in the queued messages', () => {
        expect(source).toContain('const skipped = buildSkippedItemsToastMessage(result)');
        expect(source).toContain("toasts.push({ message: skipped, type: 'warning', duration: 8000 })");
    });

    it('still shows the messages immediately when no reload follows or queuing fails', () => {
        expect(source).toContain('if (queued === 0) {');
        expect(source).toContain('toasts.forEach(toast => uiStore.addToast(toast.message, toast.type, toast.duration))');
    });
});
