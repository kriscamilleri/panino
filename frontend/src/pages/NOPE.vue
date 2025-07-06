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
          <button @click="goBack" class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2">
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
                <textarea :id="key" v-model="editableStyleMap[key]" @input="handleStyleChange(key, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                  rows="3" :placeholder="`CSS styles for ${key} element`" />
              </div>
            </div>
            <div v-if="config.extraFields && config.extraFields.length > 0" class="space-y-4 pt-8 border-t">
              <h2 class="text-lg font-semibold text-gray-700">{{ config.extraFieldsTitle || 'Additional Settings' }}
              </h2>
              <div v-for="field in config.extraFields" :key="field.id" class="space-y-2">
                <label :for="field.id" class="block text-sm font-medium text-gray-700">{{ field.label }}</label>

                <!-- Multi-select for Google Fonts -->
                <div v-if="field.id === 'googleFontFamily'" class="font-selector-container space-y-2">
                  <div class="flex flex-wrap gap-2 p-3 border border-gray-300 rounded-md bg-gray-50 min-h-[2.5rem]">
                    <span v-for="font in selectedFonts" :key="font"
                      class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {{ font }}
                      <button @click="removeFont(font)"
                        class="ml-1 text-blue-600 hover:text-blue-800 font-bold">×</button>
                    </span>
                    <input v-model="fontSearchQuery" @input="searchFonts" @keydown="handleFontInputKeydown"
                      @focus="showFontDropdown = true" placeholder="Search Google Fonts..."
                      class="flex-1 min-w-[120px] border-none outline-none bg-transparent text-sm" />
                  </div>

                  <!-- Font dropdown -->
                  <div v-if="showFontDropdown && filteredFonts.length > 0"
                    class="absolute z-50 w-full max-w-md bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    <div v-for="font in filteredFonts.slice(0, 50)" :key="font" @click="addFont(font)"
                      class="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0">
                      {{ font }}
                    </div>
                  </div>
                </div>

                <!-- Other field types -->
                <textarea v-else-if="field.type === 'textarea'" :id="field.id" :rows="field.rows || 4"
                  v-model="editableStyleMap[field.modelKey]"
                  @input="handleStyleChange(field.modelKey, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                  :placeholder="field.placeholder"></textarea>
                <input v-else-if="field.type === 'input'" :id="field.id" :type="field.inputType || 'text'"
                  v-model="editableStyleMap[field.modelKey]"
                  @input="handleStyleChange(field.modelKey, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                  :class="field.inputType === 'color' ? 'h-10' : ''" :placeholder="field.placeholder" />
                <select v-else-if="field.type === 'select'" :id="field.id" v-model="editableStyleMap[field.modelKey]"
                  @change="handleStyleChange(field.modelKey, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm">
                  <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.text }}
                  </option>
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
          <hr class="my-6">
          <button @click="resetStyles"
            class="px-4 py-2 text-red-700 bg-red-50 hover:bg-red-100 rounded flex items-center space-x-2 border border-red-200">
            <span>Reset to Defaults</span>
          </button>
        </div>
      </div>

      <!-- Preview (full width when styles hidden, half width when styles shown) -->
      <div :class="showStylesCustomization ? 'w-1/2' : 'w-full'" class="bg-white border-l overflow-hidden"
        style="height: calc(100vh - 56px);">
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

// Google Fonts functionality
const selectedFonts = ref([]);
const fontSearchQuery = ref('');
const showFontDropdown = ref(false);
const allGoogleFonts = ref([]);
const filteredFonts = ref([]);

// Popular Google Fonts list (you can expand this)
const popularGoogleFonts = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Source Sans Pro', 'Raleway', 'PT Sans',
  'Libre Baskerville', 'Merriweather', 'Playfair Display', 'Georgia', 'Times New Roman', 'Arial',
  'Helvetica', 'Poppins', 'Nunito', 'Work Sans', 'Fira Sans', 'Oswald', 'Dancing Script', 'Lobster',
  'Pacifico', 'Quicksand', 'Ubuntu', 'Droid Sans', 'Roboto Condensed', 'Cabin', 'Lora', 'Crimson Text',
  'Noto Sans', 'Mukti', 'Source Code Pro', 'JetBrains Mono', 'Fira Code', 'Inconsolata', 'IBM Plex Sans',
  'IBM Plex Serif', 'IBM Plex Mono', 'Barlow', 'DM Sans', 'Rubik', 'Karla', 'Oxygen', 'PT Serif',
  'Titillium Web', 'Muli', 'Exo', 'Comfortaa', 'Archivo', 'Hind', 'Bitter', 'Josefin Sans'
];

