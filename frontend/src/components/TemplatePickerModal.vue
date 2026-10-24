<template>
  <!-- Phones get a bottom sheet that stays mounted so it slides in and out like the capture sheet. -->
  <component
    :is="sheet ? BottomSheet : BaseModal"
    v-bind="wrapperProps"
    @close="emit('close')"
    @closed="emit('closed')"
  >
    <template
      v-if="sheet"
      #header
    >
      <h2 class="template-sheet-title">{{ dialogTitle }}</h2>
    </template>

    <div :class="{ 'template-sheet-body': sheet }">
    <!-- Variable input form (shown inline, replaces template list) -->
    <template v-if="showVariables">
      <p class="pn-body mb-5">
        Fill in the values for the template placeholders below.
      </p>
      <div class="space-y-4">
        <div
          v-for="label in variableLabels"
          :key="label"
        >
          <label
            class="pn-label"
            :for="`template-picker-variable-${label}`"
          >{{ label }}</label>
          <input
            :id="`template-picker-variable-${label}`"
            v-model="variableValues[label]"
            type="text"
            class="pn-input"
            :placeholder="label"
            :data-testid="`variable-input-${label}`"
          />
        </div>
      </div>
    </template>

    <!-- Template list (shown when not filling variables) -->
    <template v-else>
      <div class="space-y-1">
        <!-- Blank document -->
        <label
          class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-gray-50"
          :class="{ 'bg-gray-100 ring-1 ring-gray-300': selectedTemplateId === '__blank__' }"
        >
          <input
            type="radio"
            name="template"
            value="__blank__"
            :checked="selectedTemplateId === '__blank__'"
            @change="selectTemplate('__blank__')"
            class="pn-radio"
            data-testid="template-picker-radio-blank"
          />
          <span class="text-sm font-medium text-gray-900">Blank document</span>
        </label>

        <!-- Template list -->
        <p
          v-if="templateStore.isLoading && !templates.length"
          class="py-8 text-center pn-body"
        >Loading templates…</p>

        <p
          v-else-if="templateStore.error"
          class="py-4 text-sm text-red-600"
        >{{ templateStore.error }}</p>

        <template v-else>
          <p
            v-if="templates.length === 0"
            class="py-6 text-center pn-body"
          >No templates yet. Save a document as a template to see it here.</p>

          <label
            v-for="tpl in templates"
            :key="tpl.id"
            class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-gray-50"
            :class="{ 'bg-gray-100 ring-1 ring-gray-300': selectedTemplateId === tpl.id }"
          >
            <input
              type="radio"
              name="template"
              :value="tpl.id"
              :checked="selectedTemplateId === tpl.id"
              @change="selectTemplate(tpl.id)"
              class="pn-radio"
              :data-testid="`template-picker-radio-${tpl.id}`"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-gray-900">{{ tpl.name }}</span>
              <span
                v-if="tpl.updatedAt"
                class="mt-0.5 block pn-meta"
              >Last edited {{ relativeTime(tpl.updatedAt) }}</span>
            </span>
          </label>
        </template>
      </div>
    </template>
    </div>

    <template #footer>
      <div :class="{ 'template-sheet-footer': sheet }">
      <!-- Variable mode: Back + Create Document -->
      <template v-if="showVariables">
        <BaseButton
          variant="secondary"
          size="md"
          data-testid="template-picker-variable-back"
          @click="cancelVariables"
        >
          Back
        </BaseButton>
        <BaseButton
          variant="primary"
          size="md"
          data-testid="template-picker-variable-create"
          :disabled="creating"
          @click="handleCreateWithVariables"
        >
          Create Document
        </BaseButton>
      </template>

      <!-- List mode: Cancel + Use Template -->
      <template v-else>
        <BaseButton
          variant="secondary"
          size="md"
          data-testid="template-picker-cancel"
          @click="emit('close')"
        >
          Cancel
        </BaseButton>
        <BaseButton
          variant="primary"
          size="md"
          data-testid="template-picker-use"
          :disabled="creating"
          @click="handleUseTemplate"
        >
          Use Template
        </BaseButton>
      </template>
      </div>
    </template>
  </component>
</template>

<script setup>
import { ref, computed, reactive, watch } from 'vue';
import { useTemplateStore } from '@/store/templateStore';
import { useStructureStore } from '@/store/structureStore';
import { useSyncStore } from '@/store/syncStore';
import { resolveTemplateVariables, extractInputLabels } from '@/utils/templateVariables';
import BaseModal from '@/components/BaseModal.vue';
import BaseButton from '@/components/BaseButton.vue';
import BottomSheet from '@/components/phone/BottomSheet.vue';

const props = defineProps({
  currentFolderId: {
    type: String,
    default: null,
  },
  databaseKey: {
    type: String,
    required: true,
  },
  /** Render as a phone bottom sheet instead of a centered dialog. */
  sheet: {
    type: Boolean,
    default: false,
  },
  /** Sheet mode only: the sheet stays mounted and animates on this. */
  open: {
    type: Boolean,
    default: true,
  },
});

// `closed`: sheet mode only, after the sheet has slid away.
const emit = defineEmits(['close', 'closed', 'created']);

