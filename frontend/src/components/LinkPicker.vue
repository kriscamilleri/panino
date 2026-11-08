<template>
    <div
        class="pn-link-picker"
        :class="{ 'pn-link-picker-sheet': layout === 'sheet' }"
        data-testid="link-picker"
    >
        <div
            v-if="hasInput"
            class="pn-link-picker-field"
        >
            <input
                ref="inputRef"
                v-model="typed"
                type="text"
                class="pn-link-picker-input"
                placeholder="Search Documents, # for headings, or paste a web address"
                aria-label="Link to"
                autocomplete="off"
                spellcheck="false"
                data-testid="link-picker-input"
                @keydown="onInputKeydown"
            >
        </div>
        <p
            v-else
            class="pn-link-picker-hint"
        >{{ hint }}</p>

        <div
            v-if="confirming"
            class="pn-link-picker-confirm"
            data-testid="link-picker-note"
        >
            <p class="pn-link-picker-note">{{ crossDatabaseNote }}</p>
            <p class="pn-link-picker-label">Link text: <span data-testid="link-picker-label">{{ confirming.labelPreview }}</span></p>
            <div class="pn-link-picker-actions">
                <button
                    type="button"
                    class="pn-link-picker-button"
                    data-testid="link-picker-back"
                    @mousedown.prevent
                    @click="confirming = null"
                >Back</button>
                <button
                    type="button"
                    class="pn-link-picker-button pn-link-picker-primary"
                    data-testid="link-picker-confirm"
                    @mousedown.prevent
                    @click="emitChoice(confirming.markdown)"
                >Insert link</button>
            </div>
        </div>

        <ul
            v-else
            class="pn-link-picker-list"
            role="listbox"
            :aria-label="listLabel"
        >
            <li
                v-for="(row, index) in rows"
                :key="row.key"
                role="option"
                :aria-selected="index === active"
                class="pn-link-picker-row"
                :class="{ 'pn-link-picker-active': index === active }"
                :data-testid="`link-picker-row-${index}`"
                @mousedown.prevent
                @mouseenter="active = index"
                @click="choose(row)"
            >
                <span class="pn-link-picker-title">{{ row.title }}</span>
                <span
                    v-if="row.meta"
                    class="pn-link-picker-meta"
                >{{ row.meta }}</span>
            </li>
            <li
                v-if="!rows.length"
                class="pn-link-picker-empty"
                data-testid="link-picker-empty"
            >{{ loading ? 'Searching…' : emptyText }}</li>
        </ul>
    </div>
</template>

<script setup>
// The one link picker (docs/specs/active/editor-toc-and-internal-links.md §6.4): Documents
// in every open database by title, this Document's headings after `#`, another
// Document's headings after choosing it and typing `#`, and (with its own field) a web
// address. A target in another database shows a note and the link text before it is
// written. Rows are text nodes; nothing here builds HTML.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useDocumentLinkStore } from '@/store/documentLinkStore'
import {
    documentLinkMarkdown,
    documentLocation,
    headingLinkMarkdown,
    isWebAddress,
    linkDestination,
} from '@/utils/editorLinks'
import { escapeInlineText } from '@panino/content-merge/marker-blocks'

const props = defineProps({
    // 'wikilink': the query is typed in the editor after `[[`; 'link': this has a field.
    mode: { type: String, default: 'link' },
    // The `[[` query, or the field's first text.
    query: { type: String, default: '' },
    // Selected text: the link's label, as written.
    label: { type: String, default: '' },
    sourceId: { type: String, default: null },
    sourceDbKey: { type: String, default: null },
    // A key the editor forwarded to a `[[` picker: `{ key, nonce }`.
    forwardedKey: { type: Object, default: null },
    layout: { type: String, default: 'popover' },
})
const emit = defineEmits(['choose', 'close'])

const docStore = useDocStore()
const syncStore = useSyncStore()
const linkStore = useDocumentLinkStore()

const inputRef = ref(null)
const typed = ref(props.query)
const active = ref(0)
const loading = ref(false)
const documents = ref([])
const headings = ref([])
const staged = ref(null)
const confirming = ref(null)

