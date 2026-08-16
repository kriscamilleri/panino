// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

const routerMock = { push: vi.fn() };
const draftStoreMock = { clearDraft: vi.fn() };
const uiStoreMock = { addToast: vi.fn() };

/**
 * Reactive stand-in for the docStore facade. `syncStore.isInitialized`,
 * `recentDocVersion`, and `contentVersion` are the refresh triggers the
 * dashboard watches, so they have to be reactive here too.
 */
const docStoreMock = reactive({
    recentDocVersion: 0,
    contentVersion: 0,
    syncStore: {
        isInitialized: true,
        execute: vi.fn(async () => [{ name: 'Above Bored' }]),
    },
    getRecentDocuments: vi.fn(async () => []),
    getFolderDocuments: vi.fn(async () => []),
    getChildren: vi.fn(async () => []),
    setDocumentPinned: vi.fn(async () => { }),
    createFile: vi.fn(async () => ({ id: 'new-note', type: 'file', name: 'New' })),
    selectFile: vi.fn(),
    selectFolder: vi.fn(),
});

vi.mock('vue-router', () => ({ useRouter: () => routerMock }));
vi.mock('@/store/docStore', () => ({ useDocStore: () => docStoreMock }));
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => draftStoreMock }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => uiStoreMock }));

const DocumentDashboard = (await import('@/components/DocumentDashboard.vue')).default;

/** Recent, so every fixture lands in the `Today` group unless stated otherwise. */
function minutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60000).toISOString();
}

function makeDoc(id, overrides = {}) {
    return {
        id,
        type: 'file',
        name: id,
        folderName: 'Root',
        folderId: null,
        displayedDate: minutesAgo(5),
        excerpt: `Excerpt for ${id}`,
        wordCount: 10,
        isPinned: false,
        ...overrides,
    };
}

const GLOBAL_DOCS = [
    makeDoc('alpha', { name: 'Alpha Plan', folderName: 'Work / Planning', isPinned: true }),
    makeDoc('beta', { name: 'Beta Notes', folderName: 'Personal', displayedDate: minutesAgo(60) }),
    makeDoc('gamma', { name: 'Gamma Draft', folderName: 'Work', displayedDate: minutesAgo(120) }),
    makeDoc('delta', { name: 'Delta Review', folderName: 'Archive', isPinned: true, displayedDate: minutesAgo(200) }),
];

/**
 * Mounted dashboards keep live watchers on the shared store mock, so every
 * wrapper is unmounted after its test — otherwise a later version bump would
 * re-trigger loads in earlier components and inflate the call counts.
 */
const mounted = [];

function mountDashboardSync(folderId) {
    const wrapper = mount(DocumentDashboard, { props: { folderId } });
    mounted.push(wrapper);
    return wrapper;
}

async function mountDashboard(folderId = '__recent__') {
    const wrapper = mountDashboardSync(folderId);
    await flushPromises();
    return wrapper;
}

function testid(wrapper, id) {
    return wrapper.find(`[data-testid="${id}"]`);
}

afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
});

beforeEach(() => {
    vi.clearAllMocks();
    docStoreMock.recentDocVersion = 0;
    docStoreMock.contentVersion = 0;
    docStoreMock.syncStore.isInitialized = true;
    docStoreMock.syncStore.execute.mockImplementation(async () => [{ name: 'Above Bored' }]);
    docStoreMock.getRecentDocuments.mockImplementation(async () => GLOBAL_DOCS.map((d) => ({ ...d })));
    docStoreMock.getFolderDocuments.mockImplementation(async () => []);
    docStoreMock.getChildren.mockImplementation(async () => []);
    docStoreMock.setDocumentPinned.mockImplementation(async () => { });
    docStoreMock.createFile.mockImplementation(async () => ({ id: 'new-note', type: 'file', name: 'New' }));
});

