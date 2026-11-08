<template>
    <div
        class="flex flex-col min-h-0"
        data-testid="documents-search-panel"
        @keydown.esc.stop="onEscape"
    >
        <div class="relative">
            <Search
                class="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400"
                aria-hidden="true"
            />
            <label
                class="sr-only"
                for="documents-search-input"
            >Search Documents</label>
            <input
                id="documents-search-input"
                ref="inputRef"
                v-model="text"
                type="search"
                maxlength="200"
                autocomplete="off"
                placeholder="Search Documents…"
                class="w-full px-8 py-2 border rounded-lg focus:outline-none focus:border-blue-500 search-input"
                data-testid="documents-search-input"
                @keydown.enter="onEnter"
            >
            <button
                type="button"
                class="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600"
                title="Close search (Esc)"
                aria-label="Close search"
                data-testid="documents-search-close"
                @click="emit('close')"
            >
                <X class="w-4 h-4" />
            </button>
        </div>

        <div class="flex flex-wrap items-center gap-1.5 mt-2">
            <button
                v-for="chip in chips"
                :key="chip.value"
                type="button"
                class="rounded-full border px-2.5 text-xs leading-5"
                :class="chip.on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'"
                :aria-pressed="chip.on"
                :data-testid="`documents-search-chip-${chip.value}`"
                @click="toggleChip(chip.value)"
            >{{ chip.label }}</button>
            <div class="relative ml-auto">
                <button
                    ref="syntaxButtonRef"
                    type="button"
                    class="text-xs text-blue-600 hover:underline"
                    :aria-expanded="showSyntax"
                    aria-controls="documents-search-syntax"
                    data-testid="documents-search-syntax-toggle"
                    @click="toggleSyntax"
                >Search syntax</button>
                <div
                    v-if="showSyntax"
                    id="documents-search-syntax"
                    ref="syntaxRef"
                    tabindex="-1"
                    class="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg focus:outline-none"
                    role="dialog"
                    aria-label="Search syntax"
                    data-testid="documents-search-syntax"
                >
                    <p class="mb-2 text-gray-600">Every part must match. Combine them freely.</p>
                    <dl class="space-y-1.5">
                        <div
                            v-for="row in SEARCH_SYNTAX"
                            :key="row.part"
                        >
                            <dt class="font-mono text-gray-900">{{ row.example }}</dt>
                            <dd class="text-gray-600">{{ row.meaning }}</dd>
                        </div>
                    </dl>
                </div>
            </div>
        </div>

        <ul
            v-if="notices.length"
            class="mt-2 space-y-0.5 text-xs text-amber-700"
            data-testid="documents-search-notices"
        >
            <li
                v-for="notice in notices"
                :key="notice"
            >{{ notice }}</li>
        </ul>

        <div class="mt-2 flex-1 min-h-0">
            <template v-if="!query">
                <div
                    v-if="recent.length"
                    data-testid="documents-search-recent"
                >
                    <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Recent searches</p>
                    <ul>
                        <li
                            v-for="item in recent"
                            :key="item"
                        >
                            <button
                                type="button"
                                class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-gray-200"
                                @click="useRecent(item)"
                            >
                                <History
                                    class="w-4 h-4 text-gray-400"
                                    aria-hidden="true"
                                />
                                <span class="truncate">{{ item }}</span>
                            </button>
                        </li>
                    </ul>
                </div>
                <p
                    v-else
                    class="text-sm text-gray-500 py-2"
                >Search titles and text across all your Documents.</p>
            </template>

            <template v-else>
                <p
                    class="text-xs text-gray-500 mb-1"
                    aria-live="polite"
                    data-testid="documents-search-count"
                >{{ searching ? 'Searching…' : countLabel }}</p>
                <ul
                    v-if="results.length"
                    class="space-y-1"
                    data-testid="documents-search-results"
                >
                    <li
                        v-for="doc in results"
                        :key="`${doc.dbKey}:${doc.id}`"
                    >
                        <a
                            :href="`#/doc/${encodeURIComponent(doc.id)}?dbKey=${encodeURIComponent(doc.dbKey)}`"
                            class="block rounded-md px-2 py-1.5 hover:bg-gray-200 search-result"
                            :class="{ 'bg-gray-200': isSelected(doc) }"
                            :data-testid="`documents-search-result-${doc.id}`"
                            @click.prevent="open(doc)"
                        >
                            <span class="block text-sm font-medium text-gray-900 truncate">
                                <template
                                    v-for="(segment, index) in highlightSegments(doc.name, terms)"
                                    :key="index"
                                >
                                    <mark v-if="segment.match">{{ segment.text }}</mark>
                                    <template v-else>{{ segment.text }}</template>
                                </template>
                            </span>
                            <span class="flex items-center gap-1 text-xs text-gray-500 truncate">
                                <span
                                    v-if="doc.inTrash"
                                    class="rounded bg-gray-200 px-1 font-semibold text-gray-700"
                                    :data-testid="`documents-search-trash-${doc.id}`"
                                >In Trash</span>
                                <span class="truncate">{{ locationOf(doc) }} · {{ formatRelativeTime(doc.displayedDate) }}</span>
                            </span>
                            <span
                                v-if="!chipsOn.titles"
                                class="block text-xs text-gray-600 search-snippet"
                            >
                                <template
                                    v-for="(segment, index) in searchSnippet(doc.content, terms, { title: doc.name })"
                                    :key="index"
                                >
                                    <mark v-if="segment.match">{{ segment.text }}</mark>
                                    <template v-else>{{ segment.text }}</template>
                                </template>
                            </span>
                        </a>
                    </li>
                </ul>
                <button
                    v-if="nextCursor"
                    type="button"
                    class="mt-2 w-full rounded-md border border-gray-300 py-1 text-sm hover:bg-gray-200"
                    :disabled="loadingMore"
                    data-testid="documents-search-more"
                    @click="loadMore"
                >{{ loadingMore ? 'Loading…' : 'Show more' }}</button>
            </template>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { History, Search, X } from 'lucide-vue-next'
