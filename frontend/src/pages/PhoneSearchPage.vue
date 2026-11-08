<template>
    <PhoneShell v-if="isPhone">
        <div
            class="ph-search"
            data-testid="phone-search"
        >
            <header class="ph-search-top">
                <div class="ph-pill ph-search-pill">
                    <button
                        type="button"
                        class="ph-icon-btn"
                        aria-label="Back"
                        data-testid="phone-search-back"
                        @click="goBack"
                    >
                        <ArrowLeft
                            class="h-6 w-6"
                            aria-hidden="true"
                        />
                    </button>
                    <label
                        class="sr-only"
                        for="ph-search-input"
                    >Search your notes</label>
                    <input
                        id="ph-search-input"
                        ref="inputRef"
                        v-model="text"
                        class="ph-search-input"
                        type="search"
                        enterkeyhint="search"
                        placeholder="Search your notes"
                        autocomplete="off"
                        maxlength="200"
                        data-testid="phone-search-input"
                        @keydown.enter="onEnter"
                    >
                    <button
                        v-if="text"
                        type="button"
                        class="ph-icon-btn"
                        aria-label="Clear search"
                        @click="clear"
                    >
                        <X
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                    </button>
                </div>
                <div
                    class="ph-chips"
                    role="group"
                    aria-label="Search in"
                >
                    <button
                        v-for="chip in chips"
                        :key="chip.value"
                        type="button"
                        class="ph-chip"
                        :aria-pressed="chip.on"
                        :data-testid="`phone-search-scope-${chip.value}`"
                        @click="toggleChip(chip.value)"
                    >{{ chip.label }}</button>
                    <button
                        type="button"
                        class="ph-chip"
                        aria-haspopup="dialog"
                        :aria-expanded="picker.open.value"
                        data-testid="phone-search-scope-property"
                        @click="picker.openPicker()"
                    >Property…</button>
                </div>
            </header>

            <main class="ph-search-results">
                <ul
                    v-if="notices.length"
                    class="ph-search-notices"
                    data-testid="phone-search-notices"
                >
                    <li
                        v-for="notice in notices"
                        :key="notice"
                    >{{ notice }}</li>
                </ul>

                <template v-if="!query">
                    <div
                        v-if="recent.length"
                        class="ph-recent"
                    >
                        <p class="ph-section-label ph-search-label">Recent searches</p>
                        <ul>
                            <li
                                v-for="item in recent"
                                :key="item"
                            >
                                <button
                                    type="button"
                                    class="ph-row"
                                    @click="useRecent(item)"
                                >
                                    <History
                                        class="h-5 w-5"
                                        aria-hidden="true"
                                    />
                                    {{ item }}
                                </button>
                            </li>
                        </ul>
                    </div>
                    <p
                        v-else
                        class="ph-muted ph-search-hint"
                    >Search titles and text across all your notes.</p>
                </template>

                <template v-else>
                    <p
                        class="sr-only"
                        aria-live="polite"
                    >{{ searching ? 'Searching' : countLabel }}</p>
                    <ul
                        v-if="results.length"
                        data-testid="phone-search-list"
                    >
                        <li
                            v-for="doc in results"
                            :key="`${doc.dbKey}:${doc.id}`"
                            class="ph-result-item"
                        >
                            <a
                                :href="`#/doc/${encodeURIComponent(doc.id)}?dbKey=${encodeURIComponent(doc.dbKey)}`"
                                class="ph-result"
                                :data-testid="`phone-search-result-${doc.id}`"
                                @click.prevent="open(doc)"
                            >
                                <span class="ph-result-title">
                                    <template
                                        v-for="(segment, index) in highlightSegments(doc.name, terms)"
                                        :key="index"
                                    >
                                        <mark v-if="segment.match">{{ segment.text }}</mark>
                                        <template v-else>{{ segment.text }}</template>
                                    </template>
                                </span>
                                <span class="ph-result-meta">
                                    <span
                                        v-if="doc.inTrash"
                                        class="ph-result-trash"
                                        :data-testid="`phone-search-trash-${doc.id}`"
                                    >In Trash</span>
                                    {{ locationOf(doc) }} · {{ formatRelativeTime(doc.displayedDate) }}
                                </span>
                                <span
                                    v-if="!chipsOn.titles"
                                    class="ph-result-snippet"
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
                            <DocumentTagChips
                                class="ph-result-tags"
                                :db-key="doc.dbKey"
                                :note-id="doc.id"
                                :filterable="false"
                                selectable
                                @select="addTag"
                            />
                        </li>
                    </ul>
                    <p
                        v-else-if="!searching"
                        class="ph-muted ph-search-hint"
                        data-testid="phone-search-none"
                    >No notes match “{{ query }}”.</p>
                    <div
                        v-if="nextCursor"
                        class="ph-search-more"
                    >
                        <button
                            type="button"
                            class="ph-chip"
                            :disabled="loadingMore"
                            data-testid="phone-search-more"
                            @click="loadMore"
                        >{{ loadingMore ? 'Loading…' : 'Show more' }}</button>
                    </div>
                </template>
            </main>
        </div>
        <BottomSheet
            :open="picker.open.value"
            label="Filter by property"
            testid="phone-search-property-sheet"
            @close="picker.closePicker()"
        >
            <template #header>
                <h2 class="ph-sheet-title">Filter by property</h2>
            </template>
            <PropertyPicker
                v-if="picker.open.value"
                layout="phone"
                :keys="picker.keys.value"
                :loading="picker.loading.value"
                :values-for="picker.valuesFor"
                @add="addPropertyPart"
                @close="picker.closePicker()"
            />
        </BottomSheet>
    </PhoneShell>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, X, History } from 'lucide-vue-next'
