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
                        data-testid="phone-search-input"
                        @keydown.enter="remember(text)"
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
                        :aria-pressed="scope === chip.value"
                        :data-testid="`phone-search-scope-${chip.value}`"
                        @click="setScope(chip.value)"
                    >{{ chip.label }}</button>
                </div>
            </header>

            <main class="ph-search-results">
                <template v-if="!term">
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
                                    @click="text = item"
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
                    >{{ searching ? 'Searching' : `${results.length} ${results.length === 1 ? 'result' : 'results'}` }}</p>
                    <ul
                        v-if="results.length"
                        data-testid="phone-search-list"
                    >
                        <li
                            v-for="doc in results"
                            :key="`${doc.dbKey}:${doc.id}`"
                        >
                            <a
                                :href="`#/doc/${encodeURIComponent(doc.id)}?dbKey=${encodeURIComponent(doc.dbKey)}`"
                                class="ph-result"
                                :data-testid="`phone-search-result-${doc.id}`"
                                @click.prevent="open(doc)"
                            >
                                <span class="ph-result-title">
                                    <template
                                        v-for="(segment, index) in highlightSegments(doc.name, term)"
                                        :key="index"
                                    >
                                        <mark v-if="segment.match">{{ segment.text }}</mark>
                                        <template v-else>{{ segment.text }}</template>
                                    </template>
                                </span>
                                <span class="ph-result-meta">{{ locationOf(doc) }} · {{ formatRelativeTime(doc.displayedDate) }}</span>
                                <span
                                    v-if="scope !== 'titles'"
                                    class="ph-result-snippet"
                                >
                                    <template
                                        v-for="(segment, index) in searchSnippet(doc.content, term, { title: doc.name })"
                                        :key="index"
                                    >
                                        <mark v-if="segment.match">{{ segment.text }}</mark>
                                        <template v-else>{{ segment.text }}</template>
                                    </template>
                                </span>
                            </a>
                        </li>
                    </ul>
                    <p
                        v-else-if="!searching"
                        class="ph-muted ph-search-hint"
                        data-testid="phone-search-none"
                    >No notes match “{{ term }}”.</p>
                </template>
            </main>
        </div>
    </PhoneShell>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, X, History } from 'lucide-vue-next'
import PhoneShell from '@/components/phone/PhoneShell.vue'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useViewport } from '@/composables/useViewport'
import { highlightSegments, searchSnippet, normalizeScope, readRecentSearches, rememberSearch } from '@/utils/searchQuery'
import { formatRelativeTime } from '@/utils/recentDocuments'

const DEBOUNCE_MS = 150

const route = useRoute()
const router = useRouter()
const docStore = useDocStore()
const syncStore = useSyncStore()
const { isPhone } = useViewport()

const inputRef = ref(null)
const text = ref(typeof route.query.q === 'string' ? route.query.q : '')
const term = ref(text.value.trim())
const results = ref([])
const searching = ref(false)
const recent = ref(readRecentSearches(safeStorage()))
const folderName = ref('')

const folderId = computed(() => (typeof route.query.folder === 'string' ? route.query.folder : ''))
const folderDbKey = computed(() => (typeof route.query.dbKey === 'string' ? route.query.dbKey : ''))
const scope = computed(() => {
    const value = normalizeScope(route.query.scope)
    return value === 'folder' && !folderId.value ? 'everything' : value
})

const chips = computed(() => [
    { value: 'everything', label: 'Everything' },
    { value: 'titles', label: 'Titles' },
    { value: 'checklists', label: 'Checklists' },
    ...(folderId.value ? [{ value: 'folder', label: folderName.value || 'This folder' }] : []),
])

function safeStorage() {
    try {
        return window.localStorage
    } catch {
        return { getItem: () => null, setItem: () => {} }
    }
}

// Desktop has no Search screen; its sidebar search covers it.
watch(isPhone, (phone) => { if (!phone) router.replace({ name: 'home' }) }, { immediate: true })

onMounted(async () => {
    await nextTick()
    inputRef.value?.focus()
    if (folderId.value && folderDbKey.value) {
        if (folderId.value === folderDbKey.value) {
            folderName.value = syncStore.databases.get(folderDbKey.value)?.name || 'This space'
        } else {
            try {
                const trail = await docStore.getFolderTrail(folderId.value, folderDbKey.value)
                folderName.value = trail[trail.length - 1]?.name || ''
            } catch {
                folderName.value = ''
            }
        }
    }
})

let timer = null
let runId = 0
watch(text, (value) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
        term.value = value.trim()
        router.replace({ query: { ...route.query, q: value || undefined } })
    }, DEBOUNCE_MS)
})

watch(() => [term.value, scope.value, syncStore.isInitialized], async () => {
    const run = ++runId
    if (!term.value || !syncStore.isInitialized) {
        results.value = []
        return
    }
    searching.value = true
    const found = await docStore.searchDocuments({
        query: term.value,
        scope: scope.value,
        folderId: folderId.value || null,
        dbKey: folderDbKey.value || null,
    })
    // A slower, older search must not replace a newer one.
    if (run !== runId) return
    results.value = found
    searching.value = false
}, { immediate: true })

function setScope(value) {
    router.replace({ query: { ...route.query, scope: value === 'everything' ? undefined : value } })
}

function clear() {
    text.value = ''
    inputRef.value?.focus()
}

function remember(value) {
    recent.value = rememberSearch(safeStorage(), value)
}

function locationOf(doc) {
    if (doc.folderId) return doc.folderName
    return doc.spaceName || 'No folder'
}

function open(doc) {
    remember(text.value)
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
    border-radius: 26px;
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
    border-bottom: 1px solid var(--ph-line);
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