const hasInput = computed(() => props.mode !== 'wikilink')
const text = computed(() => (hasInput.value ? typed.value : props.query))
const hashAt = computed(() => text.value.indexOf('#'))
const docQuery = computed(() => (hashAt.value === -1 ? text.value : text.value.slice(0, hashAt.value)).trim())
const headingQuery = computed(() => (hashAt.value === -1 ? '' : text.value.slice(hashAt.value + 1)).trim().toLowerCase())
const headingMode = computed(() => hashAt.value !== -1)
const ownHeadings = computed(() => headingMode.value && docQuery.value === '')

const hint = computed(() => (headingMode.value
    ? 'Headings · Enter to link'
    : 'Documents · type # for headings · Enter to link'))
const listLabel = computed(() => (headingMode.value ? 'Headings' : 'Documents'))
const emptyText = computed(() => (headingMode.value ? 'No matching headings' : 'No matching Documents'))

const sourceEntry = computed(() => (props.sourceDbKey ? syncStore.databases.get(props.sourceDbKey) : null))

function formatUpdated(value) {
    if (!value) return ''
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

const rows = computed(() => {
    if (headingMode.value) {
        const target = ownHeadings.value ? null : staged.value
        return headings.value
            .filter((heading) => !headingQuery.value || heading.text.toLowerCase().includes(headingQuery.value))
            .slice(0, 20)
            .map((heading) => ({
                key: `h:${heading.slug}`,
                type: 'heading',
                heading,
                target,
                title: heading.text || 'Untitled heading',
                meta: target ? target.title : `H${heading.level}`,
            }))
    }
    const list = documents.value.map((doc) => ({
        key: `d:${doc.dbKey}:${doc.id}`,
        type: 'document',
        target: doc,
        title: doc.title,
        meta: [documentLocation(doc), formatUpdated(doc.updatedAt)].filter(Boolean).join(' · '),
    }))
    if (hasInput.value && isWebAddress(text.value)) {
        list.unshift({ key: 'url', type: 'url', url: text.value.trim(), title: `Link to ${text.value.trim()}`, meta: 'Web address' })
    }
    return list
})

watch(rows, () => {
    if (active.value >= rows.value.length) active.value = Math.max(0, rows.value.length - 1)
})

let searchTimer = null
let searchRun = 0
watch(docQuery, (query) => {
    if (headingMode.value) return
    clearTimeout(searchTimer)
    const run = ++searchRun
    loading.value = true
    searchTimer = setTimeout(async () => {
        try {
            const found = await linkStore.searchLinkTargets(query, { preferDbKey: props.sourceDbKey })
            if (run === searchRun) {
                documents.value = found
                active.value = 0
            }
        } finally {
            if (run === searchRun) loading.value = false
        }
    }, 120)
}, { immediate: true })

let headingRun = 0
async function loadHeadings() {
    const run = ++headingRun
    if (!headingMode.value) return
    if (ownHeadings.value) {
        headings.value = props.sourceId && props.sourceDbKey
            ? await docStore.getDocumentOutline(props.sourceId, props.sourceDbKey)
            : []
    } else {
        if (!staged.value) {
            // `[[Project plan#` typed without choosing: the best match.
            const found = await linkStore.searchLinkTargets(docQuery.value, { preferDbKey: props.sourceDbKey, limit: 1 })
            if (run !== headingRun) return
            staged.value = found[0] || null
        }
        headings.value = staged.value ? await docStore.getDocumentOutline(staged.value.id, staged.value.dbKey) : []
    }
    if (run === headingRun) active.value = 0
}

watch(headingMode, (on, was) => {
    if (on && !was) {
        // The Document highlighted when `#` was typed is the one whose headings show.
        const row = rows.value[active.value]
        staged.value = !ownHeadings.value && row?.type === 'document' ? row.target : null
    }
    if (!on) staged.value = null
    void loadHeadings()
}, { immediate: true })
watch(docQuery, () => {
    if (headingMode.value) {
        staged.value = null
        void loadHeadings()
    }
})

const crossDatabaseNote = computed(() => {
    const target = confirming.value?.target
    if (!target) return ''
    if (sourceEntry.value?.kind === 'space') {
        return `Members of ${sourceEntry.value.name || 'this space'} may not be able to open this Document.`
    }
    if (target.spaceName) return `Only members of ${target.spaceName} can open this Document.`
    return 'People who can read this Document may not be able to open the one it links to.'
})

function emitChoice(markdown) {
    confirming.value = null
    emit('choose', markdown)
}

function choose(row) {
    if (!row) return
    if (row.type === 'url') {
        const label = props.label || escapeInlineText(row.url)
        emitChoice(`[${label}](${linkDestination(row.url)})`)
        return
    }
    if (row.type === 'heading') {
        emitChoice(row.target
            ? documentLinkMarkdown(row.target, row.heading, props.label)
            : headingLinkMarkdown(row.heading, props.label))
        return
    }
    const target = row.target
    const markdown = documentLinkMarkdown(target, null, props.label)
    if (props.sourceDbKey && target.dbKey !== props.sourceDbKey) {
        confirming.value = {
            target,
            markdown,
            labelPreview: props.label || target.title || 'Untitled',
        }
        return
    }
    emitChoice(markdown)
}

/** @param {string} key */
function handleKey(key) {
    if (confirming.value) {
        if (key === 'Enter') emitChoice(confirming.value.markdown)
        else if (key === 'Escape') confirming.value = null
        return
    }
    if (key === 'ArrowDown') active.value = rows.value.length ? (active.value + 1) % rows.value.length : 0
    else if (key === 'ArrowUp') active.value = rows.value.length ? (active.value - 1 + rows.value.length) % rows.value.length : 0
    else if (key === 'Enter' || key === 'Tab') choose(rows.value[active.value])
    else if (key === 'Escape') emit('close')
}

function onInputKeydown(event) {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return
    if (event.key === 'Tab' && !rows.value.length) return
    event.preventDefault()
    event.stopPropagation()
    handleKey(event.key)
}

watch(() => props.forwardedKey, (forwarded) => {
    if (forwarded?.key) handleKey(forwarded.key)
})

onMounted(() => {
    if (hasInput.value) nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
    })
})

