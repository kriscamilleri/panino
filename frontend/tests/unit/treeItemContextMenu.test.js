// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

const docStore = reactive({
  openFolders: new Set(),
  selectedFileId: null,
  selectedFolderId: null,
  selectedFile: null,
  isFolderOpen: vi.fn(() => false),
  getChildren: vi.fn(async () => []),
});

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/store/docStore', () => ({ useDocStore: () => docStore }));
vi.mock('@/store/structureStore', () => ({
  useStructureStore: () => reactive({ selectedFolderId: null, selectedDbKey: null, moveItem: vi.fn() }),
}));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => reactive({ bootstrapState: null }) }));
vi.mock('@/store/conflictStore', () => ({
  useConflictStore: () => ({ hasConflict: () => false }),
}));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast: vi.fn() }) }));

const TreeItem = (await import('@/components/TreeItem.vue')).default;

const MENU_WIDTH = 160;
const MENU_HEIGHT = 200;

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().unmount();
  vi.restoreAllMocks();
});

async function openMenuAt(clientX, clientY) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: MENU_WIDTH, height: MENU_HEIGHT, top: 0, left: 0, right: 0, bottom: 0,
  });
  const item = { id: 'folder-1', dbKey: 'user:a', type: 'folder', name: 'Cultivation' };
  const wrapper = mount(TreeItem, { props: { item }, attachTo: document.body });
  mounted.push(wrapper);
  await wrapper.find('[data-testid="tree-item-folder-menu-folder-1"]')
    .trigger('click', { clientX, clientY });
  await nextTick();
  await nextTick();
  return document.body.querySelector('[data-testid="tree-item-context-menu-folder-1"]');
}

describe('TreeItem context menu', () => {
  it('renders outside the clipping sidebar, at the pointer when there is room', async () => {
    window.innerWidth = 1280;
    window.innerHeight = 800;
    const menu = await openMenuAt(250, 100);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.left).toBe('250px');
    expect(menu.style.top).toBe('100px');
  });

  it('flips above and left of the pointer near the bottom-right edge', async () => {
    window.innerWidth = 1280;
    window.innerHeight = 800;
    const menu = await openMenuAt(1250, 750);
    expect(menu.style.left).toBe(`${1250 - MENU_WIDTH}px`);
    expect(menu.style.top).toBe(`${750 - MENU_HEIGHT}px`);
  });
});
