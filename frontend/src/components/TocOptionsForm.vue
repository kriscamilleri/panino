<template>
    <form
        class="pn-toc-form"
        data-testid="toc-options-form"
        @submit.prevent="submit"
    >
        <fieldset class="pn-toc-form-row">
            <legend class="pn-toc-form-legend">Headings</legend>
            <label class="pn-toc-form-inline">
                From
                <select
                    v-model.number="min"
                    data-testid="toc-options-min"
                >
                    <option
                        v-for="level in LEVELS"
                        :key="level"
                        :value="level"
                    >H{{ level }}</option>
                </select>
            </label>
            <label class="pn-toc-form-inline">
                to
                <select
                    v-model.number="max"
                    data-testid="toc-options-max"
                >
                    <option
                        v-for="level in LEVELS"
                        :key="level"
                        :value="level"
                        :disabled="level < min"
                    >H{{ level }}</option>
                </select>
            </label>
        </fieldset>

        <fieldset class="pn-toc-form-row">
            <legend class="pn-toc-form-legend">List style</legend>
            <label class="pn-toc-form-inline">
                <input
                    v-model="numbered"
                    type="radio"
                    :value="true"
                    data-testid="toc-options-numbered"
                >
                Numbered (1, 1.1, 1.2)
            </label>
            <label class="pn-toc-form-inline">
                <input
                    v-model="numbered"
                    type="radio"
                    :value="false"
                    data-testid="toc-options-bullets"
                >
                Bullets
            </label>
        </fieldset>

        <fieldset class="pn-toc-form-row pn-toc-form-column">
            <legend class="pn-toc-form-legend">Title</legend>
            <input
                v-model="title"
                type="text"
                class="pn-toc-form-text"
                :maxlength="MAX_TOC_TITLE_LENGTH"
                :disabled="noTitle"
                aria-label="Title"
                data-testid="toc-options-title"
            >
            <label class="pn-toc-form-inline">
                <input
                    v-model="noTitle"
                    type="checkbox"
                    data-testid="toc-options-no-title"
                >
                No title
            </label>
        </fieldset>

        <p class="pn-toc-form-help">
            Refresh rewrites the table, so edits inside it are lost. A heading that uses
            GLOBAL_DATE or GLOBAL_TIME makes the table go out of date every day or minute.
        </p>

        <div class="pn-toc-form-actions">
            <BaseButton
                type="button"
                variant="secondary"
                data-testid="toc-options-cancel"
                @click="$emit('cancel')"
            >Cancel</BaseButton>
            <BaseButton
                type="submit"
                data-testid="toc-options-apply"
            >Apply</BaseButton>
        </div>
    </form>
</template>

<script setup>
// Options for a table of contents (docs/specs/active/editor-toc-and-internal-links.md §4.4):
// heading levels, outline numbers or bullets, and the title. Used in the desktop dialog
// and the phone sheet. Apply rewrites the marker and refreshes the table.
import { ref, watch } from 'vue'
import BaseButton from '@/components/BaseButton.vue'
import { DEFAULT_TOC_TITLE, MAX_TOC_TITLE_LENGTH } from '@panino/content-merge/table-of-contents'

const LEVELS = [1, 2, 3, 4, 5, 6]

const props = defineProps({
    initial: { type: Object, default: null },
})
const emit = defineEmits(['apply', 'cancel'])

const min = ref(2)
const max = ref(3)
const numbered = ref(true)
const title = ref(DEFAULT_TOC_TITLE)
const noTitle = ref(false)

watch(() => props.initial, (value) => {
    min.value = value?.min ?? 2
    max.value = value?.max ?? Math.min((value?.min ?? 2) + 1, 6)
    numbered.value = value?.numbered !== false
    noTitle.value = value?.title === ''
    title.value = value?.title ? value.title : DEFAULT_TOC_TITLE
}, { immediate: true })

watch(min, (value) => {
    if (max.value < value) max.value = value
})

function submit() {
    const chosenTitle = noTitle.value ? '' : (title.value.trim() || DEFAULT_TOC_TITLE).slice(0, MAX_TOC_TITLE_LENGTH)
    emit('apply', { min: min.value, max: Math.max(min.value, max.value), numbered: numbered.value, title: chosenTitle })
}
</script>

<style scoped>
.pn-toc-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.pn-toc-form-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    border: 0;
    margin: 0;
    padding: 0;
}

.pn-toc-form-column {
    flex-direction: column;
    align-items: stretch;
}

.pn-toc-form-legend {
    margin-bottom: 0.35rem;
    font-weight: 600;
}

.pn-toc-form-inline {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
}

.pn-toc-form-inline select,
.pn-toc-form-text {
    padding: 0.35rem 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    background: inherit;
    color: inherit;
    font-size: 16px;
}

.pn-toc-form-help {
    color: #6b7280;
    font-size: 0.8rem;
    line-height: 1.4;
}

.pn-toc-form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}
</style>
