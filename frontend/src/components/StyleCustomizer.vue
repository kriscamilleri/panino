<template>
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <AccountNav :title="config.title">
      <template #actions>


        <!-- Button group for custom actions (Print page) -->
        <div v-if="config.customActions" class="flex items-center gap-2" role="group">
          <BaseButton v-for="action in config.customActions" :key="action.id" @click="action.onClick"
            :isActive="action.isActive()" class="text-sm font-medium px-3 py-1.5">
            <!-- show provided icon component or fallback based on action id -->
            <template v-if="action.icon">
              <component :is="action.icon" class="w-4 h-4 mr-2" />
            </template>
            <template v-else>
              <component :is="iconForAction(action.id)" class="w-4 h-4 mr-2" />
            </template>
            {{ action.label }}
          </BaseButton>
        </div>

        <!-- Original toggle button (for regular styles page) -->
        <button v-else @click="toggleStylesCustomization"
          class="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-200 rounded-md hover:bg-gray-200 flex items-center space-x-2"
          :class="{ 'bg-gray-200': showStylesCustomization }">
          <Settings class="w-4 h-4" />
          <span>{{ showStylesCustomization ? 'Hide' : 'Show' }} Styles</span>
        </button>

        <button @click="goBack"
          class="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-200 rounded-md hover:bg-gray-200 flex items-center space-x-2">
          <ArrowLeft class="w-4 h-4" />
          <span>Back</span>
        </button>
      </template>
    </AccountNav>

    <div class="flex-1 flex overflow-hidden">
      <!-- Styles Pane (left side when active) -->
      <div v-if="shouldShowStylesPane" class="w-1/2 p-8 overflow-y-auto" :style="{ height: 'calc(100vh - 57px)' }">
        <div class="bg-white shadow-lg rounded-lg p-8 h-full overflow-y-auto">
          <div class="space-y-6">
            <div v-for="(styles, category) in categorizedStyles" :key="category" class="space-y-4">
              <h2 class="text-lg font-semibold text-gray-700 border-b pb-2">
                {{ category }}
              </h2>
              <div v-for="(value, key) in styles" :key="key" class="space-y-2">
                <label :for="key" class="block text-sm font-medium text-gray-700">
                  {{ key }}
                </label>
                <textarea :id="key" v-model="editableStyleMap[key]" @input="handleStyleChange(key, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                  rows="3" :placeholder="`CSS styles for ${key} element`" />
              </div>
            </div>

            <div v-if="config.extraFields?.length" class="space-y-4 pt-8 border-t">
              <h2 class="text-lg font-semibold text-gray-700">
                {{ config.extraFieldsTitle || 'Additional Settings' }}
              </h2>
              <div v-for="field in config.extraFields" :key="field.id" class="space-y-2">
                <label :for="field.id" class="block text-sm font-medium text-gray-700">
                  {{ field.label }}
                </label>

                <div v-if="field.id === 'googleFontFamily'" class="font-selector-container space-y-2">
                  <div class="flex flex-wrap gap-2 p-3 border border-gray-300 rounded-md bg-gray-50 min-h-[2.5rem]">
                    <span v-for="font in selectedFonts" :key="font"
                      class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {{ font }}
                      <button @click="removeFont(font)" class="ml-1 text-blue-600 hover:text-blue-800 font-bold">
                        ×
                      </button>
                    </span>
                    <input v-model="fontSearchQuery" @input="searchFonts" @keydown="handleFontInputKeydown"
                      @focus="showFontDropdown = true" placeholder="Search Google Fonts..."
                      class="flex-1 min-w-[120px] border-none outline-none bg-transparent text-sm" />
                  </div>
                  <div v-if="showFontDropdown && filteredFonts.length"
                    class="absolute z-50 w-full max-w-md bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    <div v-for="font in filteredFonts.slice(0, 50)" :key="font" @click="addFont(font)"
                      class="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0">
                      {{ font }}
                    </div>
                  </div>
                </div>

                <textarea v-else-if="field.type === 'textarea'" :id="field.id" :rows="field.rows || 4"
                  v-model="editableStyleMap[field.modelKey]"
                  @input="handleStyleChange(field.modelKey, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                  :placeholder="field.placeholder" />

                <input v-else-if="field.type === 'input'" :id="field.id" :type="field.inputType || 'text'"
                  v-model="editableStyleMap[field.modelKey]"
                  @input="handleStyleChange(field.modelKey, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                  :class="field.inputType === 'color' ? 'h-10' : ''" :placeholder="field.placeholder" />

                <select v-else-if="field.type === 'select'" :id="field.id" v-model="editableStyleMap[field.modelKey]"
                  @change="handleStyleChange(field.modelKey, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm">
                  <option v-for="opt in field.options" :key="opt.value" :value="opt.value">
                    {{ opt.text }}
                  </option>
                </select>

                <div v-else-if="field.type === 'checkbox'" class="flex items-center">
                  <input :id="field.id" type="checkbox" :checked="editableStyleMap[field.modelKey] === true ||
                    editableStyleMap[field.modelKey] === 'true'
                    " @change="handleStyleChange(field.modelKey, $event.target.checked)"
                    class="h-4 w-4 text-gray-600 border-gray-300 rounded focus:ring-gray-500" />
                </div>
              </div>
            </div>
          </div>

          <hr class="my-6" />
          <button @click="resetStyles"
            class="px-4 py-2 text-red-700 bg-red-50 hover:bg-red-100 rounded flex items-center space-x-2 border border-red-200 my-2">
            <span>Reset to Defaults</span>
          </button>
          <button v-if="config.getDebugHtml" @click="showDebugHtml"
            class="px-4 py-2 text-yellow-700 bg-yellow-50 hover:bg-yellow-100 rounded flex items-center space-x-2 border border-yellow-200 my-2">
            <Bug class="w-4 h-4" />
            <span>Debug HTML</span>
          </button>
        </div>
      </div>

      <!-- Editor Pane (left side when active) -->
      <div v-if="shouldShowEditorPane" class="w-1/2 p-8 overflow-y-auto bg-gray-50"
        :style="{ height: 'calc(100vh - 57px)' }">
        <component v-if="config.editorComponent" :is="config.editorComponent"
          class="bg-white shadow-lg rounded-lg h-full overflow-y-auto w-full font-mono text-sm" />
        <textarea v-else-if="config.getEditorContent" :value="config.getEditorContent()"
          class="bg-white shadow-lg rounded-lg p-8 h-full overflow-y-auto w-full font-mono text-sm" readonly></textarea>
      </div>

      <!-- Preview/Content Pane (right side or full width) -->
      <div :class="shouldShowStylesPane || shouldShowEditorPane ? 'w-1/2' : 'w-full'"
        class="bg-white border-l overflow-hidden" :style="{ height: 'calc(100vh - 57px)' }">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, Settings, Bug, Palette, Edit3 } from 'lucide-vue-next';
