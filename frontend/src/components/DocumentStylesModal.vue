<template>
  <!--
    Which preview and print style a Document uses, and where that comes from.
    Choosing one writes `preview-style:` / `print-style:` into its front
    matter; "Automatic" removes the line so the folder or Default applies.
  -->
  <BaseModal
    :show="show"
    :title="`Document styles: ${documentTitle}`"
    size="sm"
    close-testid="document-styles-close"
    @close="$emit('close')"
  >
    <div class="space-y-4">
      <div
        v-for="kind in KINDS"
        :key="kind.value"
        class="space-y-1"
      >
        <label
          :for="`document-style-${kind.value}`"
          class="pn-label"
        >{{ kind.label }}</label>
        <select
          :id="`document-style-${kind.value}`"
          v-model="choice[kind.value]"
          class="pn-select"
          :disabled="loading"
          :data-testid="`document-style-${kind.value}`"
        >
          <option value="">Automatic: {{ automaticLabel(kind.value) }}</option>
          <option
            v-for="preset in stylePresetStore.presetsFor(dbKey, kind.value)"
            :key="preset.id"
            :value="preset.name"
          >
            {{ preset.name }}
          </option>
        </select>
        <p
          v-if="!loading"
          class="text-sm text-gray-600"
          :data-testid="`document-style-${kind.value}-in-use`"
        >
          {{ inUseText(kind.value) }}
        </p>
      </div>
      <p
        v-if="!loading && !hasPresets"
        class="text-sm text-gray-500"
      >
        This library has no named styles yet. Save one from Markdown Styles or Print Styles.
      </p>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        size="md"
        data-testid="document-styles-cancel"
        @click="$emit('close')"
      >
        Cancel
      </BaseButton>
      <BaseButton
        variant="primary"
        size="md"
        :disabled="saving || loading"
        data-testid="document-styles-save"
        @click="save"
      >
        Save
      </BaseButton>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import BaseButton from './BaseButton.vue';
import { useStylePresetStore } from '@/store/stylePresetStore';
import { useStructureStore } from '@/store/structureStore';
import { useSyncStore } from '@/store/syncStore';
import { useDocStore } from '@/store/docStore';
import { useDraftStore } from '@/store/draftStore';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import {
  normalizeStyleName,
  readDocumentStyleNames,
  writeDocumentStyleNames,
} from '@/utils/stylePresets';

const KINDS = [
  { value: 'preview', label: 'Preview style' },
  { value: 'print', label: 'Print style' },
];

const props = defineProps({
  show: { type: Boolean, default: false },
  dbKey: { type: String, required: true },
  fileId: { type: String, required: true },
  documentTitle: { type: String, default: '' },
});

const emit = defineEmits(['close']);

const stylePresetStore = useStylePresetStore();
const structureStore = useStructureStore();
const syncStore = useSyncStore();
const docStore = useDocStore();
const draftStore = useDraftStore();
const editorStore = useEditorStore();
const uiStore = useUiStore();

const loading = ref(true);
const saving = ref(false);
/** Style name per kind as the select shows it; '' is Automatic. */
const choice = reactive({ preview: '', print: '' });
/** What the front matter said when the dialog opened. */
const original = reactive({ preview: '', print: '' });
/** What each select showed when the dialog opened. */
const shown = reactive({ preview: '', print: '' });
const content = ref('');
/** Folders above the Document, its own folder first: `{ id, name }`. */
const trail = ref([]);

const hasPresets = computed(() => stylePresetStore.presetsFor(props.dbKey).length > 0);
const isOpenInEditor = computed(() => (
  structureStore.selectedFileId === props.fileId
  && structureStore.selectedDbKey === props.dbKey
  && Boolean(editorStore.editorRef)
));

/** The Document's text as the user sees it: an unsaved draft first. */
async function currentText() {
  const draft = draftStore.getDraft(props.fileId);
  if (draft !== undefined && draft !== null) return { text: draft, folderId: await folderOf() };
  const rows = await syncStore.repository(props.dbKey).execute(
    'SELECT content, folder_id FROM notes WHERE id = ?',
    [props.fileId],
  );
  return { text: rows?.[0]?.content || '', folderId: rows?.[0]?.folder_id || null };
}

