// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import MarkdownIt from 'markdown-it';
import { createPinia, defineStore } from 'pinia';

const md = new MarkdownIt();
const store = vi.hoisted(() => ({
    createFile: vi.fn(),
    updateFileContent: vi.fn(),
    renameItem: vi.fn(),
    moveItem: vi.fn(),
    deleteItem: vi.fn(),
    createFolder: vi.fn(),
    listFolders: vi.fn(),
}));

// Preview reads the doc store through storeToRefs, so it must be a real store.
vi.mock('@/store/docStore', () => ({
    useDocStore: defineStore('doc', {
        state: () => ({ selectedFile: null, selectedFileContent: '' }),
        actions: {
            getMarkdownIt: () => md,
            listFolders: (...args) => store.listFolders(...args),
            createFile: (...args) => store.createFile(...args),
            updateFileContent: (...args) => store.updateFileContent(...args),
            renameItem: (...args) => store.renameItem(...args),
            moveItem: (...args) => store.moveItem(...args),
            deleteItem: (...args) => store.deleteItem(...args),
            createFolder: (...args) => store.createFolder(...args),
        },
    }),
}));
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => ({ getDraft: () => null }) }));
vi.mock('@/store/markdownStore', () => ({ useMarkdownStore: () => ({ applyMetadataVariables: (text) => text }) }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => ({ personalDbKey: 'personal' }) }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast: () => {} }) }));

const { default: QuickCaptureSheet } = await import('@/components/phone/QuickCaptureSheet.vue');

const SheetStub = {
    props: ['open'],
    template: '<div v-if="open"><slot name="header" /><slot /><slot name="footer" /></div>',
};

const mounted = [];
function mountSheet(props = {}) {
    const wrapper = mount(QuickCaptureSheet, {
        props: { open: true, defaultDestination: { dbKey: 'personal', folderId: null, label: 'No folder' }, ...props },
        global: { plugins: [createPinia()], stubs: { BottomSheet: SheetStub, BaseModal: true, BaseButton: true, PromptModal: true } },
        attachTo: document.body,
    });
    mounted.push(wrapper);
    return wrapper;
}

beforeEach(() => {
    store.createFile.mockResolvedValue({ id: 'doc-1' });
    store.listFolders.mockResolvedValue([]);
    store.createFolder.mockResolvedValue({ id: 'folder-new' });
    for (const fn of [store.updateFileContent, store.renameItem, store.moveItem, store.deleteItem]) fn.mockResolvedValue();
});

