// @vitest-environment jsdom
// The desktop search panel and the phone Search page on the new engine
// (docs/specs/active/advanced-search.md §5): the panel replaces the tree, Esc
// returns to it keeping the query, chips write into the query, results render
// as text with the In Trash label, "Show more" loads the next page, and the
// shortcut opens the panel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';

const PERSONAL = 'user:11111111-1111-4111-8111-111111111111';
const SPACE = 'space:22222222-2222-4222-8222-222222222222';

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
const route = reactive({ name: 'search', params: {}, query: {} });
const syncStore = reactive({
    personalDbKey: PERSONAL,
    isInitialized: true,
    databases: new Map([[PERSONAL, { dbKey: PERSONAL, kind: 'user' }], [SPACE, { dbKey: SPACE, kind: 'space', name: 'Acme Team' }]]),
    bootstrapState: { status: 'ready', completed: 0, total: 0, error: null },
});
const structureStore = reactive({ selectedFolderId: null, selectedDbKey: null, selectedFileId: null, moveItem: vi.fn() });

function doc(id, overrides = {}) {
    return {
        id, dbKey: PERSONAL, name: `Doc ${id}`, content: `<b>budget</b> for ${id}`, folderId: null, folderName: 'Root',
        spaceName: null, displayedDate: '2026-11-01T10:00:00.000Z', inTrash: false, ...overrides,
    };
}

const searchDocuments = vi.fn();
const docStore = reactive({
    rootItems: [],
    syncStore,
    recentDocVersion: 0,
    searchDocuments,
    getFolderTrail: vi.fn(async () => [{ id: 'f1', name: 'Projects' }, { id: 'f2', name: 'Q1 plans' }]),
    selectFile: vi.fn(),
    selectFolder: vi.fn(),
    loadRootItems: vi.fn(async () => {}),
    isFolderOpen: () => false,
    getChildren: vi.fn(async () => []),
});
const ui = reactive({ showDocuments: false, myNotesCollapsed: false, toggleDocuments: vi.fn(() => { ui.showDocuments = !ui.showDocuments; }), addToast: vi.fn() });

vi.mock('vue-router', () => ({ useRouter: () => router, useRoute: () => route }));
vi.mock('@/store/docStore', () => ({ useDocStore: () => docStore }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => syncStore }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ui }));
vi.mock('@/store/structureStore', () => ({ useStructureStore: () => structureStore }));
vi.mock('@/store/spaceTransferStore', () => ({
    useSpaceTransferStore: () => ({ begin: vi.fn(), recoverable: [], loadRecoverable: vi.fn() }),
}));
vi.mock('@/store/conflictStore', () => ({ useConflictStore: () => ({ hasConflict: () => false }) }));
vi.mock('@/composables/useViewport', async () => {
    const { ref } = await import('vue');
    return { useViewport: () => ({ isPhone: ref(true), visibleStyle: ref({}), keyboardOpen: ref(false) }) };
});

const { default: SearchPanel } = await import('@/components/SearchPanel.vue');
const { default: Documents } = await import('@/components/Documents.vue');
const { default: SidebarWithResizer } = await import('@/components/SidebarWithResizer.vue');
const { default: PhoneSearchPage } = await import('@/pages/PhoneSearchPage.vue');
const { useDesktopSearchState, SEARCH_DEBOUNCE_MS } = await import('@/composables/useDocumentSearch');

const mounted = [];
function mountIt(component, options = {}) {
    const wrapper = mount(component, {
        attachTo: document.body,
        ...options,
        global: { stubs: { PhoneShell: { template: '<div><slot /></div>' }, TreeItem: true, PromptModal: true, TemplatePickerModal: true, DocumentTransferPanel: true } },
    });
    mounted.push(wrapper);
    return wrapper;
}

async function settle() {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10);
    await flushPromises();
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    const desktop = useDesktopSearchState();
    desktop.text.value = '';
    desktop.closeSearch();
    route.query = {};
    structureStore.selectedFolderId = null;
    structureStore.selectedDbKey = null;
    searchDocuments.mockImplementation(async ({ cursor }) => (cursor
        ? { results: [doc('n3')], nextCursor: null, notices: [], terms: ['budget'], cancelled: false }
        : {
            results: [doc('n1'), doc('n2', { dbKey: SPACE, spaceName: 'Acme Team', folderId: 't', folderName: 'Trash', inTrash: true })],
            nextCursor: { score: 0, updatedAt: '2026-11-01', id: 'n2' },
            notices: ['Tags are not available yet'],
            terms: ['budget'],
            cancelled: false,
        }));
});

afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    vi.useRealTimers();
});

