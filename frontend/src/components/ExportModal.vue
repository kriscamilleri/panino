<template>
    <div
        v-if="show"
        class="fixed inset-0 flex items-center justify-center z-50"
        data-testid="export-modal-container"
    >
        <div
            class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
            @click="$emit('close')"
        ></div>

        <div class="relative bg-white rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
            <div class="px-6 py-4 border-b">
                <div class="flex justify-between items-center">
                    <h3 class="text-xl font-semibold text-gray-800">Export Data</h3>
                    <button
                        @click="$emit('close')"
                        class="text-gray-400 hover:text-gray-600 transition-colors"
                        data-testid="export-modal-close-button"
                    >
                        <X class="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div class="px-6 py-4 flex-1 overflow-y-auto">
                <p class="text-sm text-gray-600 mb-6">Choose an export format. All your notes, folders, images,
                    settings, and variables will be included in the export.</p>

                <div class="space-y-4">
                    <button
                        @click="handleExport('json')"
                        class="w-full text-left flex items-center space-x-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                        data-testid="export-modal-panino-json"
                    >
                        <FileJson class="w-8 h-8 text-gray-500" />
                        <div>
                            <p class="font-semibold text-gray-800">Panino JSON</p>
                            <p class="text-sm text-gray-500">A single JSON file containing all your notes, folders,
                                images, settings, and variables. Ideal for full backups or migrating to another Panino instance.</p>
                        </div>
                    </button>

                    <button
                        @click="handleExport('stackedit')"
                        class="w-full text-left flex items-center space-x-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                        data-testid="export-modal-stackedit-json"
                    >
                        <FileJson class="w-8 h-8 text-gray-500" />
                        <div>
                            <p class="font-semibold text-gray-800">StackEdit JSON</p>
                            <p class="text-sm text-gray-500">A single JSON file compatible with the StackEdit format,
                                allowing you to import your data there.</p>
                        </div>
                    </button>

                    <button
                        @click="handleExport('zip')"
                        class="w-full text-left flex items-center space-x-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                        data-testid="export-modal-markdown-zip"
                    >
                        <FolderArchive class="w-8 h-8 text-gray-500" />
                        <div>
                            <p class="font-semibold text-gray-800">Markdown Files (.zip)</p>
                            <p class="text-sm text-gray-500">A ZIP archive containing all your notes as individual `.md`
                                files, organized in their respective folders, plus images and settings.</p>
                        </div>
                    </button>
                </div>
                <div
                    v-if="error"
                    class="mt-4 p-4 bg-red-50 border border-red-200 rounded-md"
                    data-testid="export-modal-error"
                >
                    <div class="flex">
                        <AlertCircle class="w-5 h-5 text-red-400 mr-2" />
                        <p class="text-sm text-red-600">{{ error }}</p>
                    </div>
                </div>
            </div>

            <div class="px-6 py-4 bg-gray-50 rounded-b-lg border-t">
                <div class="flex justify-end">
                    <button
                        @click="$emit('close')"
                        class="px-4 py-2 text-sm font-medium text-gray-700
                                       bg-white border border-gray-300 rounded-md
                                       hover:bg-gray-50 transition-colors"
                        data-testid="export-modal-done-button"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { X, FileJson, FolderArchive, AlertCircle } from 'lucide-vue-next';

defineProps({
    show: Boolean
});

defineEmits(['close']);
const docStore = useDocStore();
const uiStore = useUiStore();
const error = ref('');

async function handleExport(format) {
    error.value = '';
    try {
        switch (format) {
            case 'json':
                await exportJson();
                break;
            case 'stackedit':
                await exportStackEdit();
                break;
            case 'zip':
                await exportZip();
                break;
        }
        uiStore.addToast(`Exported as ${format.toUpperCase()} successfully!`, 'success');
    } catch (err) {
        console.error(`Failed to export as ${format}:`, err);
        error.value = `Failed to export as ${format.toUpperCase()}: ${err.message}`;
    }
}

async function exportJson() {
    const jsonString = await docStore.exportJson();
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, 'panino-export.json');
}

async function exportStackEdit() {
    const jsonString = await docStore.exportStackEditJson();
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    downloadFile(url, 'panino-stackedit-export.json');
}

async function exportZip() {
    await docStore.exportZip(); // This one handles its own download
}

function downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
</script>