import PhoneShell from '@/components/phone/PhoneShell.vue'
import BottomSheet from '@/components/phone/BottomSheet.vue'
import PropertyPicker from '@/components/PropertyPicker.vue'
import DocumentTagChips from '@/components/tags/DocumentTagChips.vue'
import { usePropertyPicker } from '@/composables/usePropertyPicker'
import { appendPart } from '@/utils/propertyPicker'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useViewport } from '@/composables/useViewport'
import { resultCountLabel, useDocumentSearch } from '@/composables/useDocumentSearch'
import {
    addTagPart,
    chipState,
    clearChips,
    folderSearchPath,
    highlightSegments,
    normalizeScope,
    searchSnippet,
    setChecklistChip,
    setFolderChip,
    setTitlesChip,
} from '@/utils/searchQuery'
import { formatRelativeTime } from '@/utils/recentDocuments'

const route = useRoute()
const router = useRouter()
const docStore = useDocStore()
const syncStore = useSyncStore()
const { isPhone } = useViewport()

const inputRef = ref(null)
const folderName = ref('')
const folderPath = ref('')

const {
    text, query, results, notices, terms, nextCursor, searching, loadingMore, recent,
    flush, loadMore, remember, setText,
} = useDocumentSearch({
    initialText: typeof route.query.q === 'string' ? route.query.q : '',
    onQuery: (value) => router.replace({ query: { ...route.query, q: value || undefined } }),
})

const folderId = computed(() => (typeof route.query.folder === 'string' ? route.query.folder : ''))
const folderDbKey = computed(() => (typeof route.query.dbKey === 'string' ? route.query.dbKey : ''))

const chipsOn = computed(() => chipState(text.value, folderPath.value))
const chips = computed(() => [
    { value: 'everything', label: 'Everything', on: chipsOn.value.everything },
    { value: 'titles', label: 'Titles', on: chipsOn.value.titles },
    { value: 'checklists', label: 'Checklists', on: chipsOn.value.checklists },
    ...(folderPath.value ? [{ value: 'folder', label: folderName.value || 'This folder', on: chipsOn.value.folder }] : []),
])
const countLabel = computed(() => resultCountLabel(results.value.length, Boolean(nextCursor.value)))

// Desktop has no Search screen; its sidebar search covers it.
watch(isPhone, (phone) => { if (!phone) router.replace({ name: 'home' }) }, { immediate: true })

onMounted(async () => {
    await nextTick()
    inputRef.value?.focus()
    if (!folderId.value || !folderDbKey.value) return
    const entry = syncStore.databases.get(folderDbKey.value)
    const spaceName = entry?.kind === 'space' ? entry.name : null
    let segments = []
    if (folderId.value === folderDbKey.value) {
        folderName.value = spaceName || 'This space'
    } else {
        try {
            const trail = await docStore.getFolderTrail(folderId.value, folderDbKey.value)
            segments = trail.map((folder) => folder.name)
            folderName.value = trail[trail.length - 1]?.name || ''
        } catch {
            folderName.value = ''
        }
    }
    folderPath.value = folderSearchPath({ spaceName, segments })
    // Opened from a folder: the page starts with that folder's in: part.
    if (folderPath.value && normalizeScope(route.query.scope) === 'folder' && !text.value.trim()) {
        setText(`${setFolderChip('', folderPath.value, true)} `)
        flush()
    }
})