describe('desktop search panel', () => {
    it('replaces the tree while open and returns to it on Esc, keeping the query', async () => {
        const wrapper = mountIt(Documents);
        expect(wrapper.find('[data-testid="documents-tree-normal"]').exists()).toBe(true);
        await wrapper.get('[data-testid="documents-search-toggle"]').trigger('click');
        expect(wrapper.find('[data-testid="documents-search-panel"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="documents-tree-normal"]').exists()).toBe(false);

        await wrapper.get('[data-testid="documents-search-input"]').setValue('budget');
        await settle();
        expect(searchDocuments).toHaveBeenLastCalledWith({ query: 'budget', limit: 20 });

        await wrapper.get('[data-testid="documents-search-input"]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('[data-testid="documents-tree-normal"]').exists()).toBe(true);
        await wrapper.get('[data-testid="documents-search-toggle"]').trigger('click');
        expect(wrapper.get('[data-testid="documents-search-input"]').element.value).toBe('budget');
    });

    it('shows results as text, with the space, the In Trash label, notices and a count', async () => {
        useDesktopSearchState().text.value = 'budget';
        const wrapper = mountIt(SearchPanel);
        await settle();
        expect(wrapper.get('[data-testid="documents-search-count"]').text()).toBe('2+ Documents');
        expect(wrapper.get('[data-testid="documents-search-notices"]').text()).toBe('Tags are not available yet');
        const trashed = wrapper.get('[data-testid="documents-search-result-n2"]');
        expect(trashed.text()).toContain('In Trash');
        expect(trashed.text()).toContain('Acme Team · Trash');
        // Markup in a body is text, never HTML.
        expect(wrapper.find('[data-testid="documents-search-results"] b').exists()).toBe(false);
        expect(wrapper.get('[data-testid="documents-search-result-n1"] mark').text()).toBe('budget');

        await wrapper.get('[data-testid="documents-search-more"]').trigger('click');
        await flushPromises();
        expect(searchDocuments).toHaveBeenLastCalledWith({ query: 'budget', limit: 20, cursor: { score: 0, updatedAt: '2026-11-01', id: 'n2' } });
        expect(wrapper.findAll('[data-testid^="documents-search-result-"]')).toHaveLength(3);
        expect(wrapper.find('[data-testid="documents-search-more"]').exists()).toBe(false);

        await wrapper.get('[data-testid="documents-search-result-n1"]').trigger('click');
        expect(router.push).toHaveBeenCalledWith({ name: 'doc', params: { fileId: 'n1' }, query: { dbKey: PERSONAL } });
        expect(JSON.parse(localStorage.getItem('panino-recent-searches'))).toEqual(['budget']);
    });

    it('writes chips into the query, including the selected folder', async () => {
        structureStore.selectedFolderId = 'f2';
        structureStore.selectedDbKey = SPACE;
        const wrapper = mountIt(SearchPanel);
        await flushPromises();
        const input = wrapper.get('[data-testid="documents-search-input"]');
        await input.setValue('budget');
        await wrapper.get('[data-testid="documents-search-chip-titles"]').trigger('click');
        expect(input.element.value).toBe('title:budget');
        await wrapper.get('[data-testid="documents-search-chip-checklists"]').trigger('click');
        expect(input.element.value).toBe('title:budget is:checklist');
        const folder = wrapper.get('[data-testid="documents-search-chip-folder"]');
        expect(folder.text()).toBe('Q1 plans');
        await folder.trigger('click');
        expect(input.element.value).toBe('in:"Acme Team/Projects/Q1 plans" title:budget is:checklist');
        expect(folder.attributes('aria-pressed')).toBe('true');
        await wrapper.get('[data-testid="documents-search-chip-everything"]').trigger('click');
        expect(input.element.value).toBe('budget');
        await flushPromises();
        expect(searchDocuments).toHaveBeenLastCalledWith({ query: 'budget', limit: 20 });
    });

    it('opens the syntax help, and Esc closes it before the panel', async () => {
        const wrapper = mountIt(SearchPanel);
        await wrapper.get('[data-testid="documents-search-syntax-toggle"]').trigger('click');
        const help = wrapper.get('[data-testid="documents-search-syntax"]');
        expect(help.text()).toContain('in:"Acme Team/Contracts"');
        expect(help.text()).toContain('prop:status=draft');
        useDesktopSearchState().openSearch();
        await wrapper.get('[data-testid="documents-search-input"]').trigger('keydown', { key: 'Escape' });
        expect(wrapper.find('[data-testid="documents-search-syntax"]').exists()).toBe(false);
        expect(useDesktopSearchState().open.value).toBe(true);
    });

    it('returns focus to the search button on Esc, and moves it through the syntax help', async () => {
        const wrapper = mountIt(Documents);
        await wrapper.get('[data-testid="documents-search-toggle"]').trigger('click');
        await flushPromises();
        await wrapper.get('[data-testid="documents-search-syntax-toggle"]').trigger('click');
        await flushPromises();
        expect(document.activeElement?.dataset.testid).toBe('documents-search-syntax');
        await wrapper.get('[data-testid="documents-search-syntax"]').trigger('keydown', { key: 'Escape' });
        await flushPromises();
        expect(document.activeElement?.dataset.testid).toBe('documents-search-syntax-toggle');
        await wrapper.get('[data-testid="documents-search-input"]').trigger('keydown', { key: 'Escape' });
        await flushPromises();
        expect(wrapper.find('[data-testid="documents-search-panel"]').exists()).toBe(false);
        expect(document.activeElement?.dataset.testid).toBe('documents-search-toggle');
        // The close button does the same.
        await wrapper.get('[data-testid="documents-search-toggle"]').trigger('click');
        await wrapper.get('[data-testid="documents-search-close"]').trigger('click');
        await flushPromises();
        expect(document.activeElement?.dataset.testid).toBe('documents-search-toggle');
    });

    it('searches again after a sync at most once per 2 s, and only while results are shown', async () => {
        useDesktopSearchState().text.value = 'budget';
        mountIt(SearchPanel);
        await settle();
        const before = searchDocuments.mock.calls.length;
        for (let i = 0; i < 5; i += 1) {
            docStore.recentDocVersion += 1;
            await flushPromises();
            vi.advanceTimersByTime(100);
        }
        await flushPromises();
        expect(searchDocuments.mock.calls.length - before).toBe(1);
        vi.advanceTimersByTime(2100);
        await flushPromises();
        // The bumps inside the window gave one more re-run at its end, not one each.
        expect(searchDocuments.mock.calls.length - before).toBeLessThanOrEqual(2);
        const settled = searchDocuments.mock.calls.length;
        vi.advanceTimersByTime(5000);
        await flushPromises();
        expect(searchDocuments.mock.calls.length).toBe(settled);
    });

    it('does not search again after a sync while the field is empty', async () => {
        mountIt(SearchPanel);
        await settle();
        docStore.recentDocVersion += 1;
        vi.advanceTimersByTime(3000);
        await flushPromises();
        expect(searchDocuments).not.toHaveBeenCalled();
    });

    it('opens with Ctrl+Shift+F, showing a collapsed sidebar first', async () => {
        ui.showDocuments = false;
        mountIt(SidebarWithResizer, { global: { stubs: { Documents: true } } });
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true }));
        expect(ui.toggleDocuments).toHaveBeenCalled();
        expect(useDesktopSearchState().open.value).toBe(true);
    });
});

