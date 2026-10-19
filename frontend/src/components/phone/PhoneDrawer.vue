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
                <ul class="ph-drawer-list">
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
import { StickyNote, Pin, Users, Folder, FolderTree, FolderPlus, Settings } from 'lucide-vue-next'
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

/** Top-level personal folders, alphabetical. */
const shownFolders = computed(() => folders.value
    .filter((folder) => !folder.parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .slice(0, MAX_FOLDERS))

watch(() => [props.open, docStore.contentVersion], async ([open]) => {
    if (!open || !syncStore.personalDbKey) return
    try {
        folders.value = await docStore.listFolders(syncStore.personalDbKey)
    } catch (error) {
        console.warn('[PhoneDrawer] Could not load folders:', error)
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
    padding: calc(16px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom));
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
    font-family: var(--ph-serif);
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
    border-radius: 24px;
    background: none;
    color: var(--ph-ink);
    font-size: 16px;
    text-align: left;
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
