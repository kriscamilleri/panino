<template>
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <nav class="bg-gray-100 border-b">
      <div class="flex items-center justify-between px-4 py-2">
        <h1 class="text-xl font-semibold text-gray-800">{{ config.title }}</h1>
        <div class="flex items-center space-x-2">
          <button
            @click="toggleStylesCustomization"
            class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2"
            :class="{ 'bg-gray-200': showStylesCustomization }"
          >
            <Settings class="w-4 h-4" />
            <span>{{ showStylesCustomization ? 'Hide' : 'Show' }} Styles</span>
          </button>
          <button
            @click="goBack"
            class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2"
          >
            <ArrowLeft class="w-4 h-4" />
            <span>Back</span>
          </button>
        </div>
      </div>
    </nav>

    <div class="flex-1 flex overflow-hidden">
      <!-- LEFT: Styles editor panel -->
      <div
        v-if="showStylesCustomization"
        class="w-1/2 p-8 overflow-y-auto"
        :style="{ height: 'calc(100vh - 56px)' }"
      >
        <div class="bg-white shadow-lg rounded-lg p-8 h-full overflow-y-auto">
          <div class="space-y-6">
            <!-- 1) Categorized CSS fields -->
            <div
              v-for="(styles, category) in categorizedStyles"
              :key="category"
              class="space-y-4"
            >
              <h2 class="text-lg font-semibold text-gray-700 border-b pb-2">
                {{ category }}
              </h2>
              <div v-for="(value, key) in styles" :key="key" class="space-y-2">
                <label :for="key" class="block text-sm font-medium text-gray-700">
                  {{ key }}
                </label>
                <textarea
                  :id="key"
                  v-model="editableStyleMap[key]"
                  @input="handleStyleChange(key, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                  rows="3"
                  :placeholder="`CSS styles for ${key} element`"
                />
              </div>
            </div>

            <!-- 2) Extra fields (inputs, textareas, selects, checkbox, font-picker) -->
            <div
              v-if="config.extraFields?.length"
              class="space-y-4 pt-8 border-t"
            >
              <h2 class="text-lg font-semibold text-gray-700">
                {{ config.extraFieldsTitle || 'Additional Settings' }}
              </h2>
              <div
                v-for="field in config.extraFields"
                :key="field.id"
                class="space-y-2"
              >
                <label :for="field.id" class="block text-sm font-medium text-gray-700">
                  {{ field.label }}
                </label>

                <!-- Google-Fonts multi-select -->
                <div
                  v-if="field.id === 'googleFontFamily'"
                  class="font-selector-container space-y-2"
                >
                  <div
                    class="flex flex-wrap gap-2 p-3 border border-gray-300 rounded-md bg-gray-50 min-h-[2.5rem]"
                  >
                    <span
                      v-for="font in selectedFonts"
                      :key="font"
                      class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                    >
                      {{ font }}
                      <button
                        @click="removeFont(font)"
                        class="ml-1 text-blue-600 hover:text-blue-800 font-bold"
                      >
                        ×
                      </button>
                    </span>
                    <input
                      v-model="fontSearchQuery"
                      @input="searchFonts"
                      @keydown="handleFontInputKeydown"
                      @focus="showFontDropdown = true"
                      placeholder="Search Google Fonts..."
                      class="flex-1 min-w-[120px] border-none outline-none bg-transparent text-sm"
                    />
                  </div>
                  <div
                    v-if="showFontDropdown && filteredFonts.length"
                    class="absolute z-50 w-full max-w-md bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
                  >
                    <div
                      v-for="font in filteredFonts.slice(0, 50)"
                      :key="font"
                      @click="addFont(font)"
                      class="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                    >
                      {{ font }}
                    </div>
                  </div>
                </div>

                <!-- textarea -->
                <textarea
                  v-else-if="field.type === 'textarea'"
                  :id="field.id"
                  :rows="field.rows || 4"
                  v-model="editableStyleMap[field.modelKey]"
                  @input="handleStyleChange(field.modelKey, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                  :placeholder="field.placeholder"
                />

                <!-- single-line input -->
                <input
                  v-else-if="field.type === 'input'"
                  :id="field.id"
                  :type="field.inputType || 'text'"
                  v-model="editableStyleMap[field.modelKey]"
                  @input="handleStyleChange(field.modelKey, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                  :class="field.inputType === 'color' ? 'h-10' : ''"
                  :placeholder="field.placeholder"
                />

                <!-- select dropdown -->
                <select
                  v-else-if="field.type === 'select'"
                  :id="field.id"
                  v-model="editableStyleMap[field.modelKey]"
                  @change="handleStyleChange(field.modelKey, $event.target.value)"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                >
                  <option
                    v-for="opt in field.options"
                    :key="opt.value"
                    :value="opt.value"
                  >
                    {{ opt.text }}
                  </option>
                </select>

                <!-- checkbox -->
                <div
                  v-else-if="field.type === 'checkbox'"
                  class="flex items-center"
                >
                  <input
                    :id="field.id"
                    type="checkbox"
                    :checked="
                      editableStyleMap[field.modelKey] === true ||
                      editableStyleMap[field.modelKey] === 'true'
                    "
                    @change="handleStyleChange(field.modelKey, $event.target.checked)"
                    class="h-4 w-4 text-gray-600 border-gray-300 rounded focus:ring-gray-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <hr class="my-6" />
          <button
            @click="resetStyles"
            class="px-4 py-2 text-red-700 bg-red-50 hover:bg-red-100 rounded flex items-center space-x-2 border border-red-200"
          >
            <span>Reset to Defaults</span>
          </button>
        </div>
      </div>

      <!-- RIGHT: preview slot -->
      <div
        :class="showStylesCustomization ? 'w-1/2' : 'w-full'"
        class="bg-white border-l overflow-hidden"
        :style="{ height: 'calc(100vh - 56px)' }"
      >
        <slot />
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
  /** 
   * config must provide:
   *  - title: string
   *  - getStyles(): object
   *  - updateStyleAction(key, value): void
   *  - styleCategories: Record<string, string[]>
   *  - extraFields?: Array<{ id, label, type, modelKey, … }>
   *  - extraFieldsTitle?: string
   *  - resetStyles(): void
   *  - onBack?(): void
   */
  config: { type: Object, required: true }
});