import { useDocStore } from '@/store/docStore'
import { useStructureStore } from '@/store/structureStore'
import { useSyncStore } from '@/store/syncStore'
import { resultCountLabel, useDesktopSearchState, useDocumentSearch } from '@/composables/useDocumentSearch'
import {
    chipState,
    clearChips,
    folderSearchPath,
    highlightSegments,
    searchSnippet,
    setChecklistChip,
    setFolderChip,
    setTitlesChip,
    SEARCH_SYNTAX,
} from '@/utils/searchQuery'
import { formatRelativeTime } from '@/utils/recentDocuments'

/**
 * The desktop search panel (docs/specs/active/advanced-search.md §5.1): it
 * replaces the sidebar's tree while open. Esc closes it and the query stays for
 * the session.
 */
const emit = defineEmits(['close'])

const router = useRouter()
const docStore = useDocStore()
const structureStore = useStructureStore()
const syncStore = useSyncStore()
const desktop = useDesktopSearchState()

const inputRef = ref(null)
const syntaxRef = ref(null)
const syntaxButtonRef = ref(null)
const showSyntax = ref(false)
const folderName = ref('')
const folderPath = ref('')

const {
    text, query, results, notices, terms, nextCursor, searching, loadingMore, recent,
    flush, loadMore, remember, setText,
} = useDocumentSearch({ text: desktop.text })

const chipsOn = computed(() => chipState(text.value, folderPath.value))
const chips = computed(() => [
    { value: 'everything', label: 'Everything', on: chipsOn.value.everything },
    { value: 'titles', label: 'Titles', on: chipsOn.value.titles },
    { value: 'checklists', label: 'Checklists', on: chipsOn.value.checklists },
    ...(folderPath.value ? [{ value: 'folder', label: folderName.value || 'This folder', on: chipsOn.value.folder }] : []),
])
const countLabel = computed(() => resultCountLabel(results.value.length, Boolean(nextCursor.value)))

function focusInput() {
    nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
    })
}

onMounted(focusInput)
watch(desktop.focusRequest, focusInput)

// The Folder chip offers the folder selected in the tree.
watch(() => [structureStore.selectedFolderId, structureStore.selectedDbKey], async ([folderId, dbKey]) => {
    folderPath.value = ''
    folderName.value = ''
    if (!folderId || !dbKey) return
    const entry = syncStore.databases.get(dbKey)
    const spaceName = entry?.kind === 'space' ? entry.name : null
    if (folderId === dbKey) {
        folderName.value = spaceName || ''
        folderPath.value = spaceName ? folderSearchPath({ spaceName }) : ''
        return
    }
    try {
        const trail = await docStore.getFolderTrail(folderId, dbKey)
        if (structureStore.selectedFolderId !== folderId) return
        folderName.value = trail[trail.length - 1]?.name || ''
        folderPath.value = folderSearchPath({ spaceName, segments: trail.map((folder) => folder.name) })
    } catch {
        folderPath.value = ''
    }
}, { immediate: true })

function toggleChip(value) {
    const on = chipsOn.value
    if (value === 'everything') setText(clearChips(text.value, folderPath.value))
    else if (value === 'titles') setText(setTitlesChip(text.value, !on.titles))
    else if (value === 'checklists') setText(setChecklistChip(text.value, !on.checklists))
    else if (value === 'folder') setText(setFolderChip(text.value, folderPath.value, !on.folder))
    flush()
    focusInput()
}

function onEnter() {
    flush()
    remember()
}

// The help moves focus into itself when it opens and back to its button when it closes.
function openSyntax() {
    showSyntax.value = true
    nextTick(() => syntaxRef.value?.focus())
}

function closeSyntax() {
    showSyntax.value = false
    nextTick(() => syntaxButtonRef.value?.focus())
}

function toggleSyntax() {
    if (showSyntax.value) closeSyntax()
    else openSyntax()
}

function onEscape() {
    if (showSyntax.value) {
        closeSyntax()
        return
    }
    // The sidebar closes the panel and puts focus back on the search button.
    emit('close')
}

function useRecent(item) {
    setText(item)
    flush()
    focusInput()
}

function locationOf(doc) {
    const where = doc.folderId ? doc.folderName : 'No folder'
    return doc.spaceName ? `${doc.spaceName} · ${where}` : where
}

function isSelected(doc) {
    return structureStore.selectedFileId === doc.id && structureStore.selectedDbKey === doc.dbKey
}

function open(doc) {
    remember()
    docStore.selectFile(doc.id, doc.dbKey)
    router.push({ name: 'doc', params: { fileId: doc.id }, query: { dbKey: doc.dbKey } })
}
</script>

<style scoped>
.search-input::-webkit-search-cancel-button {
    display: none;
}

.search-snippet {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.search-result mark {
    background: #fde68a;
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
}

:global(html[data-theme='dark']) .search-result mark {
    background: #7c5c12;
}
</style>