function toggleChip(value) {
    const on = chipsOn.value
    if (value === 'everything') setText(clearChips(text.value, folderPath.value))
    else if (value === 'titles') setText(setTitlesChip(text.value, !on.titles))
    else if (value === 'checklists') setText(setChecklistChip(text.value, !on.checklists))
    else if (value === 'folder') setText(setFolderChip(text.value, folderPath.value, !on.folder))
    flush()
}

const picker = usePropertyPicker()

function addPropertyPart(part) {
    setText(appendPart(text.value, part))
    picker.closePicker()
    flush()
}

function addTag(name) {
    setText(addTagPart(text.value, name))
    flush()
}

function onEnter() {
    flush()
    remember()
}

function useRecent(item) {
    setText(item)
    flush()
}

function clear() {
    setText('')
    flush()
    inputRef.value?.focus()
}

function locationOf(doc) {
    if (doc.folderId) return doc.spaceName ? `${doc.spaceName} · ${doc.folderName}` : doc.folderName
    return doc.spaceName || 'No folder'
}

function open(doc) {
    remember()
    router.push({ name: 'doc', params: { fileId: doc.id }, query: { dbKey: doc.dbKey } })
}

function goBack() {
    if (window.history.state?.back) router.back()
    else router.replace({ name: 'home' })
}
</script>

<style scoped>
.ph-search {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--ph-canvas);
}

.ph-search-top {
    padding: calc(10px + env(safe-area-inset-top)) 12px 0;
    flex-shrink: 0;
}

.ph-search-pill {
    display: flex;
    align-items: center;
    height: 52px;
    padding: 0 4px;
    border-radius: 9999px;
    background: var(--ph-surface);
    box-shadow: var(--ph-shadow);
}

.ph-search-input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    border: 0;
    background: none;
    color: var(--ph-ink);
    font-size: 16px;
    outline: none;
}

/* The pill shows focus; a ring around the bare field looks like a second box. */
.ph-search-input:focus-visible {
    outline: none;
}

.ph-search-input::-webkit-search-cancel-button {
    display: none;
}

.ph-chips {
    display: flex;
    gap: 8px;
    padding: 12px 0 4px;
    overflow-x: auto;
    scrollbar-width: none;
}

.ph-search-results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 0 24px;
}

.ph-search-label {
    padding: 12px 20px 4px;
}

.ph-search-hint {
    padding: 32px 24px;
    text-align: center;
}

.ph-result {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 20px;
    color: var(--ph-ink);
    text-decoration: none;
}

.ph-result:active {
    background: var(--ph-surface);
}

.ph-result-title {
    font-size: 16px;
    font-weight: 600;
}

.ph-result-meta {
    font-size: 13px;
    color: var(--ph-muted);
}

.ph-result-snippet {
    margin-top: 2px;
    font-size: 14px;
    line-height: 1.45;
    color: var(--ph-ink-2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.ph-search-notices {
    margin: 4px 20px 0;
    padding: 0;
    list-style: none;
    font-size: 13px;
    color: var(--ph-muted);
}

.ph-result-trash {
    display: inline-block;
    margin-right: 6px;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--ph-canvas);
    border: 1px solid var(--ph-line);
    font-size: 12px;
    font-weight: 600;
}

.ph-result-item {
    border-bottom: 1px solid var(--ph-line);
}

.ph-sheet-title {
    margin: 0;
    padding: 4px 20px 0;
    font-size: 17px;
    font-weight: 600;
}

.ph-result-tags {
    display: flex;
    padding: 0 20px 10px;
    margin-top: -6px;
}

.ph-search-more {
    display: flex;
    justify-content: center;
    padding: 16px 0 8px;
}

.ph-result mark {
    background: #fde68a;
    color: inherit;
    border-radius: 3px;
    padding: 0 1px;
}

:global(html[data-theme='dark']) .ph-result mark {
    background: #7c5c12;
}
</style>
