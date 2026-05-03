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
          <h3 class="text-xl font-semibold text-gray-800">New Note from Template</h3>
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
            class="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
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
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 bg-gray-50 rounded-b-lg border-t">
        <div class="flex justify-end gap-3">
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

    <!-- Variable dialog for templates with {{input:...}} placeholders -->
    <TemplateVariableDialog
      v-if="showVariableDialog"
      :labels="variableLabels"
      :template-name="activeTemplate?.name || ''"
      @submit="onVariablesApplied"
      @cancel="showVariableDialog = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useTemplateStore } from '@/store/templateStore';
import { useStructureStore } from '@/store/structureStore';
import { useRouter } from 'vue-router';
import { resolveTemplateVariables, extractInputLabels } from '@/utils/templateVariables';
import TemplateVariableDialog from '@/components/TemplateVariableDialog.vue';
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
const showVariableDialog = ref(false);
const activeTemplate = ref(null);

const templates = computed(() => templateStore.templates);

const variableLabels = computed(() => {
  if (!activeTemplate.value) return [];
  return extractInputLabels(activeTemplate.value.content);
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
    emit('created', result.id);
    return;
  }

  const tpl = templateStore.templates.find(t => t.id === selectedTemplateId.value);
  if (!tpl) return;

  const inputLabels = extractInputLabels(tpl.content);

  if (inputLabels.length === 0) {
    // No {{input:...}} placeholders — create note immediately
    const resolvedContent = resolveTemplateVariables(tpl.content);
    const result = await structureStore.createFile(tpl.name, props.currentFolderId);
    await structureStore.updateFileContent(result.id, resolvedContent);
    emit('created', result.id);
  } else {
    // Has {{input:...}} placeholders — show variable dialog
    activeTemplate.value = tpl;
    showVariableDialog.value = true;
  }
}

async function onVariablesApplied(inputValues) {
  showVariableDialog.value = false;
  if (!activeTemplate.value) return;

  const resolvedContent = resolveTemplateVariables(activeTemplate.value.content, inputValues);
  const result = await structureStore.createFile(activeTemplate.value.name, props.currentFolderId);
  await structureStore.updateFileContent(result.id, resolvedContent);
  emit('created', result.id);

  activeTemplate.value = null;
}
</script>