import { useDebounceFn } from '@vueuse/core';
import AccountNav from './AccountNav.vue';
import BaseButton from './BaseButton.vue';

const props = defineProps({
  config: { type: Object, required: true }
});

const router = useRouter();
const editableStyleMap = ref({});
const showStylesCustomization = ref(false);

// Computed property to determine if styles pane should show
const shouldShowStylesPane = computed(() => {
  // If customActions exist, check if 'styles' mode is active
  if (props.config.customActions) {
    const stylesAction = props.config.customActions.find(a => a.id === 'show-styles');
    return stylesAction ? stylesAction.isActive() : false;
  }
  // Otherwise use the original toggle behavior
  return showStylesCustomization.value;
});

// Computed property to determine if editor pane should show
const shouldShowEditorPane = computed(() => {
  if (props.config.customActions) {
    const editorAction = props.config.customActions.find(a => a.id === 'show-editor');
    return editorAction ? editorAction.isActive() : false;
  }
  return false;
});

// Google-font picker state
const selectedFonts = ref([]);
const fontSearchQuery = ref('');
const showFontDropdown = ref(false);
const allGoogleFonts = ref([]);
const filteredFonts = ref([]);

const popularGoogleFonts = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Source Sans Pro', 'Raleway', 'PT Sans',
  'Libre Baskerville', 'Merriweather', 'Playfair Display', 'Georgia', 'Times New Roman', 'Arial',
  'Helvetica', 'Poppins', 'Nunito', 'Work Sans', 'Fira Sans', 'Oswald', 'Dancing Script', 'Lobster',
  'Pacifico', 'Quicksand', 'Ubuntu', 'Droid Sans', 'Roboto Condensed', 'Cabin', 'Lora', 'Crimson Text',
  'Noto Sans', 'Mukti', 'Source Code Pro', 'JetBrains Mono', 'Fira Code', 'Inconsolata', 'IBM Plex Sans',
  'IBM Plex Serif', 'IBM Plex Mono', 'Barlow', 'DM Sans', 'Rubik', 'Karla', 'Oxygen', 'PT Serif',
  'Titillium Web', 'Muli', 'Exo', 'Comfortaa', 'Archivo', 'Hind', 'Bitter', 'Josefin Sans'
];

const debouncedUpdateStore = useDebounceFn((k, v) => props.config.updateStyleAction(k, v), 300);

