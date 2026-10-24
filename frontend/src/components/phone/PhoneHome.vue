<template>
    <div
        class="ph-home"
        data-testid="phone-home"
        @touchstart.passive="edgeSwipe.start"
        @touchmove.passive="edgeSwipe.move"
        @touchend="edgeSwipe.end"
    >
        <header class="ph-home-top">
            <SelectionBar
                v-if="selection.selecting.value"
                @move="openSheet('move', 'selection')"
            />
            <div
                v-else
                class="ph-pill"
            >
                <button
                    type="button"
                    class="ph-icon-btn"
                    aria-label="Open menu and folders"
                    data-testid="phone-home-drawer"
                    @click="openSheet('drawer')"
                >
                    <Menu
                        class="h-6 w-6"
                        aria-hidden="true"
                    />
                </button>
                <button
                    type="button"
                    class="ph-pill-search"
                    data-testid="phone-home-search"
                    @click="router.push({ name: 'search' })"
                >Search your notes</button>
                <button
                    type="button"
                    class="ph-icon-btn"
                    :aria-label="ui.homeLayout === 'grid' ? 'Switch to list view' : 'Switch to grid view'"
                    data-testid="phone-home-layout"
                    @click="ui.setHomeLayout(ui.homeLayout === 'grid' ? 'list' : 'grid')"
                >
                    <component
                        :is="ui.homeLayout === 'grid' ? Rows3 : LayoutGrid"
                        class="h-5 w-5"
                        aria-hidden="true"
                    />
                </button>
                <button
                    type="button"
                    class="ph-pill-avatar"
                    :aria-label="`Settings. ${sync.label}`"
                    data-testid="phone-home-settings"
                    @click="router.push({ name: 'settings' })"
                >
                    <UserAvatar
                        :user="authStore.user || {}"
                        size="md"
                    />
                    <span
                        class="ph-sync-dot ph-pill-dot"
                        :data-state="sync.state"
                        data-testid="phone-home-sync-dot"
                        aria-hidden="true"
                    ></span>
                </button>
            </div>
        </header>

        <div
            v-if="!syncStore.isOnline"
            class="ph-banner"
            role="status"
            data-testid="phone-offline-banner"
        >
            <CloudOff
                class="h-5 w-5"
                aria-hidden="true"
            />
            <p>You're offline. Everything stays editable and syncs when you're back online.</p>
        </div>

        <div class="ph-chips-row">
            <div
                class="ph-chips"
                role="group"
                aria-label="Show"
            >
                <button
                    v-for="chip in chips"
                    :key="chip.value"
                    type="button"
                    class="ph-chip"
                    :aria-pressed="filter === chip.value"
                    :data-testid="`phone-home-filter-${chip.value}`"
                    @click="setFilter(chip.value)"
                >{{ chip.label }}</button>
            </div>
            <SortButton />
        </div>

        <main
            ref="scrollRef"
            class="ph-home-scroll"
            @touchstart.passive="pull.start"
            @touchmove.passive="pull.move"
            @touchend="pull.end"
        >
            <div
                class="ph-pull"
                :style="{ height: `${pull.distance.value}px` }"
                aria-hidden="true"
            >
                <RefreshCw
                    class="h-5 w-5"
                    :class="{ 'animate-spin': syncStore.isSyncing }"
                />
            </div>

            <template v-if="loaded && !sections.pinned.length && !sections.others.length">
                <div
                    class="ph-empty"
                    data-testid="phone-home-empty"
                >
                    <div
                        class="ph-empty-art"
                        aria-hidden="true"
                    >
                        <NotebookPen class="h-12 w-12" />
                    </div>
                    <h2 class="ph-display">{{ emptyTitle }}</h2>
                    <p class="ph-muted">{{ emptyLine }}</p>
                    <button
                        v-if="filter === 'all'"
                        type="button"
                        class="ph-btn ph-btn-primary"
                        data-testid="phone-home-first-note"
                        @click="openCapture('note')"
                    >Take your first note</button>
                </div>
            </template>

            <template v-else>
                <section
                    v-for="section in visibleSections"
                    :key="section.key"
                    class="ph-section"
                    :aria-labelledby="`ph-section-${section.key}`"
                >
                    <h2
                        :id="`ph-section-${section.key}`"
                        class="ph-section-label"
                    >{{ section.label }}</h2>
                    <div
                        v-if="ui.homeLayout === 'grid'"
                        class="ph-grid"
                    >
                        <div
                            v-for="(column, columnIndex) in section.columns"
                            :key="columnIndex"
                            class="ph-grid-column"
                        >
                            <NoteCard
                                v-for="doc in column"
                                :key="`${doc.dbKey}:${doc.id}`"
                                :doc="doc"
                                :selecting="selection.selecting.value"
                                :selected="selection.isSelected(doc)"
                                @open="openDocument"
                                @select="selection.toggle"
                            />
                        </div>
                    </div>
                    <div
                        v-else
                        class="ph-list"
                    >
                        <NoteCard
                            v-for="doc in section.docs"
                            :key="`${doc.dbKey}:${doc.id}`"
                            :doc="doc"
                            variant="list"
                            :selecting="selection.selecting.value"
                            :selected="selection.isSelected(doc)"
                            @open="openDocument"
                            @select="selection.toggle"
                        />
                    </div>
                </section>
            </template>
        </main>

        <NewNoteButtons
            @note="openCapture('note')"
            @template="showTemplates = true"
        />

        <QuickCaptureSheet
            :open="activeSheet === 'capture'"
            :initial-kind="sheetArg === 'checklist' ? 'checklist' : 'note'"
            :default-destination="captureDestination"
            @close="closeSheet"
        />

        <TemplatePickerModal
            sheet
            :open="showTemplates"
            :database-key="syncStore.personalDbKey"
            :current-folder-id="null"
            @close="showTemplates = false"
            @created="openCreated"
        />
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Menu, Rows3, LayoutGrid, CloudOff, RefreshCw, NotebookPen } from 'lucide-vue-next'
import NoteCard from '@/components/phone/NoteCard.vue'
import NewNoteButtons from '@/components/phone/NewNoteButtons.vue'
import QuickCaptureSheet from '@/components/phone/QuickCaptureSheet.vue'
import SelectionBar from '@/components/phone/SelectionBar.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import TemplatePickerModal from '@/components/TemplatePickerModal.vue'
import { useAuthStore } from '@/store/authStore'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { useSheetRoute } from '@/composables/useSheetRoute'
import { usePhoneStatus } from '@/composables/usePhoneStatus'
import { usePhoneSelection } from '@/composables/usePhoneSelection'
import { usePullToSync, useEdgeSwipe } from '@/composables/usePhoneGestures'
import { buildHomeSections, normalizeHomeFilter, splitIntoColumns } from '@/utils/homeView'
import SortButton from '@/components/phone/SortButton.vue'
import { toSnippetLines } from '@/utils/markdownSnippet'