defineExpose({ handleKey })
</script>

<style scoped>
.pn-link-picker {
    display: flex;
    flex-direction: column;
    width: min(28rem, calc(100vw - 1rem));
    max-height: 22rem;
    overflow: hidden;
    border: 1px solid #d1d5db;
    border-radius: 0.5rem;
    background: #fff;
    color: #111827;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
    font-size: 0.9rem;
}

.pn-link-picker-sheet {
    width: 100%;
    max-height: none;
    flex: 1;
    min-height: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
    color: inherit;
}

.pn-link-picker-field {
    padding: 0.5rem;
    border-bottom: 1px solid #e5e7eb;
}

.pn-link-picker-input {
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    background: inherit;
    color: inherit;
    /* 16px, not smaller: iOS Safari zooms the page into any smaller field. */
    font-size: 16px;
}

.pn-link-picker-hint {
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid #e5e7eb;
    color: #6b7280;
    font-size: 0.75rem;
}

.pn-link-picker-list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0.25rem 0;
    overflow-y: auto;
    list-style: none;
}

.pn-link-picker-row {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.45rem 0.75rem;
    cursor: pointer;
}

.pn-link-picker-active {
    background: #eff6ff;
}

.pn-link-picker-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
}

.pn-link-picker-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #6b7280;
    font-size: 0.75rem;
}

.pn-link-picker-empty {
    padding: 0.6rem 0.75rem;
    color: #6b7280;
}

.pn-link-picker-confirm {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
}

.pn-link-picker-note {
    padding: 0.5rem 0.6rem;
    border-radius: 0.375rem;
    background: #fffbeb;
    color: #92400e;
}

.pn-link-picker-label {
    color: #374151;
    overflow-wrap: anywhere;
}

.pn-link-picker-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}

.pn-link-picker-button {
    padding: 0.35rem 0.75rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    background: transparent;
    color: inherit;
    cursor: pointer;
}

.pn-link-picker-primary {
    border-color: #2563eb;
    background: #2563eb;
    color: #fff;
}

:global(html[data-theme='dark']) .pn-link-picker:not(.pn-link-picker-sheet) {
    border-color: #343434;
    background: #2c2c2c;
    color: #d4d4d4;
}

:global(html[data-theme='dark']) .pn-link-picker-active {
    background: #343a46;
}

:global(html[data-theme='dark']) .pn-link-picker-note {
    background: #2a2111;
    color: #fcd34d;
}

:global(html[data-theme='dark']) .pn-link-picker-label {
    color: #c6c6c6;
}
</style>
