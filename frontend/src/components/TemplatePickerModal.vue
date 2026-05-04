<template>
  <div
    class="fixed inset-0 flex items-center justify-center z-50"
    data-testid="template-picker-modal"
  >
    <div
      class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
      @click="emit('close')"
    ></div>

    <div class="relative bg-white rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col">
      <!-- Header -->
      <div class="px-6 py-4 border-b">
        <div class="flex justify-between items-center">
          <h3 class="text-xl font-semibold text-gray-800">
            {{ showVariables ? activeTemplate?.name || 'Fill Variables' : 'New Note from Template' }}
          </h3>
          <button
            @click="emit('close')"
            class="text-gray-400 hover:text-gray-600 transition-colors"
            data-testid="template-picker-close"
          >
            <X class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Body -->
      <div class="px-6 py-4 flex-1 overflow-y-auto">
        <!-- Variable input form (shown inline, replaces template list) -->
        <template v-if="showVariables">
          <p class="text-sm text-gray-600 mb-4">
            Fill in the values for the template placeholders below.
          </p>
          <div
            v-for="label in variableLabels"
            :key="label"
            class="mb-4"
          >
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ label }}</label>
            <input
              v-model="variableValues[label]"
              type="text"
              class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              :placeholder="label"
              :data-testid="`variable-input-${label}`"
            />
          </div>
        </template>

        <!-- Template list (shown when not filling variables) -->
        <template v-else>
          <!-- Blank document -->
          <label
            class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
            :class="{ 'bg-blue-50 ring-1 ring-blue-200': selectedTemplateId === '__blank__' }"
          >
            <input
              type="radio"
              name="template"
              value="__blank__"
              :checked="selectedTemplateId === '__blank__'"
              @change="selectTemplate('__blank__')"
              class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
              data-testid="template-picker-radio-blank"
            />
            <span class="text-sm font-medium text-gray-900">Blank document</span>
          </label>

          <!-- Template list -->
          <div v-if="templateStore.isLoading" class="py-8 text-center">
            <p class="text-sm text-gray-500">Loading templates…</p>
          </div>

          <div v-else-if="templateStore.error" class="py-4">
            <p class="text-sm text-red-600">{{ templateStore.error }}</p>
          </div>

          <template v-else>
            <div v-if="templates.length === 0" class="py-6 text-center">
              <p class="text-sm text-gray-500">No templates yet. Save a note as a template to see it here.</p>
            </div>

            <label
              v-for="tpl in templates"
              :key="tpl.id"
              class="flex items-center gap-3 px-3 py-3 mt-1 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
              :class="{ 'bg-blue-50 ring-1 ring-blue-200': selectedTemplateId === tpl.id }"
            >
              <input
                type="radio"
                name="template"
                :value="tpl.id"
                :checked="selectedTemplateId === tpl.id"
                @change="selectTemplate(tpl.id)"
                class="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                :data-testid="`template-picker-radio-${tpl.id}`"
              />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900 truncate">{{ tpl.name }}</p>
                <p
                  v-if="tpl.updatedAt"
                  class="text-xs text-gray-500 mt-0.5"
                >
                  Last edited {{ relativeTime(tpl.updatedAt) }}
                </p>
              </div>
            </label>
          </template>
        </template>
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 bg-gray-50 rounded-b-lg border-t">
        <!-- Variable mode: Back + Create Note -->
        <div v-if="showVariables" class="flex justify-end gap-3">
          <button
            @click="cancelVariables"
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            data-testid="template-picker-variable-back"
          >
            Back
          </button>
          <button
            @click="handleCreateWithVariables"
            class="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900 transition-colors"
            data-testid="template-picker-variable-create"
          >
            Create Note
          </button>
        </div>

        <!-- List mode: Cancel + Use Template -->
        <div v-else class="flex justify-end gap-3">
          <button
            @click="emit('close')"
            class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            data-testid="template-picker-cancel"
          >
            Cancel
          </button>
          <button
            @click="handleUseTemplate"
            class="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900 transition-colors"
            data-testid="template-picker-use"
          >
            Use Template
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue';
import { useTemplateStore } from '@/store/templateStore';
import { useStructureStore } from '@/store/structureStore';
import { useRouter } from 'vue-router';
import { resolveTemplateVariables, extractInputLabels } from '@/utils/templateVariables';
import { X } from 'lucide-vue-next';

const props = defineProps({
  currentFolderId: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(['close', 'created']);

const templateStore = useTemplateStore();
const structureStore = useStructureStore();
const router = useRouter();

const selectedTemplateId = ref('__blank__');
const showVariables = ref(false);
const activeTemplate = ref(null);
const variableValues = reactive({});

const templates = computed(() => templateStore.templates);

const variableLabels = computed(() => {
  if (!activeTemplate.value) return [];
  return extractInputLabels(activeTemplate.value.content, activeTemplate.value.titlePattern || '');
});

onMounted(() => {
  templateStore.loadTemplates();
});

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
  // Blank document — create empty note (same as + button)
  if (selectedTemplateId.value === '__blank__') {
    const result = await structureStore.createFile('Untitled', props.currentFolderId);
    await structureStore.loadRootItems();
    emit('created', result.id);
    return;
  }

  const tpl = templateStore.templates.find(t => t.id === selectedTemplateId.value);
  if (!tpl) return;

  // Scan BOTH content and title_pattern for input variables
  const inputLabels = extractInputLabels(tpl.content, tpl.titlePattern || '');

  if (inputLabels.length === 0) {
    // No input variables — resolve and create immediately
    const folderId = resolveTargetFolder(tpl);
    await createNoteFromTemplate(tpl, {}, folderId);
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
  if (!activeTemplate.value) return;

  // Build input values from the reactive object
  const inputValues = { ...variableValues };

  showVariables.value = false;
  const tpl = activeTemplate.value;
  activeTemplate.value = null;

  // Clear variable values
  for (const key of Object.keys(variableValues)) {
    delete variableValues[key];
  }

  const folderId = resolveTargetFolder(tpl);
  await createNoteFromTemplate(tpl, inputValues, folderId);
}

async function createNoteFromTemplate(tpl, inputValues, folderId) {
  const titlePattern = tpl.titlePattern?.trim();
  let noteTitle = tpl.name;

  if (titlePattern) {
    const resolved = resolveTemplateVariables(titlePattern, inputValues).trim();
    if (resolved) noteTitle = resolved;
  }

  const resolvedContent = resolveTemplateVariables(tpl.content, inputValues);
  const result = await structureStore.createFile(noteTitle, folderId);
  await structureStore.updateFileContent(result.id, resolvedContent);
  await structureStore.loadRootItems();
  emit('created', result.id);
}

function resolveTargetFolder(tpl) {
  if (tpl.defaultFolderId) {
    // Walk the tree to check if the folder still exists
    const exists = folderExists(tpl.defaultFolderId);
    if (exists) return tpl.defaultFolderId;
  }
  return props.currentFolderId;
}

function folderExists(targetId) {
  function search(items) {
    for (const item of items) {
      if (item.id === targetId && item.type === 'folder') return true;
      if (item.type === 'folder') {
        const children = structureStore.getChildren(item.id);
        if (search(children)) return true;
      }
    }
    return false;
  }
  return search(structureStore.rootItems);
}
</script>