const HOME_LIMIT = 200

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const docStore = useDocStore()
const syncStore = useSyncStore()
const ui = useUiStore()
const { activeSheet, sheetArg, openSheet, closeSheet } = useSheetRoute()
const { sync, syncNow } = usePhoneStatus()
const selection = usePhoneSelection()

const docs = ref([])
const loaded = ref(false)
const showTemplates = ref(false)
const scrollRef = ref(null)

const filter = computed(() => normalizeHomeFilter(route.query.filter))
const hasSpaces = computed(() => [...syncStore.databases.values()].some((entry) => entry.kind === 'space'))

const chips = computed(() => [
    { value: 'all', label: 'All notes' },
    ...(hasSpaces.value ? [{ value: 'shared', label: 'Shared' }] : []),
    ...(filter.value === 'pinned' ? [{ value: 'pinned', label: 'Pinned' }] : []),
])

const sections = computed(() => buildHomeSections(docs.value, filter.value, syncStore.personalDbKey, ui.noteSort))

const estimateHeight = (doc) => 3 + toSnippetLines(doc.content, { title: doc.name, maxLines: 8 }).length

const visibleSections = computed(() => {
    const result = []
    const { pinned, others } = sections.value
    if (pinned.length) result.push({ key: 'pinned', label: 'Pinned', docs: pinned })
    if (others.length) result.push({ key: 'others', label: pinned.length ? 'Others' : 'Notes', docs: others })
    return result.map((section) => ({ ...section, columns: splitIntoColumns(section.docs, estimateHeight) }))
})