onMounted(() => {
  allGoogleFonts.value = [...popularGoogleFonts];
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  const s = document.getElementById('markdown-custom-styles');
  if (s) s.remove();
});

function handleClickOutside(e) {
  if (!e.target.closest('.font-selector-container')) {
    showFontDropdown.value = false;
  }
}

function searchFonts() {
  const q = fontSearchQuery.value.trim().toLowerCase();
  if (!q) {
    filteredFonts.value = allGoogleFonts.value.filter(f => !selectedFonts.value.includes(f));
  } else {
    const matches = allGoogleFonts.value.filter(f =>
      f.toLowerCase().includes(q) && !selectedFonts.value.includes(f)
    );
    const exact = allGoogleFonts.value.find(f => f.toLowerCase() === q);
    if (!exact && q.length > 2) {
      const fmt = q
        .split(' ')
        .map(w => w[0].toUpperCase() + w.slice(1))
        .join(' ');
      if (!selectedFonts.value.includes(fmt)) matches.unshift(fmt);
    }
    filteredFonts.value = matches;
  }
  showFontDropdown.value = !!filteredFonts.value.length;
}

function addFont(f) {
  if (!selectedFonts.value.includes(f)) {
    selectedFonts.value.push(f);
    updateGoogleFontFamily();
  }
  fontSearchQuery.value = '';
  filteredFonts.value = [];
  showFontDropdown.value = false;
}

function removeFont(f) {
  const i = selectedFonts.value.indexOf(f);
  if (i > -1) {
    selectedFonts.value.splice(i, 1);
    updateGoogleFontFamily();
  }
}

function updateGoogleFontFamily() {
  const fam = selectedFonts.value.join(', ');
  handleStyleChange('googleFontFamily', fam);
}

function handleFontInputKeydown(e) {
  if (e.key === 'Enter' && fontSearchQuery.value.trim()) {
    const fmt = fontSearchQuery.value
      .trim()
      .split(' ')
      .map(w => w[0].toUpperCase() + w.slice(1))
      .join(' ');
    if (!selectedFonts.value.includes(fmt)) addFont(fmt);
    e.preventDefault();
  } else if (e.key === 'Escape') {
    showFontDropdown.value = false;
    fontSearchQuery.value = '';
  }
}

watch(
  () => props.config.getStyles(),
  newStyles => {
    const proc = { ...newStyles };
    props.config.extraFields?.forEach(f => {
      if (f.type === 'checkbox' && typeof proc[f.modelKey] !== 'boolean') {
        proc[f.modelKey] = String(proc[f.modelKey]).toLowerCase() === 'true';
      }
    });
    editableStyleMap.value = proc;

    const gf = proc.googleFontFamily || '';
    if (gf) {
      const fonts = gf
        .split(',')
        .map(x => x.trim().replace(/['"]/g, ''))
        .filter(x => x && !['sans-serif', 'serif', 'monospace'].includes(x));
      selectedFonts.value = fonts;
    } else {
      selectedFonts.value = [];
    }
  },
  { deep: true, immediate: true }
);

function handleStyleChange(key, val) {
  editableStyleMap.value[key] = val;
  debouncedUpdateStore(key, val);
}

function resetStyles() {
  if (
    confirm(
      'Are you sure you want to reset all styles to their default values? This action cannot be undone.'
    )
  ) {
    props.config.resetStyles();
  }
}

function toggleStylesCustomization() {
  showStylesCustomization.value = !showStylesCustomization.value;
}

const categorizedStyles = computed(() => {
  if (!props.config.styleCategories) return {};
  const extraKeys = props.config.extraFields?.map(f => f.modelKey) || [];
  return Object.entries(props.config.styleCategories).reduce((acc, [cat, keys]) => {
    const entries = keys
      .filter(k => editableStyleMap.value.hasOwnProperty(k) && !extraKeys.includes(k))
      .map(k => [k, editableStyleMap.value[k]]);
    if (entries.length) acc[cat] = Object.fromEntries(entries);
    return acc;
  }, {});
});

function goBack() {
  if (props.config.onBack) {
    props.config.onBack();
  } else {
    router.push('/');
  }
}

function showDebugHtml() {
  const htmlContent = props.config.getDebugHtml();
  if (htmlContent) {
    const newWindow = window.open();
    newWindow.document.write(htmlContent);
    newWindow.document.close();
  } else {
    alert('Debug HTML is not available yet. Please wait a moment for it to generate.');
  }
}

// Provide a small mapping from action id -> lucide icon component
function iconForAction(id) {
  const map = {
    'show-styles': Palette,
    'show-editor': Edit3
  };
  return map[id] || Settings;
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