describe('DocumentDashboard — global Recent Documents', () => {
    it('renders the page header, search label, and New Note action', async () => {
        const wrapper = await mountDashboard();

        expect(testid(wrapper, 'folder-preview-recent-heading').text()).toBe('Recent Documents');
        expect(testid(wrapper, 'document-dashboard-search').attributes('placeholder'))
            .toBe('Search recent documents');
        expect(testid(wrapper, 'document-dashboard-new-note').exists()).toBe(true);
        expect(testid(wrapper, 'document-dashboard-list-heading').text()).toBe('Recent');
    });

    it('loads the bounded global query rather than the old ten-item one', async () => {
        await mountDashboard();
        expect(docStoreMock.getRecentDocuments).toHaveBeenCalledWith(50);
        expect(docStoreMock.getFolderDocuments).not.toHaveBeenCalled();
    });

    it('shows exactly the top three results as Continue Writing cards', async () => {
        const wrapper = await mountDashboard();
        const cards = wrapper.findAll('[data-testid^="continue-writing-card-"]');

        expect(cards).toHaveLength(3);
        expect(cards.map((c) => c.attributes('data-testid'))).toEqual([
            'continue-writing-card-alpha',
            'continue-writing-card-beta',
            'continue-writing-card-gamma',
        ]);
    });

    it('keeps the carded documents in the chronological list as well', async () => {
        const wrapper = await mountDashboard();
        const rows = wrapper.findAll('[data-testid^="document-row-"]')
            .filter((r) => /document-row-[a-z]+$/.test(r.attributes('data-testid')));

        expect(rows.map((r) => r.attributes('data-testid'))).toEqual([
            'document-row-alpha',
            'document-row-beta',
            'document-row-gamma',
            'document-row-delta',
        ]);
    });

    it('renders two, one, and no cards as the result set shrinks', async () => {
        for (const size of [2, 1]) {
            docStoreMock.getRecentDocuments.mockImplementation(
                async () => GLOBAL_DOCS.slice(0, size).map((d) => ({ ...d }))
            );
            const wrapper = await mountDashboard();
            expect(wrapper.findAll('[data-testid^="continue-writing-card-"]')).toHaveLength(size);
        }

        docStoreMock.getRecentDocuments.mockImplementation(async () => []);
        const empty = await mountDashboard();
        expect(testid(empty, 'continue-writing-section').exists()).toBe(false);
    });

    it('hides the Continue Writing section when the filters match nothing', async () => {
        const wrapper = await mountDashboard();
        await testid(wrapper, 'document-dashboard-search').setValue('no-such-note');

        expect(testid(wrapper, 'continue-writing-section').exists()).toBe(false);
        expect(testid(wrapper, 'document-dashboard-no-matches').text())
            .toContain('No recent documents match these filters.');
    });
});

describe('DocumentDashboard — quick filter', () => {
    it('matches on title, folder path, and excerpt', async () => {
        const wrapper = await mountDashboard();
        const input = testid(wrapper, 'document-dashboard-search');

        await input.setValue('beta');
        expect(wrapper.findAll('[data-testid^="document-row-title-"]')).toHaveLength(1);

        await input.setValue('work / planning');
        expect(testid(wrapper, 'document-row-title-alpha').exists()).toBe(true);

        await input.setValue('excerpt for gamma');
        expect(testid(wrapper, 'document-row-title-gamma').exists()).toBe(true);
    });

    it('shows the clear control only while text is present and keeps other filters', async () => {
        const wrapper = await mountDashboard();
        expect(testid(wrapper, 'document-dashboard-search-clear').exists()).toBe(false);

        await testid(wrapper, 'document-dashboard-pinned-toggle').trigger('click');
        await testid(wrapper, 'document-dashboard-search').setValue('alpha');
        expect(testid(wrapper, 'document-dashboard-search-clear').exists()).toBe(true);

        await testid(wrapper, 'document-dashboard-search-clear').trigger('click');
        expect(testid(wrapper, 'document-dashboard-search').element.value).toBe('');
        // The Pinned filter survives clearing the quick filter.
        expect(testid(wrapper, 'document-dashboard-filter').element.value).toBe('pinned');
        expect(wrapper.findAll('[data-testid^="document-row-title-"]')).toHaveLength(2);
    });

    it('announces the result count in a polite live region', async () => {
        const wrapper = await mountDashboard();
        const region = testid(wrapper, 'document-dashboard-result-count');

        expect(region.attributes('aria-live')).toBe('polite');
        expect(region.text()).toBe('4 documents shown');

        await testid(wrapper, 'document-dashboard-search').setValue('alpha');
        expect(testid(wrapper, 'document-dashboard-result-count').text()).toBe('1 document shown');
    });
});

