<template>
    <div
        class="ph-editor"
        data-testid="phone-editor"
    >
        <header class="ph-editor-bar">
            <button
                type="button"
                class="ph-icon-btn"
                aria-label="Back"
                data-testid="phone-editor-back"
                @click="goBack"
            >
                <ArrowLeft
                    class="h-6 w-6"
                    aria-hidden="true"
                />
            </button>
            <div class="ph-editor-title">
                <h1 data-testid="phone-editor-title">{{ title }}</h1>
                <button
                    v-if="sync.state === 'error'"
                    type="button"
                    class="ph-editor-status ph-editor-status-error"
                    data-testid="phone-editor-status"
                    @click="syncNow"
                >{{ statusLine }}</button>
                <p
                    v-else
                    class="ph-editor-status"
                    data-testid="phone-editor-status"
                >{{ statusLine }}</p>
            </div>
            <button
                v-if="others.length"
                type="button"
                class="ph-icon-btn ph-editor-avatars"
                :aria-label="`${others.length} other ${others.length === 1 ? 'person' : 'people'} editing. Open Collaborate`"
                data-testid="phone-editor-avatars"
                @click="openSheet('collaborate')"
            >
                <AvatarStack
                    :users="others"
                    :max="3"
                    size="sm"
                    :show-tooltip="false"
                />
            </button>
            <button
                type="button"
                class="ph-icon-btn"
                aria-label="Document options"
                data-testid="phone-editor-menu"
                @click="openSheet('menu')"
            >
                <MoreHorizontal
                    class="h-6 w-6"
                    aria-hidden="true"
                />
            </button>
        </header>

        <div class="ph-editor-mode">
            <SegmentedControl
                v-model="mode"
                label="Editor mode"
                testid-prefix="phone-editor-mode"
                :options="MODE_OPTIONS"
            />
        </div>

        <main class="ph-editor-body">
            <!--
                The Editor stays mounted in Preview: it owns the pending save,
                the conflict state and the live-session binding.
            -->
            <div
                v-show="mode === 'write'"
                class="ph-write"
                data-testid="phone-editor-write"
            >
                <Editor phone />
            </div>
            <div
                v-show="mode === 'preview'"
                class="ph-preview"
                data-testid="phone-editor-preview"
            >
                <Preview
                    interactive-tasks
                    @toggle-task="toggleTask"
                />
            </div>
        </main>

        <button
            v-if="mode === 'preview'"
            type="button"
            class="ph-editor-fab"
            data-testid="phone-editor-edit"
            @click="startWriting"
        >
            <Pencil
                class="h-5 w-5"
                aria-hidden="true"
            />
            Edit
        </button>

        <KeyRow
            v-if="mode === 'write'"
            :keys="WRITE_KEYS"
            label="Markdown keys"
            @press="pressKey"
        >
            <button
                type="button"
                aria-label="Insert image"
                :disabled="!syncStore.isOnline"
                data-testid="phone-key-image"
                @pointerdown.prevent
                @click="imageInput?.click()"
            >
                <ImageIcon
                    class="h-5 w-5"
                    aria-hidden="true"
                />
            </button>
            <button
                v-if="isDictationSupported"
                type="button"
                :aria-label="isDictationRecording ? 'Stop dictation' : 'Start dictation'"
                :aria-pressed="isDictationRecording"
                data-testid="phone-key-dictate"
                @pointerdown.prevent
                @click="toggleDictation"
            >
                <Mic
                    class="h-5 w-5"
                    :class="{ 'ph-recording': isDictationRecording }"
                    aria-hidden="true"
                />
            </button>
            <button
                type="button"
                aria-label="Undo"
                data-testid="phone-key-undo"
                @pointerdown.prevent
                @click="editorStore.undo()"
            >
                <Undo2
                    class="h-5 w-5"
                    aria-hidden="true"
                />
            </button>
            <button
                type="button"
                aria-label="Redo"
                data-testid="phone-key-redo"
                @pointerdown.prevent
                @click="editorStore.redo()"
            >
                <Redo2
                    class="h-5 w-5"
                    aria-hidden="true"
                />
            </button>
        </KeyRow>
        <input
            ref="imageInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="handleImageSelect"
        />

        <DocumentMenuSheet
            :open="activeSheet === 'menu'"
            :folder-label="folderLabel"
            @close="closeSheet"
        />
    </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ArrowLeft, MoreHorizontal, Pencil, Image as ImageIcon, Mic, Undo2, Redo2, PenLine, Eye } from 'lucide-vue-next'
import Editor from '@/components/Editor.vue'
import Preview from '@/components/Preview.vue'
import AvatarStack from '@/components/AvatarStack.vue'
import SegmentedControl from '@/components/phone/SegmentedControl.vue'
import KeyRow from '@/components/phone/KeyRow.vue'
import DocumentMenuSheet from '@/components/phone/DocumentMenuSheet.vue'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { useEditorStore } from '@/store/editorStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { useSheetRoute } from '@/composables/useSheetRoute'
import { usePhoneStatus } from '@/composables/usePhoneStatus'
import { useDictation } from '@/composables/useDictation'
import { applyKey, WRITE_KEYS } from '@/utils/markdownKeys'
import { toggleTaskAt } from '@/utils/markdownTasks'
import { resolveInitialMode, MODE_PREVIEW, MODE_WRITE } from '@/utils/editorMode'
import { editorStatusLine } from '@/utils/syncStatus'

const MODE_OPTIONS = [
    { value: MODE_WRITE, label: 'Write', icon: PenLine },
    { value: MODE_PREVIEW, label: 'Preview', icon: Eye },
]

