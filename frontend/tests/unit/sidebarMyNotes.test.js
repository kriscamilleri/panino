// @vitest-environment jsdom
// Spaces in the sidebar: once there is a space, personal Documents sit under a
// collapsible My Notes group, on desktop (Documents.vue) and in the phone Drawer,
// and the phone Drawer lists each space as a collapsible group of its folders.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';

const PERSONAL = 'user:11111111-1111-4111-8111-111111111111';
const SPACE = 'space:22222222-2222-4222-8222-222222222222';

const router = { push: vi.fn(), replace: vi.fn() };
const route = reactive({ name: 'home', params: {}, query: {} });
const syncStore = reactive({
  personalDbKey: PERSONAL,
  databases: new Map(),
  bootstrapState: { status: 'ready', completed: 0, total: 0, error: null },
});
const openFolders = reactive(new Set());
const docStore = reactive({
  rootItems: [],
  contentVersion: 0,
  selectedFileId: null,
  selectedFolderId: null,
  selectedFile: null,
  syncStore,
  isFolderOpen: (id, dbKey) => openFolders.has(`${dbKey}:${id}`),
  toggleFolder: vi.fn((id, dbKey) => {
    const key = `${dbKey}:${id}`;
    if (openFolders.has(key)) openFolders.delete(key);
    else openFolders.add(key);
  }),
  getChildren: vi.fn(async () => []),
  loadRootItems: vi.fn(async () => {}),
  selectFolder: vi.fn(),
  selectFile: vi.fn(),
  listFolders: vi.fn(async (dbKey) => (dbKey === PERSONAL
    ? [{ id: 'f-mine', name: 'Recipes', parentId: null, dbKey }]
    : [
      { id: 'f-team', name: 'Team notes', parentId: null, dbKey },
      { id: 'f-nested', name: 'Nested', parentId: 'f-team', dbKey },
    ])),
});
const ui = reactive({
  myNotesCollapsed: false,
  toggleMyNotesCollapsed: vi.fn(() => { ui.myNotesCollapsed = !ui.myNotesCollapsed; }),
  addToast: vi.fn(),
});

vi.mock('vue-router', () => ({ useRouter: () => router, useRoute: () => route }));
vi.mock('@/store/docStore', () => ({ useDocStore: () => docStore }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => syncStore }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ui }));
vi.mock('@/store/structureStore', () => ({
  useStructureStore: () => ({ selectedFolderId: null, selectedDbKey: null, moveItem: vi.fn() }),
}));
vi.mock('@/store/spaceTransferStore', () => ({
  useSpaceTransferStore: () => ({ begin: vi.fn(), recoverable: [], loadRecoverable: vi.fn() }),
}));
vi.mock('@/store/conflictStore', () => ({ useConflictStore: () => ({ hasConflict: () => false }) }));
vi.mock('@/composables/usePhoneStatus', () => ({
  usePhoneStatus: () => ({ sync: { state: 'synced', detail: 'Synced' } }),
}));

const Documents = (await import('@/components/Documents.vue')).default;
const PhoneDrawer = (await import('@/components/phone/PhoneDrawer.vue')).default;

const personalFile = { id: 'doc-1', treeKey: 'doc-1', type: 'file', name: 'Shopping list', dbKey: PERSONAL };
const spaceRoot = { id: SPACE, treeKey: SPACE, type: 'space', name: 'Writers', dbKey: SPACE, members: [], status: 'ready' };

function haveSpace(yes) {
  syncStore.databases = new Map(yes
    ? [[PERSONAL, { dbKey: PERSONAL, kind: 'user' }], [SPACE, { dbKey: SPACE, kind: 'space', name: 'Writers', role: 'owner' }]]
    : [[PERSONAL, { dbKey: PERSONAL, kind: 'user' }]]);
  docStore.rootItems = yes ? [personalFile, spaceRoot] : [personalFile];
}

const mounted = [];
const mountIt = (component, options) => {
  const wrapper = mount(component, { ...options, global: { stubs: { Transition: false, PromptModal: true } } });
  mounted.push(wrapper);
  return wrapper;
};

beforeEach(() => {
  ui.myNotesCollapsed = false;
  openFolders.clear();
  route.name = 'home';
  route.params = {};
});

afterEach(() => {
  while (mounted.length) mounted.pop().unmount();
  vi.clearAllMocks();
});