describe('DocumentDashboard — filters and sorting', () => {
    it('limits to pinned documents and keeps the select and toggle in sync', async () => {
        const wrapper = await mountDashboard();

        await testid(wrapper, 'document-dashboard-pinned-toggle').trigger('click');
        expect(testid(wrapper, 'document-dashboard-filter').element.value).toBe('pinned');
        expect(testid(wrapper, 'document-dashboard-pinned-toggle').attributes('aria-pressed')).toBe('true');
        expect(wrapper.findAll('[data-testid^="document-row-title-"]').map((r) => r.text()))
            .toEqual(['Alpha Plan', 'Delta Review']);

        await testid(wrapper, 'document-dashboard-filter').setValue('all');
        expect(testid(wrapper, 'document-dashboard-pinned-toggle').attributes('aria-pressed')).toBe('false');
        expect(wrapper.findAll('[data-testid^="document-row-title-"]')).toHaveLength(4);
    });

    it('includes pinned notes from every folder in the global scope', async () => {
        const wrapper = await mountDashboard();
        await testid(wrapper, 'document-dashboard-filter').setValue('pinned');

        expect(wrapper.findAll('[data-testid^="document-row-folder-"]').map((r) => r.text()))
            .toEqual(['Work / Planning', 'Archive']);
    });

    it('switches to oldest-first sorting', async () => {
        const wrapper = await mountDashboard();
        await testid(wrapper, 'document-dashboard-sort').setValue('oldest');

        expect(wrapper.findAll('[data-testid^="document-row-title-"]').map((r) => r.text()))
            .toEqual(['Delta Review', 'Gamma Draft', 'Beta Notes', 'Alpha Plan']);
    });

    it('groups by local time and omits empty groups', async () => {
        docStoreMock.getRecentDocuments.mockImplementation(async () => [
            makeDoc('today-note'),
            makeDoc('old-note', { displayedDate: new Date(Date.now() - 45 * 86400000).toISOString() }),
        ]);
        const wrapper = await mountDashboard();

        const labels = wrapper.findAll('[data-testid^="document-group-label-"]').map((g) => g.text());
        expect(labels).toEqual(['Today', 'Earlier']);
        expect(testid(wrapper, 'document-group-yesterday').exists()).toBe(false);
    });
});

describe('DocumentDashboard — opening and creating documents', () => {
    it('opens a document by mouse through the existing draft/select/route flow', async () => {
        const wrapper = await mountDashboard();
        await testid(wrapper, 'document-row-beta').trigger('click');
        await flushPromises();

        expect(draftStoreMock.clearDraft).toHaveBeenCalledWith('beta');
        expect(docStoreMock.selectFile).toHaveBeenCalledWith('beta');
        expect(routerMock.push).toHaveBeenCalledWith({ name: 'doc', params: { fileId: 'beta' } });
    });

    it('opens a document from the keyboard on both rows and cards', async () => {
        const wrapper = await mountDashboard();

        await testid(wrapper, 'document-row-gamma').trigger('keydown.enter');
        await flushPromises();
        expect(routerMock.push).toHaveBeenCalledWith({ name: 'doc', params: { fileId: 'gamma' } });

        await testid(wrapper, 'continue-writing-card-alpha').trigger('keydown.space');
        await flushPromises();
        expect(routerMock.push).toHaveBeenCalledWith({ name: 'doc', params: { fileId: 'alpha' } });
    });

    it('creates a root note from Recent Documents and navigates to it', async () => {
        const wrapper = await mountDashboard();
        await testid(wrapper, 'document-dashboard-new-note').trigger('click');
        await flushPromises();

        await testid(wrapper, 'document-dashboard-create-modal-input').setValue('Fresh Note');
        await testid(wrapper, 'document-dashboard-create-modal-confirm').trigger('click');
        await flushPromises();

        expect(docStoreMock.createFile).toHaveBeenCalledWith('Fresh Note', null);
        expect(routerMock.push).toHaveBeenCalledWith({ name: 'doc', params: { fileId: 'new-note' } });
    });

    it('reports a failed creation through the toast system', async () => {
        docStoreMock.createFile.mockRejectedValue(new Error('nope'));
        const wrapper = await mountDashboard();

        await testid(wrapper, 'document-dashboard-new-note').trigger('click');
        await flushPromises();
        await testid(wrapper, 'document-dashboard-create-modal-input').setValue('Fresh Note');
        await testid(wrapper, 'document-dashboard-create-modal-confirm').trigger('click');
        await flushPromises();

        expect(uiStoreMock.addToast).toHaveBeenCalledWith('Failed to create file', 'error');
    });
});

