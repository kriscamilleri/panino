<template>
    <div class="min-h-screen flex flex-col">
        <!-- Top Navbar with "Export to JSON" and "Styles" -->
        <div class="flex justify-end items-center bg-gray-200 p-3 space-x-2">
            <button class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded" @click="handleExport">
                Export to JSON
            </button>

            <button class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded" @click="goToStyles">
                Styles
            </button>
        </div>

        <!-- Collapsible toggles for sidebar, editor, preview -->
        <div class="flex space-x-4 p-2 border-b items-center">
            <label class="flex items-center space-x-2">
                <input type="checkbox" v-model="ui.showSidebar" />
                <span>Show Sidebar</span>
            </label>
            <label class="flex items-center space-x-2">
                <input type="checkbox" v-model="ui.showEditor" />
                <span>Show Editor</span>
            </label>
            <label class="flex items-center space-x-2">
                <input type="checkbox" v-model="ui.showPreview" />
                <span>Show Preview</span>
            </label>
        </div>

        <!-- Main content area -->
        <div class="flex flex-1">
            <!-- Sidebar (collapsible) -->
            <aside v-if="ui.showSidebar" class="w-64 bg-gray-100 p-4 border-r overflow-y-auto h-[calc(100vh-8rem)]">
                <Sidebar />
            </aside>

            <!-- Editor + Preview layout -->
            <div class="flex-1 p-4 flex" :class="ui.showSidebar ? 'flex' : 'flex'">
                <!-- Editor (collapsible) -->
                <div v-if="ui.showEditor" class="flex-1 mr-4 border-r pr-4">
                    <Editor />
                </div>

                <!-- Preview (collapsible) -->
                <div v-if="ui.showPreview" class="flex-1">
                    <Preview />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { useDocStore } from '@/store/docStore'
import { useUiStore } from '@/store/uiStore'
import Sidebar from '@/components/Sidebar.vue'
import Editor from '@/components/Editor.vue'
import Preview from '@/components/Preview.vue'
import { useRouter } from 'vue-router'

const docStore = useDocStore()
const ui = useUiStore()
const router = useRouter()

function handleExport() {
    const jsonString = docStore.exportJson()
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = 'data.json'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
}

function goToStyles() {
    router.push('/styles')
}
</script>