const debouncedUpdatePreview = useDebounceFn(updatePreview, 300);

// Initialize Google Fonts
onMounted(() => {
  allGoogleFonts.value = [...popularGoogleFonts];

  // Parse existing font family value
  const currentFontFamily = editableStyleMap.value.googleFontFamily || '';
  if (currentFontFamily) {
    const fonts = currentFontFamily.split(',').map(f => f.trim().replace(/['"]/g, ''));
    selectedFonts.value = fonts.filter(f => f && f !== 'sans-serif' && f !== 'serif' && f !== 'monospace');
  }

  // Initialize filtered fonts
  searchFonts();

  // Close dropdown when clicking outside
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);

  // Clean up any custom styles that were added to the document
  const existingStyle = document.getElementById('markdown-custom-styles');
  if (existingStyle) {
    existingStyle.remove();
  }
});

function handleClickOutside(event) {
  if (!event.target.closest('.font-selector-container')) {
    showFontDropdown.value = false;
  }
}

function searchFonts() {
  const query = fontSearchQuery.value.trim().toLowerCase();
  if (!query) {
    filteredFonts.value = allGoogleFonts.value.filter(font => !selectedFonts.value.includes(font));
  } else {
    // Show fonts that match the search and aren't already selected
    const matchingFonts = allGoogleFonts.value.filter(font =>
      font.toLowerCase().includes(query) &&
      !selectedFonts.value.includes(font)
    );

    // If the exact search term isn't in the list but could be a valid font, add it
    const exactMatch = allGoogleFonts.value.find(font => font.toLowerCase() === query);
    if (!exactMatch && query.length > 2) {
      // Format the search term as a proper font name
      const formattedFont = query.split(' ').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');

      if (!selectedFonts.value.includes(formattedFont)) {
        matchingFonts.unshift(formattedFont);
      }
    }

    filteredFonts.value = matchingFonts;
  }
  showFontDropdown.value = filteredFonts.value.length > 0;
}

function addFont(font) {
  if (!selectedFonts.value.includes(font)) {
    selectedFonts.value.push(font);
    updateGoogleFontFamily();
  }
  fontSearchQuery.value = '';
  filteredFonts.value = [];
  showFontDropdown.value = false;
}

function removeFont(font) {
  const index = selectedFonts.value.indexOf(font);
  if (index > -1) {
    selectedFonts.value.splice(index, 1);
    updateGoogleFontFamily();
  }
}

function updateGoogleFontFamily() {
  const fontFamilyString = selectedFonts.value.join(', ');
  handleStyleChange('googleFontFamily', fontFamilyString);
}

function handleFontInputKeydown(event) {
  if (event.key === 'Enter' && fontSearchQuery.value.trim()) {
    // Add the typed font directly if Enter is pressed
    const formattedFont = fontSearchQuery.value.trim().split(' ').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');

    if (!selectedFonts.value.includes(formattedFont)) {
      addFont(formattedFont);
    }
    event.preventDefault();
  } else if (event.key === 'Escape') {
    showFontDropdown.value = false;
    fontSearchQuery.value = '';
  }
}

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

    // Update selected fonts when googleFontFamily changes
    const currentFontFamily = processedStyles.googleFontFamily || '';
    if (currentFontFamily) {
      const fonts = currentFontFamily.split(',').map(f => f.trim().replace(/['"]/g, ''));
      selectedFonts.value = fonts.filter(f => f && f !== 'sans-serif' && f !== 'serif' && f !== 'monospace');
    } else {
      selectedFonts.value = [];
    }

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

function resetStyles() {
  if (confirm('Are you sure you want to reset all styles to their default values? This action cannot be undone.')) {
    if (props.config.resetStyles) {
      props.config.resetStyles();
    }
  }
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

function goBack() {
  router.push('/');
}
</script>

<style scoped>
.font-selector-container {
  position: relative;
}

.font-selector-container .absolute {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
}
</style>