afterEach(() => {
    while (mounted.length) mounted.pop().unmount();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('QuickCaptureSheet', () => {
    it('offers Edit and Preview, not a Checklist type', () => {
        const wrapper = mountSheet();
        const labels = wrapper.findAll('[role="group"] button').map((button) => button.text());
        expect(labels).toEqual(['Edit', 'Preview']);
    });

    it('renders the unsaved draft in Preview and hides the fields and keys', async () => {
        const wrapper = mountSheet();
        await wrapper.find('[data-testid="phone-capture-title"]').setValue('Groceries');
        await wrapper.find('[data-testid="phone-capture-body"]').setValue('- **milk**');
        await wrapper.findAll('[role="group"] button')[1].trigger('click');
        await nextTick();

        const preview = wrapper.find('[data-testid="phone-capture-preview"]');
        expect(preview.find('h1').text()).toBe('Groceries');
        expect(preview.find('strong').text()).toBe('milk');
        expect(wrapper.find('[data-testid="phone-capture-body"]').isVisible()).toBe(false);
        expect(wrapper.find('[data-testid="phone-key-bold"]').exists()).toBe(false);
    });

    it('shows a placeholder when there is nothing to preview', async () => {
        const wrapper = mountSheet();
        await wrapper.findAll('[role="group"] button')[1].trigger('click');
        expect(wrapper.find('[data-testid="phone-capture-preview"]').text()).toBe('Nothing to preview yet.');
    });

    it('still starts a checklist with an empty box when opened from the checklist button', () => {
        const wrapper = mountSheet({ initialKind: 'checklist' });
        expect(wrapper.find('[data-testid="phone-capture-body"]').element.value).toBe('- [ ] ');
    });

    it('creates the note as soon as the body has text, titled from its first three words', async () => {
        const wrapper = mountSheet();
        await wrapper.find('[data-testid="phone-capture-body"]').setValue('C');
        await flushPromises();
        expect(store.createFile).toHaveBeenCalledWith('personal', 'C', null, { content: 'C\n' });
        expect(wrapper.find('[data-testid="phone-capture-status"]').text()).toBe('Saved');
    });

    it('does not create a note for a title alone until the sheet closes', async () => {
        const wrapper = mountSheet();
        await wrapper.find('[data-testid="phone-capture-title"]').setValue('Idea');
        await flushPromises();
        expect(store.createFile).not.toHaveBeenCalled();

        await wrapper.find('[data-testid="phone-capture-done"]').trigger('click');
        await flushPromises();
        expect(store.createFile).toHaveBeenCalledWith('personal', 'Idea', null, { content: '# Idea\n\n' });
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('keeps the saved note up to date after a pause in typing', async () => {
        vi.useFakeTimers();
        const wrapper = mountSheet();
        const bodyField = wrapper.find('[data-testid="phone-capture-body"]');
        await bodyField.setValue('B');
        await flushPromises();
        await bodyField.setValue('Buy milk and eggs');
        expect(store.updateFileContent).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(500);
        expect(store.createFile).toHaveBeenCalledTimes(1);
        expect(store.renameItem).toHaveBeenCalledWith('doc-1', 'Buy milk and', 'file', 'personal');
        expect(store.updateFileContent).toHaveBeenCalledWith('doc-1', 'Buy milk and eggs\n', 'personal');
    });

    it('prefers a typed title and writes it as the heading', async () => {
        vi.useFakeTimers();
        const wrapper = mountSheet();
        await wrapper.find('[data-testid="phone-capture-body"]').setValue('Call Sam');
        await flushPromises();
        await wrapper.find('[data-testid="phone-capture-title"]').setValue('Lease');
        await vi.advanceTimersByTimeAsync(500);
        expect(store.renameItem).toHaveBeenCalledWith('doc-1', 'Lease', 'file', 'personal');
        expect(store.updateFileContent).toHaveBeenCalledWith('doc-1', '# Lease\n\nCall Sam\n', 'personal');
    });

    it('writes the last keystrokes on Done without waiting for the pause', async () => {
        vi.useFakeTimers();
        const wrapper = mountSheet();
        const bodyField = wrapper.find('[data-testid="phone-capture-body"]');
        await bodyField.setValue('a');
        await flushPromises();
        await bodyField.setValue('a b');
        await wrapper.find('[data-testid="phone-capture-done"]').trigger('click');
        await flushPromises();
        expect(store.updateFileContent).toHaveBeenCalledWith('doc-1', 'a b\n', 'personal');
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('stays open when the note could not be saved', async () => {
        store.createFile.mockRejectedValue(new Error('disk full'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const wrapper = mountSheet();
        await wrapper.find('[data-testid="phone-capture-body"]').setValue('Keep me');
        await wrapper.find('[data-testid="phone-capture-done"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="phone-capture-status"]').text()).toBe('Not saved');
        expect(wrapper.emitted('close')).toBeUndefined();
    });

    it('deletes the saved note when it is discarded or emptied', async () => {
        const wrapper = mountSheet();
        await wrapper.find('[data-testid="phone-capture-body"]').setValue('Oops');
        await flushPromises();
        await wrapper.vm.$.setupState.discard();
        await flushPromises();
        expect(store.deleteItem).toHaveBeenCalledWith('doc-1', 'file', 'personal');
        expect(wrapper.emitted('close')).toHaveLength(1);

        const emptied = mountSheet();
        await emptied.find('[data-testid="phone-capture-body"]').setValue('Gone');
        await flushPromises();
        await emptied.find('[data-testid="phone-capture-body"]').setValue('');
        await emptied.find('[data-testid="phone-capture-done"]').trigger('click');
        await flushPromises();
        expect(store.deleteItem).toHaveBeenCalledTimes(2);
        expect(store.updateFileContent).not.toHaveBeenCalled();
    });

    it('moves the saved note to a folder picked afterwards', async () => {
        store.listFolders.mockResolvedValue([{ id: 'f-1', name: 'Work', path: 'Work', dbKey: 'personal' }]);
        const wrapper = mountSheet();
        await wrapper.find('[data-testid="phone-capture-body"]').setValue('Report');
        await flushPromises();
        await wrapper.find('[data-testid="phone-capture-destination"]').trigger('click');
        await flushPromises();
        await wrapper.findAll('[data-testid="phone-capture-destinations"] li button')[1].trigger('click');
        await wrapper.find('[data-testid="phone-capture-done"]').trigger('click');
        await flushPromises();
        expect(store.moveItem).toHaveBeenCalledWith('doc-1', 'f-1', 'file', 'personal', 'personal');
    });

    it('creates a new folder from the destination list and saves into it', async () => {
        const wrapper = mountSheet();
        await wrapper.find('[data-testid="phone-capture-destination"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="phone-capture-new-folder"]').exists()).toBe(true);
        wrapper.vm.$.setupState.newFolderName = 'Recipes';
        await wrapper.vm.$.setupState.createFolder();
        await wrapper.find('[data-testid="phone-capture-body"]').setValue('Pancakes');
        await flushPromises();
        expect(store.createFolder).toHaveBeenCalledWith('personal', 'Recipes', null);
        expect(store.createFile).toHaveBeenCalledWith('personal', 'Pancakes', 'folder-new', { content: 'Pancakes\n' });
        expect(wrapper.find('[data-testid="phone-capture-destination"]').text()).toContain('Recipes');
    });
});