describe('DocumentDashboard — pinning', () => {
    it('exposes an accessible name and pressed state on the pin control', async () => {
        const wrapper = await mountDashboard();
        const unpinned = testid(wrapper, 'document-pin-toggle-beta');
        const pinned = wrapper.findAll('[data-testid="document-pin-toggle-alpha"]').at(-1);

        expect(unpinned.attributes('aria-label')).toBe('Pin Beta Notes');
        expect(unpinned.attributes('aria-pressed')).toBe('false');
        expect(pinned.attributes('aria-label')).toBe('Unpin Alpha Plan');
        expect(pinned.attributes('aria-pressed')).toBe('true');
    });

    it('pins optimistically without opening the document', async () => {
        const wrapper = await mountDashboard();
        await testid(wrapper, 'document-pin-toggle-beta').trigger('click');

        expect(docStoreMock.setDocumentPinned).toHaveBeenCalledWith('beta', true);
        expect(routerMock.push).not.toHaveBeenCalled();
        expect(docStoreMock.selectFile).not.toHaveBeenCalled();
        expect(testid(wrapper, 'document-pin-toggle-beta').attributes('aria-pressed')).toBe('true');
    });

    it('unpins an already pinned document', async () => {
        const wrapper = await mountDashboard();
        await wrapper.findAll('[data-testid="document-pin-toggle-alpha"]').at(-1).trigger('click');

        expect(docStoreMock.setDocumentPinned).toHaveBeenCalledWith('alpha', false);
    });

    it('reverts and reports a failed pin write, then reloads from the database', async () => {
        docStoreMock.setDocumentPinned.mockRejectedValue(new Error('write failed'));
        const wrapper = await mountDashboard();

        await testid(wrapper, 'document-pin-toggle-beta').trigger('click');
        await flushPromises();

        expect(uiStoreMock.addToast).toHaveBeenCalledWith('Failed to pin document', 'error');
        expect(testid(wrapper, 'document-pin-toggle-beta').attributes('aria-pressed')).toBe('false');
        // Once on mount, once after the failure.
        expect(docStoreMock.getRecentDocuments).toHaveBeenCalledTimes(2);
    });
});

