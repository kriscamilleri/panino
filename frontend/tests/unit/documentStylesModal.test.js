// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';

const DB = 'user:a';
const PRESETS = [
  { id: 'v1', kind: 'preview', name: 'Manual', values: {} },
  { id: 'v2', kind: 'preview', name: 'Alt', values: {} },
  { id: 'p1', kind: 'print', name: 'Report', values: {} },
];

const h = vi.hoisted(() => ({}));

vi.mock('@/store/stylePresetStore', async () => {
  const { resolveStylePreset } = await import('@/utils/stylePresets');
  const { readDocumentStyleNames } = await import('@/utils/stylePresets');
  return {
    useStylePresetStore: () => ({
      loadLibrary: vi.fn(async () => {}),
      presetsFor: (dbKey, kind) => PRESETS.filter((p) => !kind || p.kind === kind),
      resolve: (kind, { content, folderTrail }) => ({
        ...resolveStylePreset({
          kind,
          documentStyleName: readDocumentStyleNames(content)[kind],
          folderTrail,
          presets: PRESETS,
          assignments: h.assignments,
        }),
      }),
    }),
  };
});
vi.mock('@/store/structureStore', () => ({ useStructureStore: () => h.structure }));
vi.mock('@/store/syncStore', () => ({
  useSyncStore: () => ({
    repository: () => ({ execute: async () => [{ content: h.dbContent, folder_id: 'child' }] }),
  }),
}));
vi.mock('@/store/docStore', () => ({ useDocStore: () => h.doc }));
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => h.draft }));
vi.mock('@/store/editorStore', () => ({ useEditorStore: () => h.editor }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast: (...a) => h.toasts.push(a) }) }));

const DocumentStylesModal = (await import('@/components/DocumentStylesModal.vue')).default;

const mounted = [];
function mountModal() {
  const wrapper = mount(DocumentStylesModal, {
    props: { show: true, dbKey: DB, fileId: 'n1', documentTitle: 'Q3' },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
async function pick(id, value) {
  const select = q(id);
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await flushPromises();
}

beforeEach(() => {
  h.assignments = new Map([['folder:parent:preview', 'v1']]);
  h.dbContent = '# Q3';
  h.toasts = [];
  h.structure = reactive({
    selectedFileId: null,
    selectedDbKey: null,
    getFolderTrail: vi.fn(async () => [{ id: 'parent', name: 'Reports' }, { id: 'child', name: 'Quarterly' }]),
  });
  h.doc = { updateFileContent: vi.fn(async () => {}) };
  h.draft = { getDraft: vi.fn(() => undefined), setDraft: vi.fn() };
  h.editor = reactive({ editorRef: null, transformText: vi.fn(), flushPendingSave: vi.fn(async () => {}) });
});

afterEach(() => {
  while (mounted.length) mounted.pop().unmount();
});

describe('DocumentStylesModal', () => {
  it('says which style is in use and where it comes from', async () => {
    mountModal();
    await flushPromises();
    expect(q('document-style-preview-in-use').textContent).toContain('Manual, from the folder Reports');
    expect(q('document-style-print-in-use').textContent).toContain('Default');
    expect(q('document-style-preview').options[0].textContent).toContain('Automatic: Manual (from Reports)');
  });

  it('writes the chosen style into a closed Document\'s front matter', async () => {
    mountModal();
    await flushPromises();
    await pick('document-style-print', 'Report');
    q('document-styles-save').click();
    await flushPromises();
    expect(h.doc.updateFileContent).toHaveBeenCalledWith('n1', '---\nprint-style: Report\n---\n\n# Q3', DB);
  });

  it('goes through the editor when the Document is open there', async () => {
    h.structure.selectedFileId = 'n1';
    h.structure.selectedDbKey = DB;
    h.editor.editorRef = {};
    h.draft.getDraft = vi.fn(() => '# Q3 draft');
    let result;
    h.editor.transformText = vi.fn((fn) => {
      result = fn({ value: '# Q3 draft', selectionStart: 4, selectionEnd: 4 });
      return true;
    });
    mountModal();
    await flushPromises();
    await pick('document-style-preview', 'Alt');
    q('document-styles-save').click();
    await flushPromises();
    expect(result.value).toBe('---\npreview-style: Alt\n---\n\n# Q3 draft');
    expect(result.selectionStart).toBe(4 + result.value.length - '# Q3 draft'.length);
    expect(h.editor.flushPendingSave).toHaveBeenCalled();
    expect(h.doc.updateFileContent).not.toHaveBeenCalled();
  });

  it('removes the line when Automatic is chosen', async () => {
    h.dbContent = '---\ntitle: X\npreview-style: Alt\n---\n# Q3';
    mountModal();
    await flushPromises();
    expect(q('document-style-preview').value).toBe('Alt');
    expect(q('document-style-preview-in-use').textContent).toContain('set on this Document');
    await pick('document-style-preview', '');
    q('document-styles-save').click();
    await flushPromises();
    expect(h.doc.updateFileContent).toHaveBeenCalledWith('n1', '---\ntitle: X\n---\n# Q3', DB);
  });

  it('keeps an unknown name unless the user picks something else', async () => {
    h.dbContent = '---\npreview-style: Gone\n---\n# Q3';
    mountModal();
    await flushPromises();
    expect(q('document-style-preview-in-use').textContent).toContain('"Gone" is not a style in this library');
    q('document-styles-save').click();
    await flushPromises();
    expect(h.doc.updateFileContent).not.toHaveBeenCalled();
  });

  it('says so when the open editor refuses the change', async () => {
    h.structure.selectedFileId = 'n1';
    h.structure.selectedDbKey = DB;
    h.editor.editorRef = {};
    h.editor.transformText = vi.fn((fn) => { fn({ value: '# Q3', selectionStart: 0, selectionEnd: 0 }); return false; });
    mountModal();
    await flushPromises();
    await pick('document-style-print', 'Report');
    q('document-styles-save').click();
    await flushPromises();
    expect(h.toasts.some(([text]) => /cannot be changed/.test(text))).toBe(true);
  });
});
