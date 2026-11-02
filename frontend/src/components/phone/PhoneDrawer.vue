<template>
    <Transition name="ph-drawer">
        <div
            v-if="open"
            class="ph-drawer-root"
            data-testid="phone-drawer"
        >
            <div
                class="ph-drawer-scrim"
                aria-hidden="true"
                @click="$emit('close')"
            ></div>
            <nav
                ref="panelRef"
                class="ph-drawer-panel"
                role="dialog"
                aria-modal="true"
                aria-label="Menu and folders"
                tabindex="-1"
                :style="dragX ? { transform: `translateX(${dragX}px)` } : undefined"
                @keydown="handleKeydown"
                @touchstart.passive="startSwipe"
                @touchmove.passive="moveSwipe"
                @touchend="endSwipe"
            >
                <p class="ph-drawer-brand">Panino</p>

                <ul class="ph-drawer-list">
                    <li
                        v-for="item in primaryItems"
                        :key="item.key"
                    >
                        <button
                            type="button"
                            class="ph-drawer-item"
                            :aria-current="item.active ? 'page' : undefined"
                            :data-testid="`phone-drawer-${item.key}`"
                            @click="item.go"
                        >
                            <component
                                :is="item.icon"
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <span class="ph-drawer-label">{{ item.label }}</span>
                            <span
                                v-if="item.count"
                                class="ph-drawer-count"
                            >{{ item.count }}</span>
                        </button>
                    </li>
                </ul>

                <p class="ph-section-label ph-drawer-heading">Folders</p>

                <!-- Once there is a space, the personal folders sit in a collapsible
                     My Notes group, and each space is a collapsible group after it. -->
                <div
                    v-if="spaces.length"
                    class="ph-drawer-group"
                >
                    <button
                        type="button"
                        class="ph-drawer-chevron"
                        :aria-expanded="!ui.myNotesCollapsed"
                        aria-label="Show or hide My Notes"
                        data-testid="phone-drawer-my-notes-toggle"
                        @click="ui.toggleMyNotesCollapsed()"
                    >
                        <ChevronRight
                            v-if="ui.myNotesCollapsed"
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                        <ChevronDown
                            v-else
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                    </button>
                    <button
                        type="button"
                        class="ph-drawer-item"
                        :aria-expanded="!ui.myNotesCollapsed"
                        data-testid="phone-drawer-my-notes"
                        @click="ui.toggleMyNotesCollapsed()"
                    >
                        <User
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                        <span class="ph-drawer-label">My Notes</span>
                    </button>
                </div>

                <ul
                    v-if="!spaces.length || !ui.myNotesCollapsed"
                    class="ph-drawer-list"
                    :class="{ 'ph-drawer-nested': spaces.length }"
                    data-testid="phone-drawer-my-notes-folders"
                >
                    <li
                        v-for="folder in shownFolders"
                        :key="folder.id"
                    >
                        <button
                            type="button"
                            class="ph-drawer-item"
                            :aria-current="isCurrentFolder(folder) ? 'page' : undefined"
                            :data-testid="`phone-drawer-folder-${folder.id}`"
                            @click="goFolder(folder)"
                        >
                            <Folder
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <span class="ph-drawer-label">{{ folder.name }}</span>
                        </button>
                    </li>
                    <li>
                        <button
                            type="button"
                            class="ph-drawer-item"
                            data-testid="phone-drawer-all-folders"
                            @click="go({ name: 'folders' })"
                        >
                            <FolderTree
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <span class="ph-drawer-label">See all</span>
                        </button>
                    </li>
                    <li>
                        <button
                            type="button"
                            class="ph-drawer-item"
                            data-testid="phone-drawer-new-folder"
                            @click="promptingFolder = true"
                        >
                            <FolderPlus
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <span class="ph-drawer-label">New folder</span>
                        </button>
                    </li>
                </ul>

                <template
                    v-for="space in spaces"
                    :key="space.dbKey"
                >
                    <div class="ph-drawer-group">
                        <button
                            type="button"
                            class="ph-drawer-chevron"
                            :aria-expanded="isSpaceOpen(space)"
                            :aria-label="`Show or hide the folders in ${space.name}`"
                            :data-testid="`phone-drawer-space-toggle-${space.dbKey}`"
                            @click="docStore.toggleFolder(space.dbKey, space.dbKey)"
                        >
                            <ChevronDown
                                v-if="isSpaceOpen(space)"
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <ChevronRight
                                v-else
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                        </button>
                        <button
                            type="button"
                            class="ph-drawer-item"
                            :aria-current="isCurrentFolder({ id: space.dbKey }) ? 'page' : undefined"
                            :data-testid="`phone-drawer-space-${space.dbKey}`"
                            @click="goFolder({ id: space.dbKey, dbKey: space.dbKey })"
                        >
                            <Users
                                class="h-5 w-5"
                                aria-hidden="true"
                            />
                            <span class="ph-drawer-label">{{ space.name }}</span>
                        </button>
                    </div>
                    <ul
                        v-if="isSpaceOpen(space)"
                        class="ph-drawer-list ph-drawer-nested"
                        :data-testid="`phone-drawer-space-folders-${space.dbKey}`"
                    >
                        <li
                            v-for="folder in shownSpaceFolders(space)"
                            :key="folder.id"
                        >
                            <button
                                type="button"
                                class="ph-drawer-item"
                                :aria-current="isCurrentFolder(folder) ? 'page' : undefined"
                                :data-testid="`phone-drawer-folder-${folder.id}`"
                                @click="goFolder(folder)"
                            >
                                <Folder
                                    class="h-5 w-5"
                                    aria-hidden="true"
                                />
                                <span class="ph-drawer-label">{{ folder.name }}</span>
                            </button>
                        </li>
                        <li v-if="hasMoreSpaceFolders(space)">
                            <button
                                type="button"
                                class="ph-drawer-item"
                                :data-testid="`phone-drawer-space-all-${space.dbKey}`"
                                @click="goFolder({ id: space.dbKey, dbKey: space.dbKey })"
                            >
                                <FolderTree
                                    class="h-5 w-5"
                                    aria-hidden="true"
                                />
                                <span class="ph-drawer-label">See all</span>
                            </button>
                        </li>
                        <li
                            v-if="!shownSpaceFolders(space).length"
                            class="ph-drawer-empty"
                        >
                            No folders yet
                        </li>
                    </ul>
                </template>

                <div class="ph-drawer-foot">
                    <button
                        type="button"
                        class="ph-drawer-item"
                        data-testid="phone-drawer-settings"
                        @click="go({ name: 'settings' })"
                    >
                        <Settings
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                        <span class="ph-drawer-label">Settings</span>
                    </button>
                    <p
                        class="ph-drawer-sync"
                        data-testid="phone-drawer-sync"
                    >
                        <span
                            class="ph-sync-dot"
                            :data-state="sync.state"
                            aria-hidden="true"
                        ></span>
                        {{ sync.detail }}
                    </p>
                </div>
            </nav>

            <PromptModal
                :show="promptingFolder"
                v-model="newFolderName"
                title="New folder"
                label="Folder name"
                @confirm="createFolder"
                @cancel="promptingFolder = false"
            />
        </div>
    </Transition>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { StickyNote, Pin, Users, User, Folder, FolderTree, FolderPlus, Settings, ChevronDown, ChevronRight } from 'lucide-vue-next'
