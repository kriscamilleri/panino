<template>
    <div
        class="ph-capture-bar"
        data-testid="phone-capture-bar"
    >
        <button
            type="button"
            class="ph-capture-field"
            data-testid="phone-capture-open"
            @click="$emit('capture', 'note')"
        >{{ placeholder }}</button>
        <button
            type="button"
            class="ph-icon-btn"
            aria-label="New checklist"
            data-testid="phone-capture-checklist"
            @click="$emit('capture', 'checklist')"
        >
            <ListChecks
                class="h-6 w-6"
                aria-hidden="true"
            />
        </button>
        <button
            v-if="showTemplates"
            type="button"
            class="ph-icon-btn"
            aria-label="New from template"
            data-testid="phone-capture-template"
            @click="$emit('template')"
        >
            <LayoutTemplate
                class="h-6 w-6"
                aria-hidden="true"
            />
        </button>
        <button
            v-if="showNewFolder"
            type="button"
            class="ph-icon-btn"
            aria-label="New subfolder"
            data-testid="phone-capture-folder"
            @click="$emit('folder')"
        >
            <FolderPlus
                class="h-6 w-6"
                aria-hidden="true"
            />
        </button>
        <button
            type="button"
            class="ph-capture-plus"
            aria-label="New note"
            data-testid="phone-capture-plus"
            @click="$emit('capture', 'note')"
        >
            <Plus
                class="h-7 w-7"
                aria-hidden="true"
            />
        </button>
    </div>
</template>

<script setup>
import { ListChecks, LayoutTemplate, FolderPlus, Plus } from 'lucide-vue-next'

defineProps({
    placeholder: { type: String, default: 'Take a note…' },
    showTemplates: { type: Boolean, default: true },
    showNewFolder: { type: Boolean, default: false },
})

defineEmits(['capture', 'template', 'folder'])
</script>

<style scoped>
.ph-capture-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 76px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
    background: var(--ph-surface);
    border-top: 1px solid var(--ph-line);
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.05);
}

.ph-capture-field {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0 16px;
    border: 0;
    border-radius: 9999px;
    background: var(--ph-canvas);
    color: var(--ph-muted);
    font-size: 16px;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ph-capture-plus {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    margin-left: 4px;
    border: 0;
    border-radius: 6px;
    background: var(--ph-accent);
    color: var(--ph-accent-ink);
    box-shadow: var(--ph-shadow);
}
</style>
