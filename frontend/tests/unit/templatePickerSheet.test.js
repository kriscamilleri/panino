// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

const templateStore = reactive({
  templates: [{ id: 'tpl-1', name: 'Meeting notes', content: '', titlePattern: '', updatedAt: null }],
  isLoading: false,
  error: '',
  loadTemplates: vi.fn(async () => {}),
});

vi.mock('@/store/templateStore', () => ({ useTemplateStore: () => templateStore }));
const structureStore = {
  createFile: vi.fn(async () => ({ id: 'doc-1', dbKey: 'user:a' })),
  loadRootItems: vi.fn(async () => {}),
};
vi.mock('@/store/structureStore', () => ({ useStructureStore: () => structureStore }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => ({}) }));

const TemplatePickerModal = (await import('@/components/TemplatePickerModal.vue')).default;
const BottomSheet = (await import('@/components/phone/BottomSheet.vue')).default;

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().unmount();
  vi.clearAllMocks();
});

function mountSheet(props) {
  const wrapper = mount(TemplatePickerModal, {
    props: { databaseKey: 'user:a', sheet: true, open: false, ...props },
    global: { stubs: { transition: false } },
  });
  mounted.push(wrapper);
  return wrapper;
}

describe('TemplatePickerModal as a phone sheet', () => {
  it('stays mounted while closed and preloads templates for the first opening', () => {
    const wrapper = mountSheet();
    expect(wrapper.find('[data-testid="template-picker-modal"]').exists()).toBe(false);
    expect(templateStore.loadTemplates).toHaveBeenCalledWith('user:a');
  });

  it('opens as a bottom sheet with the template list and its actions', async () => {
    const wrapper = mountSheet();
    await wrapper.setProps({ open: true });
    await nextTick();
    const sheet = wrapper.find('[data-testid="template-picker-modal"]');
    expect(sheet.find('.ph-sheet-panel').exists()).toBe(true);
    expect(sheet.text()).toContain('New Document from Template');
    expect(sheet.find('[data-testid="template-picker-radio-tpl-1"]').exists()).toBe(true);
    expect(sheet.find('[data-testid="template-picker-use"]').exists()).toBe(true);
  });

  it('keeps the list in place while refreshing, instead of swapping in a loading message', async () => {
    templateStore.isLoading = true;
    const wrapper = mountSheet({ open: true });
    await nextTick();
    expect(wrapper.text()).not.toContain('Loading templates');
    expect(wrapper.text()).toContain('Meeting notes');
    templateStore.isLoading = false;
  });

  it('still renders the centered desktop dialog without the sheet prop', () => {
    const wrapper = mount(TemplatePickerModal, { props: { databaseKey: 'user:a' } });
    mounted.push(wrapper);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.find('.ph-sheet-panel').exists()).toBe(false);
    expect(wrapper.find('[data-testid="template-picker-close"]').exists()).toBe(true);
    expect(templateStore.loadTemplates).toHaveBeenCalledWith('user:a');
  });

  it('creates one note however often Use Template is tapped while the sheet closes', async () => {
    const wrapper = mountSheet({ open: true });
    await nextTick();
    const use = wrapper.find('[data-testid="template-picker-use"]');
    await use.trigger('click');
    await use.trigger('click');
    await new Promise((resolve) => setTimeout(resolve));
    expect(structureStore.createFile).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('created')).toEqual([[{ id: 'doc-1', dbKey: 'user:a' }]]);
    expect(use.attributes('disabled')).toBeDefined();

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    expect(wrapper.find('[data-testid="template-picker-use"]').attributes('disabled')).toBeUndefined();
  });

  it('reports when the sheet has finished sliding away, so the parent can navigate then', async () => {
    const wrapper = mountSheet({ open: true });
    wrapper.findComponent(BottomSheet).vm.$emit('closed');
    expect(wrapper.emitted('closed')).toHaveLength(1);
  });
});