import PromptModal from '@/components/PromptModal.vue'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { useDialogFocus } from '@/composables/useDialogFocus'
import { usePhoneStatus } from '@/composables/usePhoneStatus'

const MAX_FOLDERS = 7

const props = defineProps({
    open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const route = useRoute()
const router = useRouter()
const docStore = useDocStore()
const syncStore = useSyncStore()
const ui = useUiStore()
const { sync } = usePhoneStatus()

const panelRef = ref(null)
const folders = ref([])
const promptingFolder = ref(false)
const newFolderName = ref('')
const dragX = ref(0)

const { handleKeydown } = useDialogFocus(panelRef, () => props.open, () => emit('close'))

const homeFilter = computed(() => (route.name === 'home' ? route.query.filter || 'all' : null))

const primaryItems = computed(() => [
    { key: 'all', label: 'All notes', icon: StickyNote, active: homeFilter.value === 'all', go: () => goHome() },
    { key: 'pinned', label: 'Pinned', icon: Pin, active: homeFilter.value === 'pinned', go: () => goHome('pinned') },
    { key: 'shared', label: 'Shared with me', icon: Users, active: false, go: () => go({ name: 'folders', query: { tab: 'shared' } }) },
])

/** Top-level folders, alphabetical. */
const topFolders = (list) => list
    .filter((folder) => !folder.parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

const shownFolders = computed(() => topFolders(folders.value).slice(0, MAX_FOLDERS))

/** The spaces this device has, by name. */
const spaces = computed(() => [...syncStore.databases.values()]
    .filter((entry) => entry.kind === 'space')
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))))

/** A space's group open state is the desktop tree's, so both agree. */
const isSpaceOpen = (space) => docStore.isFolderOpen(space.dbKey, space.dbKey)
const openSpaceKeys = computed(() => spaces.value.filter(isSpaceOpen).map((space) => space.dbKey))

/** Top-level folders of each open space, by database key. */
const spaceFolders = ref({})
const shownSpaceFolders = (space) => (spaceFolders.value[space.dbKey] || []).slice(0, MAX_FOLDERS)
const hasMoreSpaceFolders = (space) => (spaceFolders.value[space.dbKey] || []).length > MAX_FOLDERS