describe('DocumentDashboard — folder scope', () => {
    const FOLDER_DOCS = [
        makeDoc('folder-note', { name: 'Folder Note', folderName: 'Above Bored' }),
        makeDoc('folder-pinned', { name: 'Folder Pinned', folderName: 'Above Bored', isPinned: true }),
    ];

    beforeEach(() => {
        docStoreMock.getFolderDocuments.mockImplementation(async () => FOLDER_DOCS.map((d) => ({ ...d })));
        docStoreMock.getChildren.mockImplementation(async () => [
            { id: 'child-b', name: 'Zulu', type: 'folder' },
            { id: 'child-a', name: 'Alpha', type: 'folder' },
            { id: 'note-x', name: 'A note', type: 'file' },
        ]);
    });

    it('uses the folder name, folder search label, and Documents list title', async () => {
        const wrapper = await mountDashboard('folder-1');

        expect(testid(wrapper, 'folder-preview-name-folder-1').text()).toBe('Above Bored');
        expect(testid(wrapper, 'document-dashboard-search').attributes('placeholder'))
            .toBe('Search this folder');
        expect(testid(wrapper, 'document-dashboard-list-heading').text()).toBe('Documents');
    });

    it('queries only the selected folder and omits the Continue Writing rail', async () => {
        const wrapper = await mountDashboard('folder-1');

        expect(docStoreMock.getFolderDocuments).toHaveBeenCalledWith('folder-1', 50);
        expect(docStoreMock.getRecentDocuments).not.toHaveBeenCalled();
        expect(testid(wrapper, 'continue-writing-section').exists()).toBe(false);
    });

    it('lists immediate child folders only, sorted by name, and opens them by route', async () => {
        const wrapper = await mountDashboard('folder-1');
        const items = wrapper.findAll('[data-testid^="folder-navigation-item-"]');

        expect(items.map((i) => i.text())).toEqual(['Alpha', 'Zulu']);

        await items[0].trigger('click');
        await flushPromises();
        expect(docStoreMock.selectFolder).toHaveBeenCalledWith('child-a');
        expect(routerMock.push).toHaveBeenCalledWith({ name: 'folder', params: { folderId: 'child-a' } });
    });

    it('never hides child-folder navigation behind the document filters', async () => {
        const wrapper = await mountDashboard('folder-1');
        await testid(wrapper, 'document-dashboard-search').setValue('no-such-note');

        expect(wrapper.findAll('[data-testid^="folder-navigation-item-"]')).toHaveLength(2);
        expect(testid(wrapper, 'document-dashboard-no-matches').text())
            .toContain('No documents in this folder match these filters.');
    });

    it('limits the Pinned filter to notes assigned to the selected folder', async () => {
        const wrapper = await mountDashboard('folder-1');
        await testid(wrapper, 'document-dashboard-filter').setValue('pinned');

        expect(wrapper.findAll('[data-testid^="document-row-title-"]').map((r) => r.text()))
            .toEqual(['Folder Pinned']);
    });

    it('creates a new note inside the selected folder', async () => {
        const wrapper = await mountDashboard('folder-1');
        await testid(wrapper, 'document-dashboard-new-note').trigger('click');
        await flushPromises();

        await testid(wrapper, 'document-dashboard-create-modal-input').setValue('Folder Note');
        await testid(wrapper, 'document-dashboard-create-modal-confirm').trigger('click');
        await flushPromises();

        expect(docStoreMock.createFile).toHaveBeenCalledWith('Folder Note', 'folder-1');
    });

    it('shows the folder-specific empty state with a New Note action', async () => {
        docStoreMock.getFolderDocuments.mockImplementation(async () => []);
        const wrapper = await mountDashboard('folder-1');

        expect(testid(wrapper, 'document-dashboard-empty').text())
            .toContain('No documents in this folder yet.');
        expect(testid(wrapper, 'document-dashboard-empty-new-note').exists()).toBe(true);
    });
});

