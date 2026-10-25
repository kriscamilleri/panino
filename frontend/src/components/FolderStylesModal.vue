<template>
  <!-- A folder's default preview and print styles, inherited by its subfolders. -->
  <BaseModal
    :show="show"
    :title="`Document styles: ${folderName}`"
    size="sm"
    close-testid="folder-styles-close"
    @close="$emit('close')"
  >
    <div class="space-y-4">
      <p class="text-sm text-gray-600">
        Documents in this folder and its subfolders use these styles unless their front matter
        names another.
      </p>
      <div
        v-for="kind in KINDS"
        :key="kind.value"
        class="space-y-1"
      >
        <label
          :for="`folder-style-${kind.value}`"
          class="pn-label"
        >{{ kind.label }}</label>
        <select
          :id="`folder-style-${kind.value}`"
          v-model="choice[kind.value]"
          class="pn-select"
          :disabled="loading"
          :data-testid="`folder-style-${kind.value}`"
        >
          <option value="">None (use the parent folder or Default)</option>
          <option
            v-for="preset in stylePresetStore.presetsFor(dbKey, kind.value)"
            :key="preset.id"
            :value="preset.id"
          >
            {{ preset.name }}
          </option>
        </select>
      </div>
      <p
        v-if="!hasPresets"
        class="text-sm text-gray-500"
        data-testid="folder-styles-empty"
      >
        This library has no named styles yet. Save one from Markdown Styles or Print Styles.
      </p>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        size="md"
        data-testid="folder-styles-cancel"
        @click="$emit('close')"
      >
        Cancel
      </BaseButton>
      <BaseButton
        variant="primary"
        size="md"
        :disabled="saving || loading"
        data-testid="folder-styles-save"
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
import { useUiStore } from '@/store/uiStore';

const KINDS = [
  { value: 'preview', label: 'Preview style' },
  { value: 'print', label: 'Print style' },
];

const props = defineProps({
  show: { type: Boolean, default: false },
  dbKey: { type: String, required: true },
  folderId: { type: String, required: true },
  folderName: { type: String, default: '' },
});

const emit = defineEmits(['close']);

const stylePresetStore = useStylePresetStore();
const uiStore = useUiStore();
const choice = reactive({ preview: '', print: '' });
const saving = ref(false);
// The current defaults are read after opening; until then a choice would be overwritten.
const loading = ref(true);

const hasPresets = computed(() => stylePresetStore.presetsFor(props.dbKey).length > 0);

watch(
  () => props.show,
  async (visible) => {
    if (!visible) return;
    loading.value = true;
    try {
      await stylePresetStore.loadLibrary(props.dbKey);
    } catch (err) {
      console.warn('[FolderStylesModal] Failed to load styles', err);
    }
    for (const { value } of KINDS) {
      choice[value] = stylePresetStore.assignmentFor(props.dbKey, 'folder', props.folderId, value) || '';
    }
    loading.value = false;
  },
  { immediate: true },
);

async function save() {
  saving.value = true;
  try {
    for (const { value } of KINDS) {
      const current = stylePresetStore.assignmentFor(props.dbKey, 'folder', props.folderId, value) || '';
      if (current === choice[value]) continue;
      await stylePresetStore.setAssignment(props.dbKey, 'folder', props.folderId, value, choice[value] || null);
    }
    await stylePresetStore.refreshSelectedTrail();
    uiStore.addToast('Folder styles saved.', 'success');
    emit('close');
  } catch (err) {
    console.error('[FolderStylesModal] Failed to save folder styles', err);
    uiStore.addToast('Failed to save folder styles.', 'error');
  } finally {
    saving.value = false;
  }
}
</script>
