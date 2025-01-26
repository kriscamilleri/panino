<template>
    <div class="min-h-screen bg-gray-50 flex flex-col">
        <!-- Top Navigation Bar -->
        <nav class="bg-gray-100 border-b">
            <div class="flex items-center justify-between px-4 py-2">
                <h1 class="text-xl font-semibold text-gray-800">Print Settings</h1>
                <button @click="goBack"
                    class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded flex items-center space-x-2">
                    <ArrowLeft class="w-4 h-4" />
                    <span>Back</span>
                </button>
            </div>
        </nav>

        <!-- Main Content -->
        <div class="flex-1 flex overflow-hidden">
            <!-- Templates List -->
            <aside class="w-64 border-r bg-white p-4 overflow-y-auto">
                <h2 class="text-lg font-bold mb-2">Templates</h2>

                <button @click="handleCreateTemplate" class="w-full mb-4 inline-flex items-center justify-center px-4 py-2 bg-gray-800 
                   text-white text-sm font-medium rounded-md shadow-sm 
                   hover:bg-gray-900 transition-colors">
                    + New Template
                </button>

                <ul class="space-y-1">
                    <li v-for="tmpl in printStore.templates" :key="tmpl.id" :class="[
                        'cursor-pointer px-2 py-1 rounded',
                        tmpl.id === printStore.activeTemplateId
                            ? 'bg-gray-200 font-semibold'
                            : 'hover:bg-gray-50'
                    ]" @click="setActive(tmpl.id)">
                        {{ tmpl.name }}
                    </li>
                </ul>
            </aside>

            <!-- Template Editor (Right Side) -->
            <div class="flex-1 flex flex-col">
                <div class="px-6 py-2 border-b flex items-center space-x-4">
                    <!-- Tabs -->
                    <button :class="[
                        'px-3 py-1 rounded transition-colors',
                        activeTab === 'settings' ? 'bg-gray-200 font-semibold' : 'hover:bg-gray-50'
                    ]" @click="activeTab = 'settings'">
                        Settings
                    </button>
                    <button :class="[
                        'px-3 py-1 rounded transition-colors',
                        activeTab === 'styles' ? 'bg-gray-200 font-semibold' : 'hover:bg-gray-50'
                    ]" @click="activeTab = 'styles'">
                        Styles
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto p-6" v-if="current">
                    <div class="flex items-center justify-between mb-4">
                        <h2 class="text-lg font-bold">
                            Editing: {{ current.name }}
                        </h2>
                        <button @click="handleDeleteTemplate(current.id)"
                            class="px-3 py-1 text-sm text-red-500 border border-red-300 rounded hover:bg-red-50">
                            Delete
                        </button>
                    </div>

                    <!-- Template Name -->
                    <div class="mb-6">
                        <label class="block text-sm font-medium text-gray-700 mb-1">
                            Template Name
                        </label>
                        <input v-model="localTemplate.name" type="text" class="w-full border rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500 
                       focus:border-gray-500" @input="debounceSave" />
                    </div>

                    <!-- TAB 1: SETTINGS -->
                    <div v-if="activeTab === 'settings'">
                        <div class="grid grid-cols-2 gap-6">
                            <!-- Leading Page -->
                            <div>
                                <div class="flex items-center space-x-2 mb-2">
                                    <input id="enableLeadingPage" type="checkbox"
                                        v-model="localTemplate.enableLeadingPage" @change="debounceSave" />
                                    <label for="enableLeadingPage" class="text-sm font-medium text-gray-700">Enable
                                        Leading Page</label>
                                </div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">Leading Page HTML</label>
                                <textarea v-model="localTemplate.leadingPageHtml"
                                    :disabled="!localTemplate.enableLeadingPage" rows="4" class="w-full border rounded px-3 py-2 font-mono text-sm focus:outline-none
                           focus:ring-1 focus:ring-gray-500 focus:border-gray-500 disabled:opacity-50"
                                    @input="debounceSave" />
                            </div>

                            <!-- Trailing Page -->
                            <div>
                                <div class="flex items-center space-x-2 mb-2">
                                    <input id="enableTrailingPage" type="checkbox"
                                        v-model="localTemplate.enableTrailingPage" @change="debounceSave" />
                                    <label for="enableTrailingPage" class="text-sm font-medium text-gray-700">Enable
                                        Trailing Page</label>
                                </div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">Trailing Page HTML</label>
                                <textarea v-model="localTemplate.trailingPageHtml"
                                    :disabled="!localTemplate.enableTrailingPage" rows="4" class="w-full border rounded px-3 py-2 font-mono text-sm focus:outline-none
                           focus:ring-1 focus:ring-gray-500 focus:border-gray-500 disabled:opacity-50"
                                    @input="debounceSave" />
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-6 mt-6">
                            <!-- Header -->
                            <div>
                                <div class="flex items-center space-x-2 mb-2">
                                    <input id="enableHeader" type="checkbox" v-model="localTemplate.enableHeader"
                                        @change="debounceSave" />
                                    <label for="enableHeader" class="text-sm font-medium text-gray-700">Enable
                                        Header</label>
                                </div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">Header HTML</label>
                                <textarea v-model="localTemplate.headerHtml" :disabled="!localTemplate.enableHeader"
                                    rows="3" class="w-full border rounded px-3 py-2 font-mono text-sm focus:outline-none
                           focus:ring-1 focus:ring-gray-500 focus:border-gray-500 disabled:opacity-50"
                                    @input="debounceSave" />
                            </div>

                            <!-- Footer -->
                            <div>
                                <div class="flex items-center space-x-2 mb-2">
                                    <input id="enableFooter" type="checkbox" v-model="localTemplate.enableFooter"
                                        @change="debounceSave" />
                                    <label for="enableFooter" class="text-sm font-medium text-gray-700">Enable
                                        Footer</label>
                                </div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">Footer HTML</label>
                                <textarea v-model="localTemplate.footerHtml" :disabled="!localTemplate.enableFooter"
                                    rows="3" class="w-full border rounded px-3 py-2 font-mono text-sm focus:outline-none
                           focus:ring-1 focus:ring-gray-500 focus:border-gray-500 disabled:opacity-50"
                                    @input="debounceSave" />
                            </div>
                        </div>
                    </div>

                    <!-- TAB 2: STYLES -->
                    <div v-else-if="activeTab === 'styles'">
                        <div class="mb-4">
                            <label class="block text-sm font-medium text-gray-700 mb-1">
                                Tailwind Classes for Overall Print Layout
                            </label>
                            <textarea v-model="localTemplate.tailwindClasses" rows="2" class="w-full border rounded px-3 py-2 font-mono text-sm focus:outline-none
                         focus:ring-1 focus:ring-gray-500 focus:border-gray-500" @input="debounceSave" />
                            <p class="mt-2 text-xs text-gray-600">
                                These classes will be applied to the <code>&lt;body&gt;</code> in the print
                                window, allowing you to adjust layout, typography, etc.
                            </p>
                        </div>
                    </div>
                </div>

                <!-- If no current template is selected -->
                <div class="flex-1 p-6 text-gray-500" v-else>
                    No templates found. Click "New Template" to create one.
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import { usePrintSettingsStore } from '@/store/printSettingsStore'

