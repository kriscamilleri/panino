<template>
    <a
        :href="href"
        class="ph-note"
        :class="[`ph-note-${variant}`, { 'ph-note-selected': selected }]"
        :aria-current="selected ? 'true' : undefined"
        :aria-label="accessibleName"
        :data-testid="`phone-note-${doc.id}`"
        @click="handleClick"
        @contextmenu.prevent="$emit('select', doc)"
        @pointerdown="startPress"
        @pointerup="cancelPress"
        @pointerleave="cancelPress"
        @pointercancel="cancelPress"
    >
        <!--
        A real link: it opens the Document, carries its address for "open in
        new tab", and is announced as one. In selection mode a tap toggles
        the card instead, and a long press starts selection.
        -->
        <div class="ph-note-head">
            <h3 class="ph-note-title">{{ doc.name }}</h3>
            <Pin
                v-if="doc.isPinned"
                class="ph-note-pin"
                aria-hidden="true"
            />
            <CheckCircle2
                v-if="selected"
                class="ph-note-check"
                aria-hidden="true"
            />
        </div>

        <ul
            v-if="variant === 'grid' && lines.length"
            class="ph-note-lines"
        >
            <li
                v-for="(line, index) in lines"
                :key="index"
                :class="[`ph-kind-${line.kind}`, { 'ph-line-done': line.checked }]"
            >
                <span
                    v-if="line.kind === 'task'"
                    class="ph-line-box"
                    aria-hidden="true"
                ><Check
                    v-if="line.checked"
                    class="h-3 w-3"
                /></span>
                <span
                    v-else-if="line.kind === 'bullet'"
                    class="ph-line-bullet"
                    aria-hidden="true"
                >•</span>
                <span class="ph-line-text">{{ line.text }}</span>
            </li>
        </ul>
        <p
            v-else-if="variant === 'list' && summary"
            class="ph-note-summary"
        >{{ summary }}</p>

        <div class="ph-note-foot">
            <span
                v-if="folderLabel"
                class="ph-folder-chip"
            >
                <Users
                    v-if="doc.spaceName"
                    class="h-3 w-3"
                    aria-hidden="true"
                />
                {{ folderLabel }}
            </span>
        </div>
    </a>
</template>

<script setup>
import { computed } from 'vue'
import { Pin, Check, CheckCircle2, Users } from 'lucide-vue-next'
import { toSnippetLines, toSummary } from '@/utils/markdownSnippet'

const props = defineProps({
    /** A normalized dashboard Document (recentDocuments.normalizeRecentDocument). */
    doc: { type: Object, required: true },
    variant: { type: String, default: 'grid', validator: (v) => ['grid', 'list'].includes(v) },
    selecting: { type: Boolean, default: false },
    selected: { type: Boolean, default: false },
})

const emit = defineEmits(['open', 'select'])

const LONG_PRESS_MS = 450

const href = computed(() => `#/doc/${encodeURIComponent(props.doc.id)}?dbKey=${encodeURIComponent(props.doc.dbKey)}`)
const lines = computed(() => toSnippetLines(props.doc.content, { title: props.doc.name, maxLines: 8 }))
const summary = computed(() => toSummary(props.doc.content, { title: props.doc.name }))

/** Where the card says the Document lives; nothing for a note in no folder. */
const folderLabel = computed(() => {
    if (props.doc.folderId) return props.doc.folderName.split(' / ').pop()
    return props.doc.spaceName || ''
})

const accessibleName = computed(() => {
    const parts = [props.doc.name]
    if (props.doc.isPinned) parts.push('pinned')
    if (folderLabel.value) parts.push(`in ${folderLabel.value}`)
    if (props.selecting) parts.push(props.selected ? 'selected' : 'not selected')
    return parts.join(', ')
})

let pressTimer = null
let longPressed = false

function startPress(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    longPressed = false
    clearTimeout(pressTimer)
    pressTimer = setTimeout(() => {
        longPressed = true
        emit('select', props.doc)
        navigator.vibrate?.(10)
    }, LONG_PRESS_MS)
}

function cancelPress() {
    clearTimeout(pressTimer)
}

function handleClick(event) {
    // Modified clicks keep the browser's own behaviour (new tab, and so on).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (longPressed) {
        longPressed = false
        return
    }
    if (props.selecting) emit('select', props.doc)
    else emit('open', props.doc)
}
</script>

<style scoped>
.ph-note {
    display: block;
    padding: 12px 14px;
    background: var(--ph-surface);
    border: 1px solid var(--ph-line);
    border-radius: 14px;
    color: var(--ph-ink);
    text-decoration: none;
    -webkit-touch-callout: none;
    user-select: none;
    overflow: hidden;
}

.ph-note:active {
    background: var(--ph-canvas);
}

.ph-note-selected {
    border-color: var(--ph-accent);
    box-shadow: 0 0 0 2px var(--ph-accent);
}

.ph-note-head {
    display: flex;
    align-items: flex-start;
    gap: 6px;
}

.ph-note-title {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
}

.ph-note-pin,
.ph-note-check {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--ph-muted);
}

.ph-note-check {
    color: var(--ph-accent);
}

.ph-note-lines {
    margin-top: 6px;
    font-size: 14px;
    line-height: 1.45;
    color: var(--ph-ink-2);
}

.ph-note-lines li {
    display: flex;
    gap: 6px;
    min-width: 0;
}

.ph-line-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
}

.ph-line-done .ph-line-text {
    color: var(--ph-muted);
    text-decoration: line-through;
}

.ph-line-box {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    margin-top: 3px;
    border: 1.5px solid var(--ph-muted);
    border-radius: 3px;
}

.ph-line-done .ph-line-box {
    background: var(--ph-accent);
    border-color: var(--ph-accent);
    color: var(--ph-accent-ink);
}

.ph-line-bullet {
    flex-shrink: 0;
    width: 14px;
    text-align: center;
    color: var(--ph-muted);
}

.ph-note-summary {
    margin-top: 4px;
    font-size: 14px;
    line-height: 1.4;
    color: var(--ph-ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ph-note-foot {
    margin-top: 10px;
    display: flex;
    min-width: 0;
}
</style>