watch(() => [props.open, docStore.contentVersion], async ([open]) => {
    if (!open || !syncStore.personalDbKey) return
    try {
        folders.value = await docStore.listFolders(syncStore.personalDbKey)
    } catch (error) {
        console.warn('[PhoneDrawer] Could not load folders:', error)
    }
}, { immediate: true })

watch(() => [props.open, docStore.contentVersion, openSpaceKeys.value.join('|')], async ([open]) => {
    if (!open) return
    for (const dbKey of openSpaceKeys.value) {
        try {
            const list = topFolders(await docStore.listFolders(dbKey))
            spaceFolders.value = { ...spaceFolders.value, [dbKey]: list }
        } catch (error) {
            console.warn('[PhoneDrawer] Could not load the folders of a space:', error)
        }
    }
}, { immediate: true })

function isCurrentFolder(folder) {
    return route.name === 'folder' && route.params.folderId === folder.id
}

/** Leave the Drawer for another screen in one history step. */
function go(location) {
    router.replace(location)
}

function goHome(filter) {
    go({ name: 'home', query: filter ? { filter } : {} })
}

function goFolder(folder) {
    go({ name: 'folder', params: { folderId: folder.id }, query: { dbKey: folder.dbKey } })
}

async function createFolder() {
    const name = newFolderName.value.trim()
    if (!name) return
    promptingFolder.value = false
    newFolderName.value = ''
    try {
        const created = await docStore.createFolder(syncStore.personalDbKey, name, null)
        goFolder({ id: created.id, dbKey: created.dbKey })
    } catch (error) {
        console.error('[PhoneDrawer] Folder creation failed:', error)
        ui.addToast('The folder could not be created. Try again.', 'error')
    }
}

/* Swipe left to close. */
let swipeStart = null

function startSwipe(event) {
    swipeStart = event.touches[0].clientX
}

function moveSwipe(event) {
    if (swipeStart === null) return
    dragX.value = Math.min(0, event.touches[0].clientX - swipeStart)
}

function endSwipe() {
    const shouldClose = dragX.value < -80
    swipeStart = null
    dragX.value = 0
    if (shouldClose) emit('close')
}
</script>

<style scoped>
.ph-drawer-root {
    position: fixed;
    inset: 0;
    /* Below app dialogs (BaseModal, z-index 50): a dialog the Editor opens while a
       sheet is up, such as Save version or a conflict, must show above it. */
    z-index: 45;
}

.ph-drawer-scrim {
    position: absolute;
    inset: 0;
    background: var(--ph-scrim);
}

.ph-drawer-panel {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(312px, 85vw);
    display: flex;
    flex-direction: column;
    padding: calc(16px + env(safe-area-inset-top)) 12px calc(12px + var(--ph-safe-bottom));
    overflow-y: auto;
    background: var(--ph-surface);
    box-shadow: var(--ph-shadow);
    outline: none;
}

/* The dialog takes focus on open so screen readers land in it; its first
   control shows the ring once someone tabs, the container never does. */
.ph-drawer-panel:focus-visible {
    outline: none;
}

.ph-drawer-brand {
    padding: 4px 12px 16px;
    font-size: 24px;
    font-weight: 700;
}

.ph-drawer-heading {
    padding: 16px 12px 6px;
}

.ph-drawer-item {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 48px;
    padding: 0 12px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ph-ink);
    font-size: 16px;
    text-align: left;
}

.ph-drawer-group {
    display: flex;
    align-items: center;
}

.ph-drawer-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36px;
    min-height: 48px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ph-ink-2);
}

.ph-drawer-group .ph-drawer-item {
    padding-left: 4px;
    font-weight: 600;
}

/* A group's folders, indented under its name. */
.ph-drawer-nested {
    margin-left: 36px;
}

.ph-drawer-empty {
    padding: 8px 12px;
    font-size: 14px;
    color: var(--ph-muted);
}

.ph-drawer-item svg {
    color: var(--ph-ink-2);
    flex-shrink: 0;
}

.ph-drawer-item[aria-current='page'] {
    background: var(--ph-accent-soft);
    color: var(--ph-accent);
    font-weight: 600;
}

.ph-drawer-item[aria-current='page'] svg {
    color: var(--ph-accent);
}

.ph-drawer-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ph-drawer-count {
    font-size: 14px;
    color: var(--ph-muted);
}

.ph-drawer-foot {
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid var(--ph-line);
}

.ph-drawer-sync {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px 0;
    font-size: 13px;
    color: var(--ph-muted);
}

.ph-drawer-enter-active,
.ph-drawer-leave-active {
    transition: opacity 0.2s ease;
}

.ph-drawer-enter-active .ph-drawer-panel,
.ph-drawer-leave-active .ph-drawer-panel {
    transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.ph-drawer-enter-from,
.ph-drawer-leave-to {
    opacity: 0;
}

.ph-drawer-enter-from .ph-drawer-panel,
.ph-drawer-leave-to .ph-drawer-panel {
    transform: translateX(-100%);
}
</style>