const route = useRoute()
const router = useRouter()
const docStore = useDocStore()
const draftStore = useDraftStore()
const editorStore = useEditorStore()
const syncStore = useSyncStore()
const ui = useUiStore()
const { activeSheet, openSheet, closeSheet } = useSheetRoute()
const { sync, liveParticipants, otherParticipants, syncNow } = usePhoneStatus()
const { selectedFile: file, isSaving, isDirty } = storeToRefs(docStore)

const mode = ref(MODE_PREVIEW)
const imageInput = ref(null)
const trail = ref([])

const title = computed(() => file.value?.title || 'Untitled')
const others = computed(() => otherParticipants(file.value?.id))

/** Where the Document lives, as the status line and the menu name it. */
const folderLabel = computed(() => {
    const last = trail.value[trail.value.length - 1]
    if (last) return last.name
    if (file.value?.dbKey?.startsWith('space:')) return file.value.spaceName || 'Shared space'
    return 'Inbox'
})

const statusLine = computed(() => editorStatusLine({
    sync: sync.value,
    folderName: folderLabel.value,
    isSaving: isSaving.value,
    isDirty: isDirty.value,
    liveCount: liveParticipants(file.value?.id).length,
}))

// Pick the opening mode once per Document, after its body has loaded.
watch(() => file.value?.id, async (id) => {
    if (!id) return
    mode.value = resolveInitialMode({
        requested: route.query.mode,
        preference: ui.openNotesIn,
        content: file.value.content,
    })
    trail.value = []
    try {
        trail.value = await docStore.getFolderTrail(file.value.folder_id, file.value.dbKey)
    } catch (error) {
        console.warn('[PhoneEditor] Could not read the folder path:', error)
    }
}, { immediate: true })

function goBack() {
    if (window.history.state?.back) {
        router.back()
        return
    }
    const folderId = file.value?.folder_id
    router.replace(folderId
        ? { name: 'folder', params: { folderId }, query: { dbKey: file.value.dbKey } }
        : { name: 'home' })
}

function startWriting() {
    mode.value = MODE_WRITE
    nextTick(() => editorStore.focus())
}

function pressKey(id) {
    editorStore.transformText((state) => applyKey(id, state))
}

/**
 * A Preview checkbox tap. The Nth box is the Nth task line in the source; if
 * the two disagree (a task produced by a variable, say) nothing is changed.
 */
async function toggleTask({ index, count }) {
    const id = file.value?.id
    if (!id) return
    const source = draftStore.getDraft(id) ?? file.value.content ?? ''
    if (!toggleTaskAt(source, index, count)) {
        ui.addToast('This item can only be changed in Write mode.', 'info')
        return
    }
    const changed = editorStore.transformText((state) => {
        const result = toggleTaskAt(state.value, index, count)
        return result && { value: result.text, selectionStart: state.selectionStart, selectionEnd: state.selectionEnd }
    }, { focus: false })
    if (changed) await editorStore.flushPendingSave()
}

function handleImageSelect(event) {
    const selected = event.target.files?.[0]
    if (selected) editorStore.uploadImage(selected)
    event.target.value = ''
}

const {
    isSupported: isDictationSupported,
    isRecording: isDictationRecording,
    startDictation,
    stopDictation,
} = useDictation({
    onFinalResult(text) {
        editorStore.insertText(text)
    },
    onError(type) {
        if (type === 'permission-denied') {
            ui.addToast('Microphone access denied. Allow the microphone in your browser settings.', 'error')
        } else if (type === 'unavailable') {
            ui.addToast('Speech recognition is unavailable. Check your connection or browser settings.', 'error')
        }
    },
})

function toggleDictation() {
    if (isDictationRecording.value) stopDictation()
    else startDictation()
}

watch(mode, (next) => {
    // The Editor was display:none while Preview showed; redraw it.
    if (next === MODE_WRITE) nextTick(() => editorStore.refreshLayout())
    // Dictation needs the Editor in view to land anywhere sensible.
    else if (isDictationRecording.value) stopDictation()
})
</script>

<style scoped>
.ph-editor {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--ph-surface);
}

.ph-editor-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 60px;
    padding: 0 4px;
    padding-top: env(safe-area-inset-top);
    box-sizing: content-box;
    border-bottom: 1px solid var(--ph-line);
    flex-shrink: 0;
}

.ph-editor-title {
    flex: 1;
    min-width: 0;
    padding: 0 4px;
}

.ph-editor-title h1 {
    font-size: 17px;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ph-editor-status {
    display: block;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: none;
    font-size: 13px;
    line-height: 1.3;
    color: var(--ph-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
}

.ph-editor-status-error {
    color: var(--ph-warn);
    text-decoration: underline;
}

.ph-editor-avatars {
    padding: 0 4px;
}

.ph-editor-mode {
    padding: 8px 16px;
    flex-shrink: 0;
}

.ph-editor-body {
    position: relative;
    flex: 1;
    min-height: 0;
}

.ph-write,
.ph-preview {
    height: 100%;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
}

.ph-preview {
    padding: 4px 20px 112px;
}

.ph-editor-fab {
    position: absolute;
    right: 16px;
    bottom: calc(20px + env(safe-area-inset-bottom));
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 52px;
    padding: 0 22px;
    border: 0;
    border-radius: 16px;
    background: var(--ph-accent);
    color: var(--ph-accent-ink);
    font-size: 16px;
    font-weight: 600;
    box-shadow: var(--ph-shadow);
}

.ph-recording {
    color: var(--ph-danger);
}

/*
 * OverType carries its own white background; follow the phone surface. Never
 * the textarea: it sits above the highlighted text layer and must stay
 * transparent, or the text disappears behind it.
 */
.ph-write :deep(.overtype-container),
.ph-write :deep(.overtype-wrapper),
.ph-write :deep(.overtype-preview) {
    background-color: var(--ph-surface) !important;
}
</style>