async function folderOf() {
  const rows = await syncStore.repository(props.dbKey).execute('SELECT folder_id FROM notes WHERE id = ?', [props.fileId]);
  return rows?.[0]?.folder_id || null;
}

watch(
  () => props.show,
  async (visible) => {
    if (!visible) return;
    loading.value = true;
    try {
      await stylePresetStore.loadLibrary(props.dbKey);
      const { text, folderId } = await currentText();
      content.value = text;
      trail.value = folderId ? (await structureStore.getFolderTrail(folderId, props.dbKey)).reverse() : [];
      const names = readDocumentStyleNames(text);
      for (const { value } of KINDS) {
        original[value] = names[value];
        // Show the style's own spelling; an unknown name shows as Automatic.
        const match = stylePresetStore.presetsFor(props.dbKey, value)
          .find((p) => normalizeStyleName(p.name).toLowerCase() === normalizeStyleName(names[value]).toLowerCase());
        choice[value] = match ? match.name : '';
        shown[value] = choice[value];
      }
    } catch (err) {
      console.error('[DocumentStylesModal] Failed to read the Document', err);
      uiStore.addToast('Could not read this Document\'s styles.', 'error');
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

/** The style used when the Document names none: its folder's, else Default. */
function fromFolders(kind) {
  return stylePresetStore.resolve(kind, {
    dbKey: props.dbKey,
    content: '',
    folderTrail: trail.value.map((f) => f.id),
  });
}

function automaticLabel(kind) {
  const resolved = fromFolders(kind);
  if (!resolved.preset) return 'Default';
  const folder = trail.value.find((f) => f.id === resolved.folderId);
  return `${resolved.preset.name} (from ${folder?.name || 'folder'})`;
}

function inUseText(kind) {
  const resolved = stylePresetStore.resolve(kind, {
    dbKey: props.dbKey,
    content: content.value,
    folderTrail: trail.value.map((f) => f.id),
  });
  if (resolved.source === 'document') return `In use: ${resolved.preset.name}, set on this Document.`;
  const unknown = original[kind]
    ? `"${original[kind]}" is not a style in this library. `
    : '';
  if (resolved.source === 'folder') {
    const folder = trail.value.find((f) => f.id === resolved.folderId);
    return `${unknown}In use: ${resolved.preset.name}, from the folder ${folder?.name || ''}.`.trim();
  }
  return `${unknown}In use: Default.`;
}

/**
 * Only kinds whose select was changed are written, so an unknown name in the
 * front matter stays until the user picks something else.
 */
function changedNames() {
  const changes = {};
  for (const { value } of KINDS) {
    if (choice[value] !== shown[value]) changes[value] = choice[value];
  }
  return changes;
}

async function save() {
  const changes = changedNames();
  if (Object.keys(changes).length === 0) {
    emit('close');
    return;
  }
  saving.value = true;
  try {
    if (isOpenInEditor.value) {
      // Through the editor, like any other edit, so drafts and live sessions stay in step.
      let expected = false;
      const changed = editorStore.transformText((state) => {
        const value = writeDocumentStyleNames(state.value, changes);
        expected = value !== state.value;
        const shift = value.length - state.value.length;
        return {
          value,
          selectionStart: Math.max(0, state.selectionStart + shift),
          selectionEnd: Math.max(0, state.selectionEnd + shift),
        };
      }, { focus: false });
      if (expected && !changed) {
        uiStore.addToast('This Document cannot be changed right now.', 'warning');
        return;
      }
      if (changed) await editorStore.flushPendingSave();
    } else {
      const { text } = await currentText();
      const next = writeDocumentStyleNames(text, changes);
      if (next !== text) {
        await docStore.updateFileContent(props.fileId, next, props.dbKey);
        if (draftStore.getDraft(props.fileId) !== undefined) draftStore.setDraft(props.fileId, next);
      }
    }
    uiStore.addToast('Document styles saved.', 'success');
    emit('close');
  } catch (err) {
    console.error('[DocumentStylesModal] Failed to save Document styles', err);
    uiStore.addToast('Failed to save Document styles.', 'error');
  } finally {
    saving.value = false;
  }
}
</script>