const templateStore = useTemplateStore();
const structureStore = useStructureStore();
const syncStore = useSyncStore();

const selectedTemplateId = ref('__blank__');
const showVariables = ref(false);
const activeTemplate = ref(null);
const variableValues = reactive({});
// Set once a note is being created and kept while the sheet slides away, so a
// second tap cannot create a second note.
const creating = ref(false);

const templates = computed(() => templateStore.templates);

const variableLabels = computed(() => {
  if (!activeTemplate.value) return [];
  return extractInputLabels(activeTemplate.value.content, activeTemplate.value.titlePattern || '');
});

const dialogTitle = computed(() =>
  showVariables.value ? activeTemplate.value?.name || 'Fill Variables' : 'New Document from Template',
);

const wrapperProps = computed(() => (props.sheet
  ? { open: props.open, label: dialogTitle.value, testid: 'template-picker-modal' }
  : {
      title: dialogTitle.value,
      size: 'sm',
      'data-testid': 'template-picker-modal',
      closeTestid: 'template-picker-close',
    }));

// Load ahead of the first opening so the list is in place while the sheet slides
// up, then start each opening fresh with the latest templates.
watch(() => [props.open, props.databaseKey], ([isOpen, dbKey], previous) => {
  if (!dbKey) return;
  const firstLoad = !previous || previous[1] !== dbKey;
  if (isOpen) {
    creating.value = false;
    selectedTemplateId.value = '__blank__';
    cancelVariables();
  }
  if (isOpen || firstLoad) templateStore.loadTemplates(dbKey);
}, { immediate: true });

function selectTemplate(id) {
  selectedTemplateId.value = id;
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth} month${diffMonth > 1 ? 's' : ''} ago`;
}

async function handleUseTemplate() {
  if (creating.value) return;
  // Blank document — create empty note (same as + button)
  if (selectedTemplateId.value === '__blank__') {
    await create(async () => {
      const result = await structureStore.createFile(props.databaseKey, 'Untitled', props.currentFolderId);
      await structureStore.loadRootItems();
      emit('created', result);
    });
    return;
  }

  const tpl = templateStore.templates.find(t => t.id === selectedTemplateId.value);
  if (!tpl) return;

  // Scan BOTH content and title_pattern for input variables
  const inputLabels = extractInputLabels(tpl.content, tpl.titlePattern || '');

  if (inputLabels.length === 0) {
    // No input variables — resolve and create immediately
    await create(async () => {
      const folderId = await resolveTargetFolder(tpl);
      await createNoteFromTemplate(tpl, {}, folderId);
    });
  } else {
    // Has input variables — show inline variable form
    activeTemplate.value = tpl;
    // Initialize variableValues with empty strings for each label
    for (const label of inputLabels) {
      variableValues[label] = '';
    }
    showVariables.value = true;
  }
}

function cancelVariables() {
  showVariables.value = false;
  activeTemplate.value = null;
  // Clear variable values
  for (const key of Object.keys(variableValues)) {
    delete variableValues[key];
  }
}

async function handleCreateWithVariables() {
  if (!activeTemplate.value || creating.value) return;

  // Build input values from the reactive object
  const inputValues = { ...variableValues };
  const tpl = activeTemplate.value;

  // The form stays in place while the sheet closes; the next opening clears it.
  await create(async () => {
    const folderId = await resolveTargetFolder(tpl);
    await createNoteFromTemplate(tpl, inputValues, folderId);
  });
}

async function create(work) {
  creating.value = true;
  try {
    await work();
  } catch (err) {
    creating.value = false;
    throw err;
  }
}

async function createNoteFromTemplate(tpl, inputValues, folderId) {
  const titlePattern = tpl.titlePattern?.trim();
  let noteTitle = tpl.name;

  if (titlePattern) {
    const resolved = resolveTemplateVariables(titlePattern, inputValues).trim();
    if (resolved) noteTitle = resolved;
  }

  const resolvedContent = resolveTemplateVariables(tpl.content, inputValues);
  const result = await structureStore.createFile(props.databaseKey, noteTitle, folderId);
  await syncStore.repository(props.databaseKey).transaction(async (repo) => {
    const now = new Date().toISOString();
    await repo.exec('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?', [resolvedContent, now, result.id]);
  });
  await structureStore.loadRootItems();
  emit('created', result);
}

async function resolveTargetFolder(tpl) {
  if (tpl.defaultFolderId) {
    // A template can outlive its default folder — fall back when it is gone
    const exists = await folderExists(tpl.defaultFolderId);
    if (exists) return tpl.defaultFolderId;
  }
  return props.currentFolderId === props.databaseKey ? null : props.currentFolderId;
}

async function folderExists(targetId) {
  const rows = await syncStore.repository(props.databaseKey).execute(
    'SELECT COUNT(*) AS count FROM folders WHERE id = ?',
    [targetId],
  );
  return (rows?.[0]?.count ?? 0) > 0;
}
</script>

<style scoped>
.template-sheet-title {
  padding: 0 8px;
  font-size: 20px;
  font-weight: 600;
}

.template-sheet-body {
  padding: 4px 16px 16px;
}

.template-sheet-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