describe('DocumentDashboard — empty and refresh behavior', () => {
    it('shows the global empty state with a New Note action', async () => {
        docStoreMock.getRecentDocuments.mockImplementation(async () => []);
        const wrapper = await mountDashboard();

        expect(testid(wrapper, 'document-dashboard-empty').text()).toContain('No documents yet.');
        expect(testid(wrapper, 'document-dashboard-empty-new-note').exists()).toBe(true);
        expect(testid(wrapper, 'document-dashboard-no-matches').exists()).toBe(false);
    });

    it('offers a clear-filters affordance when the filters exclude everything', async () => {
        const wrapper = await mountDashboard();
        await testid(wrapper, 'document-dashboard-search').setValue('zzz');
        await testid(wrapper, 'document-dashboard-filter').setValue('pinned');

        await testid(wrapper, 'document-dashboard-clear-filters').trigger('click');

        expect(testid(wrapper, 'document-dashboard-search').element.value).toBe('');
        expect(testid(wrapper, 'document-dashboard-filter').element.value).toBe('all');
        expect(wrapper.findAll('[data-testid^="document-row-title-"]')).toHaveLength(4);
    });

    it('reloads after a sync bumps recentDocVersion', async () => {
        await mountDashboard();
        expect(docStoreMock.getRecentDocuments).toHaveBeenCalledTimes(1);

        docStoreMock.recentDocVersion += 1;
        await flushPromises();
        expect(docStoreMock.getRecentDocuments).toHaveBeenCalledTimes(2);
    });

    it('reloads after a local note write bumps contentVersion', async () => {
        await mountDashboard();
        docStoreMock.contentVersion += 1;
        await flushPromises();
        expect(docStoreMock.getRecentDocuments).toHaveBeenCalledTimes(2);
    });

    it('discards a stale in-flight result that resolves after a newer one', async () => {
        const slow = GLOBAL_DOCS.slice(0, 1).map((d) => ({ ...d, name: 'Stale Result' }));
        const fresh = GLOBAL_DOCS.slice(0, 2).map((d) => ({ ...d }));

        let releaseSlow;
        docStoreMock.getRecentDocuments.mockImplementationOnce(
            () => new Promise((resolve) => { releaseSlow = () => resolve(slow); })
        );
        docStoreMock.getRecentDocuments.mockImplementationOnce(async () => fresh);

        const wrapper = mountDashboardSync('__recent__');
        docStoreMock.recentDocVersion += 1;
        await flushPromises();

        releaseSlow();
        await flushPromises();

        const titles = wrapper.findAll('[data-testid^="document-row-title-"]').map((r) => r.text());
        expect(titles).toEqual(['Alpha Plan', 'Beta Notes']);
        expect(titles).not.toContain('Stale Result');
    });
});

describe('DocumentDashboard — presentation contracts', () => {
    it('renders mobile and desktop metadata blocks for each row', async () => {
        const wrapper = await mountDashboard();

        expect(testid(wrapper, 'document-row-meta-beta').classes()).toContain('sm:flex');
        expect(testid(wrapper, 'document-row-meta-beta').classes()).toContain('hidden');
        expect(testid(wrapper, 'document-row-meta-mobile-beta').classes()).toContain('sm:hidden');
    });

    it('stacks the header below the desktop breakpoint so the title is not squeezed', async () => {
        const wrapper = await mountDashboard();
        const header = testid(wrapper, 'folder-preview-recent-heading').element.parentElement;

        // Single-row header is the >= 1024px layout; below that the title keeps
        // its own line instead of being truncated by the search field.
        expect(header.className).toContain('flex-col');
        expect(header.className).toContain('lg:flex-row');
        expect(header.className).not.toContain('sm:flex-row');
    });

    it('omits a card excerpt for a note with no content', async () => {
        docStoreMock.getRecentDocuments.mockImplementation(async () => [
            makeDoc('blank', { excerpt: '' }),
        ]);
        const wrapper = await mountDashboard();

        expect(testid(wrapper, 'continue-writing-card-blank').exists()).toBe(true);
        expect(testid(wrapper, 'continue-writing-excerpt-blank').exists()).toBe(false);
    });

    it('renders the unknown-time label instead of an invalid relative string', async () => {
        docStoreMock.getRecentDocuments.mockImplementation(async () => [
            makeDoc('undated', { displayedDate: '' }),
        ]);
        const wrapper = await mountDashboard();

        expect(testid(wrapper, 'document-row-meta-undated').text()).toContain('Unknown update time');
        expect(testid(wrapper, 'document-group-earlier').exists()).toBe(true);
    });

    it('uses gray focus rings and no blue primary button', async () => {
        const wrapper = await mountDashboard();

        expect(testid(wrapper, 'document-row-beta').classes()).toContain('focus-visible:ring-gray-500');
        expect(testid(wrapper, 'continue-writing-card-beta').classes()).toContain('focus-visible:ring-gray-500');

        const newNoteClasses = testid(wrapper, 'document-dashboard-new-note').classes().join(' ');
        expect(newNoteClasses).toContain('bg-gray-800');
        expect(newNoteClasses).not.toMatch(/bg-blue/);
    });

    it('keeps document titles blue, as links', async () => {
        const wrapper = await mountDashboard();
        expect(testid(wrapper, 'document-row-title-beta').classes()).toContain('text-blue-600');
        expect(testid(wrapper, 'continue-writing-title-beta').classes()).toContain('text-blue-600');
    });
});
