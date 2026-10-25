<template>
  <!--
    Choose which style the page edits — the library Default or a named
    style — and save, rename or delete named styles.
  -->
  <div
    class="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
    data-testid="style-preset-bar"
  >
    <div class="flex flex-wrap items-end gap-2">
      <div class="min-w-[12rem] flex-1">
        <label
          :for="selectId"
          class="pn-label"
        >Style<span
          v-if="libraryName"
          class="font-normal text-gray-500"
        > · {{ libraryName }}</span></label>
        <select
          :id="selectId"
          class="pn-select"
          :value="modelValue"
          data-testid="style-preset-select"
          @change="$emit('update:modelValue', $event.target.value)"
        >
          <option value="">Default</option>
          <option
            v-for="preset in presets"
            :key="preset.id"
            :value="preset.id"
          >
            {{ preset.name }}
          </option>
        </select>
      </div>
      <div class="flex flex-wrap gap-2">
        <BaseButton
          variant="secondary"
          data-testid="style-preset-save-as"
          :disabled="!dbKey"
          @click="openPrompt('create')"
        >
          <CopyPlus class="h-4 w-4" />
          <span>Save as new style</span>
        </BaseButton>
        <BaseButton
          v-if="selected"
          data-testid="style-preset-rename"
          @click="openPrompt('rename')"
        >
          <Edit class="h-4 w-4" />
          <span>Rename</span>
        </BaseButton>
        <BaseButton
          v-if="selected"
          variant="danger"
          data-testid="style-preset-delete"
          @click="removeSelected"
        >
          <Trash2 class="h-4 w-4" />
          <span>Delete</span>
        </BaseButton>
      </div>
    </div>

    <p
      class="text-sm text-gray-600"
      data-testid="style-preset-hint"
    >
      <template v-if="selected">
        A Document uses this style with
        <code class="rounded bg-white px-1 py-0.5 text-xs">{{ frontMatterKey }}: {{ selected.name }}</code>
        in its front matter, or from a folder or template that has it as default.
      </template>
      <template v-else>
        Default applies to every Document without a named style. Edits here change the Default.
      </template>
    </p>

    <PromptModal
      v-model="promptName"
      :show="promptMode !== null"
      :title="promptMode === 'rename' ? 'Rename style' : 'Save as new style'"
      label="Style name"
      placeholder="e.g. Report"
      :confirm-label="promptMode === 'rename' ? 'Rename' : 'Save'"
      input-testid="style-preset-name-input"
      confirm-testid="style-preset-name-confirm"
      cancel-testid="style-preset-name-cancel"
      @confirm="confirmPrompt"
      @cancel="promptMode = null"
    />
  </div>
</template>

<script setup>
import { computed, ref, useId } from 'vue';
import { CopyPlus, Edit, Trash2 } from 'lucide-vue-next';
import BaseButton from './BaseButton.vue';
import PromptModal from './PromptModal.vue';
import { useStylePresetStore } from '@/store/stylePresetStore';
import { useSyncStore } from '@/store/syncStore';
import { useUiStore } from '@/store/uiStore';
import { STYLE_FRONT_MATTER_KEYS, styleNameError } from '@/utils/stylePresets';

const props = defineProps({
  /** 'preview' or 'print' */
  kind: { type: String, required: true },
  /** The library whose named styles are listed. */
  dbKey: { type: String, default: null },
  /** The selected style id; '' is the library Default. */
  modelValue: { type: String, default: '' },
  /** The values being edited, copied into a new style. */
  getValues: { type: Function, required: true },
});

const emit = defineEmits(['update:modelValue']);

const stylePresetStore = useStylePresetStore();
const syncStore = useSyncStore();
const uiStore = useUiStore();
const selectId = `style-preset-${useId()}`;

const presets = computed(() => (props.dbKey ? stylePresetStore.presetsFor(props.dbKey, props.kind) : []));
const selected = computed(() => presets.value.find((p) => p.id === props.modelValue) || null);
const frontMatterKey = computed(() => STYLE_FRONT_MATTER_KEYS[props.kind]);
const libraryName = computed(() => {
  const entry = props.dbKey ? syncStore.databases.get(props.dbKey) : null;
  return entry?.kind === 'space' ? entry.name : (entry ? 'Personal' : '');
});

const promptMode = ref(null);
const promptName = ref('');

function openPrompt(mode) {
  promptMode.value = mode;
  promptName.value = mode === 'rename' ? selected.value?.name || '' : '';
}

async function confirmPrompt() {
  const ignoreId = promptMode.value === 'rename' ? selected.value?.id : null;
  const error = styleNameError(promptName.value, presets.value, ignoreId);
  if (error) {
    uiStore.addToast(error, 'warning');
    return;
  }
  try {
    if (promptMode.value === 'rename') {
      await stylePresetStore.renamePreset(props.dbKey, selected.value.id, promptName.value);
      uiStore.addToast('Style renamed.', 'success');
    } else {
      const preset = await stylePresetStore.createPreset(props.dbKey, props.kind, promptName.value, props.getValues());
      emit('update:modelValue', preset.id);
      uiStore.addToast(`Saved "${preset.name}".`, 'success');
    }
    promptMode.value = null;
  } catch (err) {
    // The store has already shown a toast for a failed write.
    if (err?.name === 'StyleNameError') uiStore.addToast(err.message, 'warning');
  }
}

async function removeSelected() {
  const preset = selected.value;
  if (!preset) return;
  if (!confirm(`Delete the style "${preset.name}"? Folders and templates that use it go back to Default.`)) return;
  try {
    await stylePresetStore.deletePreset(props.dbKey, preset.id);
    emit('update:modelValue', '');
    uiStore.addToast('Style deleted.', 'success');
  } catch {
    // The store has already shown a toast.
  }
}
</script>
