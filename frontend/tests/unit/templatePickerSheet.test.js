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
vi.mock('@/store/structureStore', () => ({ useStructureStore: () => ({}) }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => ({}) }));

const TemplatePickerModal = (await import('@/components/TemplatePickerModal.vue')).default;

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
});