const router = useRouter()
const printStore = usePrintSettingsStore()

// Local copy of the currently active template
const localTemplate = ref(null)

// Track which tab is active: 'settings' or 'styles'
const activeTab = ref('settings')

onMounted(async () => {
    // Make sure print settings are loaded
    if (!printStore.isLoaded) {
        await printStore.loadPrintSettings()
    }
    syncLocalTemplate()
})

const current = computed(() => printStore.currentTemplate())

function syncLocalTemplate() {
    if (current.value) {
        // Make a deep copy so we can watch changes easily
        localTemplate.value = JSON.parse(JSON.stringify(current.value))
    } else {
        localTemplate.value = null
    }
}

async function setActive(id) {
    await printStore.setActiveTemplate(id)
    syncLocalTemplate()
}

async function handleCreateTemplate() {
    const newId = 'tmpl-' + Date.now().toString(36)
    const blankTemplate = {
        id: newId,
        name: 'Untitled',
        tailwindClasses: '',
        leadingPageHtml: '',
        trailingPageHtml: '',
        headerHtml: '',
        footerHtml: '',
        enableLeadingPage: true,
        enableTrailingPage: true,
        enableHeader: true,
        enableFooter: true
    }
    await printStore.upsertTemplate(blankTemplate)
    await printStore.setActiveTemplate(newId)
    syncLocalTemplate()
}

async function handleDeleteTemplate(templateId) {
    if (!templateId) return
    const confirmed = confirm('Are you sure you want to delete this template?')
    if (confirmed) {
        await printStore.removeTemplate(templateId)
        syncLocalTemplate()
    }
}

// Debounce the saving to avoid thrashing the DB on every keystroke
let saveTimeout = null
function debounceSave() {
    if (saveTimeout) {
        clearTimeout(saveTimeout)
    }
    saveTimeout = setTimeout(() => {
        saveTimeout = null
        saveTemplate()
    }, 500)
}

async function saveTemplate() {
    if (!localTemplate.value) return
    await printStore.upsertTemplate(localTemplate.value)
}

// Watch activeTemplateId from the store. If it changes externally, re-sync
watch(() => printStore.activeTemplateId, () => {
    syncLocalTemplate()
})

function goBack() {
    router.push('/')
}
</script>