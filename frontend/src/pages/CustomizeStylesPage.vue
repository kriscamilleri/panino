<template>
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <nav class="bg-gray-100 border-b">
      <div class="flex items-center justify-between px-4 py-2">
        <h1 class="text-xl font-semibold text-gray-800">{{ config.title }}</h1>
        <div class="flex items-center space-x-2">
          <button @click="toggleStylesCustomization"
              class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2"
              :class="{ 'bg-gray-200': showStylesCustomization }">
            <Settings class="w-4 h-4" />
            <span>{{ showStylesCustomization ? 'Hide' : 'Show' }} Styles</span>
          </button>
          <button @click="goBack"
              class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2">
            <ArrowLeft class="w-4 h-4" />
            <span>Back</span>
          </button>
        </div>
      </div>
    </nav>
    <div class="flex-1 flex overflow-hidden">
      <!-- Styles Customization Panel (conditionally shown) -->
      <div v-if="showStylesCustomization" class="w-1/2 p-8 overflow-y-auto" style="height: calc(100vh - 56px);">
        <div class="bg-white shadow-lg rounded-lg p-8 h-full overflow-y-auto">
          <div class="space-y-6">
            <div v-for="(styles, category) in categorizedStyles" :key="category" class="space-y-4">
              <h2 class="text-lg font-semibold text-gray-700 border-b pb-2">{{ category }}</h2>
              <div v-for="(value, key) in styles" :key="key" class="space-y-2">
                <label :for="key" class="block text-sm font-medium text-gray-700">{{ key }}</label>
                <textarea :id="key" 
                    v-model="editableStyleMap[key]"
                    @input="handleStyleChange(key, $event.target.value)"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                    rows="3"
                    :placeholder="`CSS styles for ${key} element`" />
              </div>
            </div>
            <div v-if="config.extraFields && config.extraFields.length > 0" class="space-y-4 pt-8 border-t">
              <h2 class="text-lg font-semibold text-gray-700">{{ config.extraFieldsTitle || 'Additional Settings' }}</h2>
              <div v-for="field in config.extraFields" :key="field.id" class="space-y-2">
                <label :for="field.id" class="block text-sm font-medium text-gray-700">{{ field.label }}</label>
                <textarea v-if="field.type === 'textarea'" :id="field.id" :rows="field.rows || 4"
                    v-model="editableStyleMap[field.modelKey]"
                    @input="handleStyleChange(field.modelKey, $event.target.value)"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                    :placeholder="field.placeholder"></textarea>
                <input v-else-if="field.type === 'input'" :id="field.id" :type="field.inputType || 'text'"
                    v-model="editableStyleMap[field.modelKey]"
                    @input="handleStyleChange(field.modelKey, $event.target.value)"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                    :class="field.inputType === 'color' ? 'h-10' : ''"
                    :placeholder="field.placeholder" />
                <select v-else-if="field.type === 'select'" :id="field.id"
                    v-model="editableStyleMap[field.modelKey]"
                     @change="handleStyleChange(field.modelKey, $event.target.value)"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm">
                    <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.text }}</option>
                </select>
                <div v-else-if="field.type === 'checkbox'" class="flex items-center">
                    <input :id="field.id" type="checkbox"
                        :checked="editableStyleMap[field.modelKey] === true || editableStyleMap[field.modelKey] === 'true'"
                        @change="handleStyleChange(field.modelKey, $event.target.checked)"
                        class="h-4 w-4 text-gray-600 border-gray-300 rounded focus:ring-gray-500" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Preview (full width when styles hidden, half width when styles shown) -->
      <div :class="showStylesCustomization ? 'w-1/2' : 'w-full'" class="bg-white border-l overflow-hidden" style="height: calc(100vh - 56px);">
        <div class="h-full overflow-y-auto p-8">
          <div id="preview-content" v-html="previewHtmlContent" data-testid="preview-content"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, Settings } from 'lucide-vue-next';
import { useDebounceFn } from '@vueuse/core';

const props = defineProps({
    config: { type: Object, required: true },
    previewType: { type: String, default: 'html' }
});

const router = useRouter();

const editableStyleMap = ref({});
const showStylesCustomization = ref(false);

const debouncedUpdatePreview = useDebounceFn(updatePreview, 300);

// Watch for changes in the config styles and update local editable map
watch(
    () => props.config.getStyles(),
    (newStyles) => {
        const processedStyles = { ...newStyles };
        (props.config.extraFields || []).forEach(field => {
            if (field.type === 'checkbox' && typeof processedStyles[field.modelKey] !== 'boolean') {
                processedStyles[field.modelKey] = String(processedStyles[field.modelKey]).toLowerCase() === 'true';
            }
        });
        editableStyleMap.value = processedStyles;
        debouncedUpdatePreview();
    },
    { deep: true, immediate: true }
);

const debouncedUpdateStore = useDebounceFn((key, value) => {
    props.config.updateStyleAction(key, value);
}, 300);

function handleStyleChange(key, newValue) {
    editableStyleMap.value[key] = newValue;
    debouncedUpdateStore(key, newValue);
}

function toggleStylesCustomization() {
    showStylesCustomization.value = !showStylesCustomization.value;
}

const categorizedStyles = computed(() => {
    const currentStyles = editableStyleMap.value;
    if (!props.config.styleCategories || !currentStyles) return {};
    const extraFieldKeys = (props.config.extraFields || []).map(f => f.modelKey);
    return Object.entries(props.config.styleCategories).reduce((acc, [category, keys]) => {
        acc[category] = Object.fromEntries(
            keys.filter(key => currentStyles.hasOwnProperty(key) && !extraFieldKeys.includes(key))
                .map(key => [key, currentStyles[key]])
        );
        if (Object.keys(acc[category]).length === 0) {
            delete acc[category];
        }
        return acc;
    }, {});
});

const previewHtmlContent = computed(() => {
    if (!props.config.getMarkdownIt || !props.config.sampleMarkdown) return '';
    const md = props.config.getMarkdownIt();
    return md.render(props.config.sampleMarkdown);
});

function updatePreview() {
    // Force re-render of the preview content
    // The computed previewHtmlContent will automatically update based on the current styles
}

onMounted(() => { 
    // Initial preview update
    debouncedUpdatePreview();
});

onUnmounted(() => {
    // Clean up any custom styles that were added to the document
    const existingStyle = document.getElementById('markdown-custom-styles');
    if (existingStyle) {
        existingStyle.remove();
    }
});

function goBack() { 
    router.push('/'); 
}
</script>