describe('phone Search page', () => {
    it('starts with in: for the folder it was opened from, and loads more', async () => {
        route.query = { scope: 'folder', folder: 'f2', dbKey: PERSONAL };
        const wrapper = mountIt(PhoneSearchPage);
        await flushPromises();
        const input = wrapper.get('[data-testid="phone-search-input"]');
        expect(input.element.value).toBe('in:"Projects/Q1 plans" ');
        expect(wrapper.get('[data-testid="phone-search-scope-folder"]').attributes('aria-pressed')).toBe('true');
        await flushPromises();
        expect(searchDocuments).toHaveBeenLastCalledWith({ query: 'in:"Projects/Q1 plans"', limit: 20 });
        expect(router.replace).toHaveBeenCalledWith({ query: { ...route.query, q: 'in:"Projects/Q1 plans"' } });
        expect(wrapper.get('[data-testid="phone-search-trash-n2"]').text()).toBe('In Trash');
        await wrapper.get('[data-testid="phone-search-more"]').trigger('click');
        await flushPromises();
        expect(wrapper.findAll('[data-testid^="phone-search-result-"]')).toHaveLength(3);
    });

    it('remembers what was typed, not the folder part it filled in itself', async () => {
        route.query = { scope: 'folder', folder: 'f2', dbKey: PERSONAL };
        const wrapper = mountIt(PhoneSearchPage);
        await flushPromises();
        vi.advanceTimersByTime(2500);
        expect(localStorage.getItem('panino-recent-searches')).toBeNull();
        await wrapper.get('[data-testid="phone-search-scope-titles"]').trigger('click');
        vi.advanceTimersByTime(2500);
        expect(localStorage.getItem('panino-recent-searches')).toBeNull();
        await wrapper.get('[data-testid="phone-search-input"]').setValue('in:"Projects/Q1 plans" budget');
        vi.advanceTimersByTime(2500);
        expect(JSON.parse(localStorage.getItem('panino-recent-searches'))).toEqual(['in:"Projects/Q1 plans" budget']);
    });

    it('turns words into title: with the Titles chip', async () => {
        route.query = { q: 'plan' };
        const wrapper = mountIt(PhoneSearchPage);
        await flushPromises();
        await wrapper.get('[data-testid="phone-search-scope-titles"]').trigger('click');
        expect(wrapper.get('[data-testid="phone-search-input"]').element.value).toBe('title:plan');
        expect(wrapper.find('[data-testid="phone-search-scope-folder"]').exists()).toBe(false);
    });
});
