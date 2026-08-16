<template>
    <BaseModal
        :show="show"
        title="Export Data"
        size="md"
        close-testid="export-modal-close-button"
        @close="$emit('close')"
    >
        <p class="pn-body mb-5">
            Choose an export format. All your documents, folders, images, settings, and variables will be
            included in the export.
        </p>

        <div class="space-y-3">
            <OptionCard
                :icon="FileJson"
                title="Panino JSON"
                description="A single JSON file containing all your documents, folders, images, settings, and variables. Ideal for full backups or migrating to another Panino instance."
                data-testid="export-modal-panino-json"
                @click="handleExport('json')"
            />

            <OptionCard
                :icon="FileJson"
                title="StackEdit JSON"
                description="A single JSON file compatible with the StackEdit format, allowing you to import your data there."
                data-testid="export-modal-stackedit-json"
                @click="handleExport('stackedit')"
            />

            <OptionCard
                :icon="FolderArchive"
                title="Markdown Files (.zip)"
                description="A ZIP archive containing all your documents as individual `.md` files, organized in their respective folders, plus images and settings."
                data-testid="export-modal-markdown-zip"
                @click="handleExport('zip')"
            />
        </div>

        <div
            v-if="error"
            class="pn-alert pn-alert-error mt-4"
            data-testid="export-modal-error"
        >
            <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
            <p>{{ error }}</p>
        </div>

        <template #footer>
            <BaseButton
                variant="secondary"
                size="md"
                data-testid="export-modal-done-button"
                @click="$emit('close')"
            >
                Done
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup>
import { ref } from 'vue';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { FileJson, FolderArchive, AlertCircle } from 'lucide-vue-next';
import BaseModal from '@/components/BaseModal.vue';
import BaseButton from '@/components/BaseButton.vue';
import OptionCard from '@/components/OptionCard.vue';

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
