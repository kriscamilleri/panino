<template>
    <div class="min-h-screen bg-gray-50 flex flex-col">
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <h1 class="text-xl font-semibold text-gray-800">{{ config.title }}</h1>
                <button @click="goBack"
                    class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2">
                    <ArrowLeft class="w-4 h-4" />
                    <span>Back</span>
                </button>
            </div>
        </nav>
        <div class="flex-1 flex">
            <div class="w-1/2 p-8" style="height: calc(100vh - 56px);">
                <div class="bg-white shadow-lg rounded-lg p-8 h-full overflow-y-auto">
                    <div class="space-y-6">
                        <div v-for="(styles, category) in categorizedStyles" :key="category" class="space-y-4">
                            <h2 class="text-lg font-semibold text-gray-700 border-b pb-2">{{ category }}</h2>
                            <div v-for="(value, key) in styles" :key="key" class="space-y-2">
                                <label :for="key" class="block text-sm font-medium text-gray-700">{{ key }}</label>
                                <input :id="key" type="text" v-model="editableStyleMap[key]"
                                    @input="handleStyleChange(key, editableStyleMap[key])"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono" />
                            </div>
                        </div>
                        <!-- Extra Fields (for Print Header/Footer) -->
                        <div v-if="config.extraFields && config.extraFields.length > 0" class="space-y-4 pt-8 border-t">
                            <h2 class="text-lg font-semibold text-gray-700">{{ config.extraFieldsTitle || 'Additional Settings' }}</h2>
                            <div v-for="field in config.extraFields" :key="field.id" class="space-y-2">
                                <label :for="field.id" class="block text-sm font-medium text-gray-700">{{ field.label }}</label>
                                <textarea v-if="field.type === 'textarea'" :id="field.id" :rows="field.rows || 4"
                                    v-model="editableStyleMap[field.modelKey]"
                                    @input="handleStyleChange(field.modelKey, editableStyleMap[field.modelKey])"
                                    class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm font-mono"
                                    :placeholder="field.placeholder"></textarea>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="w-1/2 bg-white border-l p-8 overflow-y-auto">
                <div class="prose max-w-none" v-html="previewHtmlContent"></div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft } from 'lucide-vue-next';
import { useDebounceFn } from '@vueuse/core'; // Using a composable for debounce

const props = defineProps({
    config: { type: Object, required: true }
});

const router = useRouter();
const editableStyleMap = ref({}); // Local copy for editing

// Initialize and watch for changes from the store if styles are reactive
watchEffect(() => {
    editableStyleMap.value = { ...props.config.getStyles() };
});

const debouncedUpdate = useDebounceFn((key, value) => {
    props.config.updateStyleAction(key, value);
}, 300);

function handleStyleChange(key, newValue) {
    // editableStyleMap is already updated by v-model
    debouncedUpdate(key, newValue);
}

const categorizedStyles = computed(() => {
    const currentStyles = editableStyleMap.value;
    return Object.entries(props.config.styleCategories).reduce((acc, [category, keys]) => {
        acc[category] = Object.fromEntries(
            keys.filter(key => currentStyles.hasOwnProperty(key)).map(key => [key, currentStyles[key]])
        );
        return acc;
    }, {});
});

const previewHtmlContent = computed(() => {
    const md = props.config.getMarkdownIt();
    return md.render(props.config.sampleMarkdown);
});

function goBack() { router.push('/'); }
</script>