describe('desktop sidebar My Notes', () => {
  it('lists personal items at the top level while there is no space', () => {
    haveSpace(false);
    const wrapper = mountIt(Documents);
    expect(wrapper.find('[data-testid="documents-my-notes"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="tree-item-file-doc-1"]').exists()).toBe(true);
  });

  it('puts personal items under My Notes, above the spaces, and collapses them', async () => {
    haveSpace(true);
    const wrapper = mountIt(Documents);
    const myNotes = wrapper.get('[data-testid="documents-my-notes"]');
    expect(myNotes.text()).toContain('My Notes');
    expect(myNotes.find('[data-testid="tree-item-file-doc-1"]').exists()).toBe(true);
    expect(myNotes.find(`[data-testid="tree-item-folder-${SPACE}"]`).exists()).toBe(false);
    const html = wrapper.html();
    expect(html.indexOf('documents-my-notes')).toBeLessThan(html.indexOf(`tree-item-folder-${SPACE}`));

    const toggle = wrapper.get('[data-testid="documents-my-notes-toggle"]');
    expect(toggle.attributes('aria-expanded')).toBe('true');
    await toggle.trigger('click');
    expect(ui.toggleMyNotesCollapsed).toHaveBeenCalledOnce();
    expect(toggle.attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[data-testid="tree-item-file-doc-1"]').exists()).toBe(false);
    expect(wrapper.find(`[data-testid="tree-item-folder-${SPACE}"]`).exists()).toBe(true);
  });
});

describe('phone Drawer spaces', () => {
  it('keeps the plain Folders list while there is no space', async () => {
    haveSpace(false);
    const wrapper = mountIt(PhoneDrawer, { props: { open: true } });
    await flushPromises();
    expect(wrapper.find('[data-testid="phone-drawer-my-notes"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="phone-drawer-folder-f-mine"]').exists()).toBe(true);
  });

  it('shows My Notes and each space as groups; My Notes collapses', async () => {
    haveSpace(true);
    const wrapper = mountIt(PhoneDrawer, { props: { open: true } });
    await flushPromises();
    expect(wrapper.get('[data-testid="phone-drawer-my-notes"]').text()).toBe('My Notes');
    expect(wrapper.find('[data-testid="phone-drawer-folder-f-mine"]').exists()).toBe(true);
    expect(wrapper.get(`[data-testid="phone-drawer-space-${SPACE}"]`).text()).toBe('Writers');

    await wrapper.get('[data-testid="phone-drawer-my-notes"]').trigger('click');
    expect(ui.toggleMyNotesCollapsed).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="phone-drawer-folder-f-mine"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="phone-drawer-new-folder"]').exists()).toBe(false);
  });

  it('opens a space from its name, and expands its top-level folders from the chevron', async () => {
    haveSpace(true);
    const wrapper = mountIt(PhoneDrawer, { props: { open: true } });
    await flushPromises();
    expect(wrapper.find(`[data-testid="phone-drawer-space-folders-${SPACE}"]`).exists()).toBe(false);

    await wrapper.get(`[data-testid="phone-drawer-space-${SPACE}"]`).trigger('click');
    expect(router.replace).toHaveBeenCalledWith({ name: 'folder', params: { folderId: SPACE }, query: { dbKey: SPACE } });

    const chevron = wrapper.get(`[data-testid="phone-drawer-space-toggle-${SPACE}"]`);
    expect(chevron.attributes('aria-expanded')).toBe('false');
    await chevron.trigger('click');
    expect(docStore.toggleFolder).toHaveBeenCalledWith(SPACE, SPACE);
    await flushPromises();
    expect(chevron.attributes('aria-expanded')).toBe('true');
    const folders = wrapper.get(`[data-testid="phone-drawer-space-folders-${SPACE}"]`);
    expect(folders.find('[data-testid="phone-drawer-folder-f-team"]').exists()).toBe(true);
    expect(folders.find('[data-testid="phone-drawer-folder-f-nested"]').exists()).toBe(false);

    await folders.get('[data-testid="phone-drawer-folder-f-team"]').trigger('click');
    expect(router.replace).toHaveBeenLastCalledWith({ name: 'folder', params: { folderId: 'f-team' }, query: { dbKey: SPACE } });
  });
});