const emptyTitle = computed(() => ({
    shared: 'Nothing shared yet',
    pinned: 'No pinned notes',
}[filter.value] || 'No notes yet'))

const emptyLine = computed(() => ({
    shared: 'Documents in shared spaces appear here.',
    pinned: 'Pin a note from its menu to keep it at the top.',
}[filter.value] || 'Take a note now; you can put it in a folder whenever you like.'))

/** Capture from Home saves outside any folder unless another is picked. */
const captureDestination = computed(() => ({
    dbKey: syncStore.personalDbKey,
    folderId: null,
    label: 'No folder',
}))

async function refresh() {
    if (!syncStore.isInitialized || !syncStore.personalDbKey) return
    docs.value = await docStore.getRecentDocuments(HOME_LIMIT, { sort: ui.noteSort })
    loaded.value = true
}

watch(
    () => [filter.value, ui.noteSort, syncStore.isInitialized, docStore.contentVersion, docStore.recentDocVersion, syncStore.databases.size],
    () => { void refresh() },
    { immediate: true },
)

function setFilter(value) {
    const query = { ...route.query }
    if (value === 'all') delete query.filter
    else query.filter = value
    router.replace({ query })
    scrollRef.value?.scrollTo({ top: 0 })
}

function openDocument(doc) {
    router.push({ name: 'doc', params: { fileId: doc.id }, query: { dbKey: doc.dbKey } })
}

function openCreated(result) {
    showTemplates.value = false
    router.push({ name: 'doc', params: { fileId: result.id }, query: { dbKey: result.dbKey, mode: 'write' } })
}

function openCapture(kind) {
    openSheet('capture', kind === 'checklist' ? 'checklist' : '')
}

const pull = usePullToSync(scrollRef, () => syncNow())
const edgeSwipe = useEdgeSwipe(() => openSheet('drawer'))
</script>

<style scoped>
.ph-home {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--ph-canvas);
}

.ph-home-top {
    padding: 10px 12px 0;
    padding-top: calc(10px + env(safe-area-inset-top));
    flex-shrink: 0;
}

.ph-pill {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 52px;
    padding: 0 4px;
    border-radius: 9999px;
    background: var(--ph-surface);
    box-shadow: var(--ph-shadow);
}

.ph-pill-search {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    border: 0;
    background: none;
    color: var(--ph-muted);
    font-size: 16px;
    text-align: left;
}

.ph-pill-avatar {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: none;
}

.ph-pill-dot {
    position: absolute;
    right: 4px;
    bottom: 4px;
    box-shadow: 0 0 0 2px var(--ph-surface);
}

.ph-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 10px 12px 0;
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--ph-accent-soft);
    color: var(--ph-ink);
    font-size: 14px;
    line-height: 1.4;
}

.ph-chips-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 8px 0 0;
    flex-shrink: 0;
}

.ph-chips-row .ph-chips {
    flex: 1;
    min-width: 0;
    padding-top: 4px;
}

.ph-chips {
    display: flex;
    gap: 8px;
    padding: 12px 12px 4px;
    overflow-x: auto;
    flex-shrink: 0;
    scrollbar-width: none;
}

.ph-home-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    padding: 0 12px calc(152px + var(--ph-safe-bottom));
}

.ph-pull {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    color: var(--ph-muted);
}

.ph-section {
    margin-top: 12px;
}

.ph-section .ph-section-label {
    padding: 4px 4px 8px;
}

.ph-grid {
    display: flex;
    gap: 10px;
    align-items: flex-start;
}

.ph-grid-column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.ph-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.ph-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 56px 24px;
    text-align: center;
}

.ph-empty-art {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 96px;
    height: 96px;
    border-radius: 8px;
    background: var(--ph-accent-soft);
    color: var(--ph-accent);
}

.ph-empty .ph-display {
    font-size: 26px;
}
</style>