const router = useRouter();
const editableStyleMap = ref({});
const showStylesCustomization = ref(false);

// Google-font picker state
const selectedFonts = ref([]);
const fontSearchQuery = ref('');
const showFontDropdown = ref(false);
const allGoogleFonts = ref([]);
const filteredFonts = ref([]);

const popularGoogleFonts = [
  'Inter','Roboto','Open Sans','Lato','Montserrat','Source Sans Pro','Raleway','PT Sans',
  'Libre Baskerville','Merriweather','Playfair Display','Georgia','Times New Roman','Arial',
  'Helvetica','Poppins','Nunito','Work Sans','Fira Sans','Oswald','Dancing Script','Lobster',
  'Pacifico','Quicksand','Ubuntu','Droid Sans','Roboto Condensed','Cabin','Lora','Crimson Text',
  'Noto Sans','Mukti','Source Code Pro','JetBrains Mono','Fira Code','Inconsolata','IBM Plex Sans',
  'IBM Plex Serif','IBM Plex Mono','Barlow','DM Sans','Rubik','Karla','Oxygen','PT Serif',
  'Titillium Web','Muli','Exo','Comfortaa','Archivo','Hind','Bitter','Josefin Sans'
];

// debounce calls to store
const debouncedUpdateStore = useDebounceFn((k, v) => props.config.updateStyleAction(k, v), 300);

onMounted(() => {
  allGoogleFonts.value = [...popularGoogleFonts];
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  // clean up injected <style id="markdown-custom-styles">
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

// Initialize local map whenever store styles change
watch(
  () => props.config.getStyles(),
  newStyles => {
    const proc = { ...newStyles };
    // coerce checkbox fields
    props.config.extraFields?.forEach(f => {
      if (f.type === 'checkbox' && typeof proc[f.modelKey] !== 'boolean') {
        proc[f.modelKey] = String(proc[f.modelKey]).toLowerCase() === 'true';
      }
    });
    editableStyleMap.value = proc;

    // extract googleFontFamily into chips
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
