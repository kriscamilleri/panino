<template>
    <BottomSheet
        :open="open"
        label="New note"
        tall
        testid="phone-capture-sheet"
        @close="finish"
    >
        <template #header>
            <div class="ph-capture-head">
                <button
                    type="button"
                    class="ph-capture-text-btn"
                    data-testid="phone-capture-discard"
                    @click="requestDiscard"
                >Discard</button>
                <div class="ph-capture-heading">
                    <h2>New note</h2>
                    <p
                        class="ph-capture-status"
                        aria-live="polite"
                        data-testid="phone-capture-status"
                    >{{ STATUS_LABELS[saveState] }}</p>
                </div>
                <button
                    type="button"
                    class="ph-capture-text-btn ph-capture-save"
                    :disabled="finishing"
                    data-testid="phone-capture-done"
                    @click="finish"
                >Done</button>
            </div>
        </template>

        <div class="ph-capture-body">
            <div class="ph-capture-options">
                <button
                    type="button"
                    class="ph-chip"
                    :aria-expanded="choosingDestination"
                    aria-haspopup="true"
                    data-testid="phone-capture-destination"
                    @click="toggleDestinations"
                >
                    <FolderMinus
                        v-if="!destination.folderId && !isSpace(destination.dbKey)"
                        class="h-4 w-4"
                        aria-hidden="true"
                    />
                    <Folder
                        v-else
                        class="h-4 w-4"
                        aria-hidden="true"
                    />
                    <span class="sr-only">Save to</span>
                    {{ destination.label }}
                    <ChevronDown
                        class="h-4 w-4"
                        aria-hidden="true"
                    />
                </button>
                <SegmentedControl
                    v-model="mode"
                    class="ph-capture-mode"
                    label="Editor mode"
                    testid-prefix="phone-capture-mode"
                    :options="MODE_OPTIONS"
                />
            </div>

            <ul
                v-if="choosingDestination"
                class="ph-capture-destinations"
                aria-label="Save to"
                data-testid="phone-capture-destinations"
            >
                <li
                    v-for="option in destinationOptions"
                    :key="`${option.dbKey}:${option.folderId}`"
                >
                    <button
                        type="button"
                        class="ph-row"
                        :aria-pressed="sameDestination(option, destination)"
                        @click="chooseDestination(option)"
                    >
                        <component
                            :is="option.folderId ? Folder : FolderMinus"
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                        <span class="ph-capture-dest-label">{{ option.path }}</span>
                        <Check
                            v-if="sameDestination(option, destination)"
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                    </button>
                </li>
                <li>
                    <button
                        type="button"
                        class="ph-row"
                        data-testid="phone-capture-new-folder"
                        @click="promptingFolder = true"
                    >
                        <FolderPlus
                            class="h-5 w-5"
                            aria-hidden="true"
                        />
                        New folder
                    </button>
                </li>
            </ul>

            <!-- The fields stay mounted in Preview so the caret survives the round trip. -->
            <div
                v-show="mode === MODE_WRITE"
                class="ph-capture-fields"
            >
                <label
                    class="sr-only"
                    for="ph-capture-title"
                >Title</label>
                <input
                    id="ph-capture-title"
                    v-model="title"
                    class="ph-capture-title"
                    type="text"
                    placeholder="Title"
                    autocomplete="off"
                    maxlength="200"
                    data-testid="phone-capture-title"
                >
                <label
                    class="sr-only"
                    for="ph-capture-text"
                >Note</label>
                <textarea
                    id="ph-capture-text"
                    ref="bodyRef"
                    v-model="body"
                    class="ph-capture-text"
                    :placeholder="initialKind === 'checklist' ? 'List item' : 'Note'"
                    data-autofocus
                    data-testid="phone-capture-body"
                    @keydown.enter.exact="handleEnter"
                ></textarea>
            </div>

            <div
                v-if="mode === MODE_PREVIEW"
                class="ph-capture-preview ph-preview"
                data-testid="phone-capture-preview"
            >
                <Preview
                    v-if="draft"
                    :source="draft.content"
                />
                <p
                    v-else
                    class="ph-capture-empty"
                >Nothing to preview yet.</p>
            </div>
        </div>

        <template #footer>
            <KeyRow
                v-if="mode === MODE_WRITE"
                :keys="CAPTURE_KEYS"
                :docked="false"
                label="Formatting"
                @press="pressKey"
            />
        </template>

        <BaseModal
            :show="confirmingDiscard"
            title="Discard note?"
            size="sm"
            @close="confirmingDiscard = false"
        >
            <p>This note is saved as you type. Discarding deletes it.</p>
            <template #footer>
                <BaseButton
                    variant="secondary"
                    @click="confirmingDiscard = false"
                >Keep editing</BaseButton>
                <BaseButton
                    variant="danger"
                    data-testid="phone-capture-discard-confirm"
                    @click="discard"
                >Discard</BaseButton>
            </template>
        </BaseModal>

        <PromptModal
            :show="promptingFolder"
            v-model="newFolderName"
            title="New folder"
            label="Folder name"
            input-testid="phone-capture-folder-name"
            @confirm="createFolder"
            @cancel="promptingFolder = false"
        />
    </BottomSheet>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { FolderMinus, Folder, FolderPlus, ChevronDown, Check, Heading, Bold, Italic, List, ListChecks, Link, PenLine, Eye } from 'lucide-vue-next'
import BottomSheet from '@/components/phone/BottomSheet.vue'
import SegmentedControl from '@/components/phone/SegmentedControl.vue'
import KeyRow from '@/components/phone/KeyRow.vue'
import Preview from '@/components/Preview.vue'
import BaseModal from '@/components/BaseModal.vue'
import BaseButton from '@/components/BaseButton.vue'
import PromptModal from '@/components/PromptModal.vue'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { buildCaptureDocument } from '@/utils/markdownSnippet'
import { applyKey, continueList } from '@/utils/markdownKeys'
import { MODE_PREVIEW, MODE_WRITE } from '@/utils/editorMode'

const MODE_OPTIONS = [
    { value: MODE_WRITE, label: 'Edit', icon: PenLine },
    { value: MODE_PREVIEW, label: 'Preview', icon: Eye },
]
const CAPTURE_KEYS = [
    { id: 'heading', name: 'Heading', icon: Heading },
    { id: 'bold', name: 'Bold', icon: Bold },
    { id: 'italic', name: 'Italic', icon: Italic },
    { id: 'bullet', name: 'Bulleted list', icon: List },
    { id: 'task', name: 'Checklist item', icon: ListChecks },
    { id: 'link', name: 'Link', icon: Link },
]
const CHECKLIST_START = '- [ ] '
const SAVE_DELAY_MS = 500
const STATUS_LABELS = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Not saved' }

const props = defineProps({
    open: { type: Boolean, default: false },
    /** 'note', or 'checklist' to start the body with an empty box */
    initialKind: { type: String, default: 'note' },
    /** `{ dbKey, folderId, label }` the sheet saves to unless changed. */
    defaultDestination: { type: Object, required: true },
})

const emit = defineEmits(['close'])

const docStore = useDocStore()
const syncStore = useSyncStore()
const ui = useUiStore()

const mode = ref(MODE_WRITE)
const title = ref('')
const body = ref('')
const bodyRef = ref(null)
const saveState = ref('idle')
const finishing = ref(false)
const confirmingDiscard = ref(false)
const choosingDestination = ref(false)
const destination = ref({ ...props.defaultDestination })
const folders = ref([])
const promptingFolder = ref(false)
const newFolderName = ref('')

const draft = computed(() => buildCaptureDocument({ title: title.value, body: body.value }))
const hasBody = computed(() => Boolean(buildCaptureDocument({ body: body.value })))
const isSpace = (dbKey) => Boolean(dbKey?.startsWith('space:'))
const sameDestination = (a, b) => a.dbKey === b.dbKey && (a.folderId || null) === (b.folderId || null)

/** No folder, every personal folder, and the folder on screen when it is in a space. */
const destinationOptions = computed(() => {
    const options = [{ dbKey: syncStore.personalDbKey, folderId: null, label: 'No folder', path: 'No folder' }]
    for (const folder of folders.value) {
        options.push({ dbKey: folder.dbKey, folderId: folder.id, label: folder.name, path: folder.path })
    }
    const current = props.defaultDestination
    if (!options.some((option) => sameDestination(option, current))) {
        options.push({ ...current, path: current.label })
    }
    return options
})

/*
 * The note is written as it is typed. Each opening of the sheet is one
 * session: `saved` is what the database holds for it, and every write runs on
 * `queue` in order, so a slow create is never overtaken by the update after it.
 */
function newSession() {
    return { saved: null, queue: Promise.resolve(), failed: false }
}

let session = newSession()
let saveTimer = null

function queueWrite() {
    clearTimeout(saveTimer)
    saveTimer = null
    const current = session
    const snapshot = { doc: draft.value, destination: { ...destination.value } }
    current.queue = current.queue.then(() => writeDraft(current, snapshot))
    return current.queue
}

async function writeDraft(current, { doc, destination: target }) {
    const live = current === session
    const folderId = target.folderId || null
    try {
        const saved = current.saved
        if (!doc) {
            // Everything was cleared: there is nothing left to keep.
            if (saved) {
                if (live) saveState.value = 'saving'
                await docStore.deleteItem(saved.id, 'file', saved.dbKey)
                current.saved = null
            }
            if (live) saveState.value = 'idle'
            return
        }
        if (live) saveState.value = 'saving'
        if (!saved || saved.dbKey !== target.dbKey) {
            // A draft moved to another database is created there and the first copy removed.
            const created = await docStore.createFile(target.dbKey, doc.title, folderId, { content: doc.content })
            current.saved = { id: created.id, dbKey: target.dbKey, folderId, title: doc.title, content: doc.content }
            if (saved) await docStore.deleteItem(saved.id, 'file', saved.dbKey)
        } else {
            if (saved.folderId !== folderId) {
                await docStore.moveItem(saved.id, folderId, 'file', saved.dbKey, saved.dbKey)
                saved.folderId = folderId
            }
            if (saved.title !== doc.title) {
                await docStore.renameItem(saved.id, doc.title, 'file', saved.dbKey)
                saved.title = doc.title
            }
            if (saved.content !== doc.content) {
                await docStore.updateFileContent(saved.id, doc.content, saved.dbKey)
                saved.content = doc.content
            }
        }
        current.failed = false
        if (live) saveState.value = 'saved'
    } catch (error) {
        console.error('[QuickCapture] Saving failed:', error)
        if (!current.failed) ui.addToast('The note could not be saved. Your text is still here.', 'error')
        current.failed = true
        if (live) saveState.value = 'error'
    }
}

/** The first write happens as soon as the body has text; later ones wait for a pause. */
watch([title, body, destination], () => {
    if (!props.open || finishing.value) return
    if (!session.saved) {
        if (hasBody.value) void queueWrite()
        return
    }
    // A cleared note is deleted when the sheet closes, not while it is being retyped.
    if (!draft.value) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void queueWrite() }, SAVE_DELAY_MS)
})

/** Write whatever is still pending; an emptied draft is deleted. */
function flush() {
    if (!saveTimer && !draft.value && !session.saved) return session.queue
    return queueWrite()
}

watch(() => props.open, (isOpen) => {
    if (!isOpen) {
        // Closed by back or another route change: keep what was typed.
        void flush()
        return
    }
    session = newSession()
    saveState.value = 'idle'
    mode.value = MODE_WRITE
    title.value = ''
    body.value = props.initialKind === 'checklist' ? CHECKLIST_START : ''
    destination.value = { ...props.defaultDestination }
    choosingDestination.value = false
    confirmingDiscard.value = false
    nextTick(() => {
        const field = bodyRef.value
        if (field) field.setSelectionRange(field.value.length, field.value.length)
    })
}, { immediate: true })

onBeforeUnmount(() => {
    if (props.open) void flush()
})

watch(mode, (next) => {
    if (next === MODE_WRITE) nextTick(() => bodyRef.value?.focus())
})

async function loadFolders() {
    if (!syncStore.personalDbKey) return
    try {
        folders.value = await docStore.listFolders(syncStore.personalDbKey)
    } catch (error) {
        console.warn('[QuickCapture] Could not list folders:', error)
    }
}

async function toggleDestinations() {
    choosingDestination.value = !choosingDestination.value
    if (choosingDestination.value) await loadFolders()
}

function chooseDestination(option) {
    destination.value = option
    choosingDestination.value = false
    bodyRef.value?.focus()
}

/** A new top-level personal folder, chosen as the destination at once. */
async function createFolder() {
    const name = newFolderName.value.trim()
    if (!name || !syncStore.personalDbKey) return
    promptingFolder.value = false
    newFolderName.value = ''
    try {
        const created = await docStore.createFolder(syncStore.personalDbKey, name, null)
        await loadFolders()
        chooseDestination({ dbKey: syncStore.personalDbKey, folderId: created.id, label: name, path: name })
    } catch (error) {
        console.error('[QuickCapture] Folder creation failed:', error)
        ui.addToast('The folder could not be created. Try again.', 'error')
    }
}

/** Apply a pure edit to the textarea and keep the caret where it lands. */
function editBody(fn) {
    const field = bodyRef.value
    if (!field) return false
    const next = fn({ value: body.value, selectionStart: field.selectionStart, selectionEnd: field.selectionEnd })
    if (!next) return false
    body.value = next.value
    nextTick(() => {
        field.focus()
        field.setSelectionRange(next.selectionStart, next.selectionEnd)
    })
    return true
}

function pressKey(id) {
    editBody((state) => applyKey(id, state))
}

function handleEnter(event) {
    if (editBody(continueList)) event.preventDefault()
}

/** Done, swipe down or the backdrop: save the last keystrokes, then close. */
async function finish() {
    if (finishing.value || confirmingDiscard.value) return
    finishing.value = true
    try {
        const current = session
        await flush()
        // A failed write keeps the sheet open so the text is not lost.
        if (!current.failed) emit('close')
    } finally {
        finishing.value = false
    }
}

function requestDiscard() {
    if (confirmingDiscard.value || finishing.value) return
    if (draft.value || session.saved) confirmingDiscard.value = true
    else emit('close')
}

async function discard() {
    confirmingDiscard.value = false
    finishing.value = true
    try {
        title.value = ''
        body.value = ''
        await queueWrite()
        emit('close')
    } finally {
        finishing.value = false
    }
}
</script>

<style scoped>
.ph-capture-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.ph-capture-heading {
    text-align: center;
}

.ph-capture-heading h2 {
    font-size: 17px;
    font-weight: 600;
}

.ph-capture-status {
    min-height: 16px;
    color: var(--ph-muted);
    font-size: 12px;
}

.ph-capture-text-btn {
    min-width: 64px;
    min-height: 44px;
    padding: 0 8px;
    border: 0;
    background: none;
    color: var(--ph-accent);
    font-size: 16px;
}

.ph-capture-save {
    font-weight: 600;
}

.ph-capture-text-btn:disabled {
    color: var(--ph-muted);
    opacity: 0.6;
}

.ph-capture-body {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: 4px 20px 12px;
}

.ph-capture-options {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.ph-capture-options .ph-chip {
    max-width: 55%;
    overflow: hidden;
}

.ph-capture-mode {
    flex: 1;
    min-width: 180px;
}

.ph-capture-destinations {
    margin: 8px -20px 0;
    border-top: 1px solid var(--ph-line);
    border-bottom: 1px solid var(--ph-line);
    max-height: 240px;
    overflow-y: auto;
}

.ph-capture-dest-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ph-capture-fields {
    display: flex;
    flex: 1;
    flex-direction: column;
}

.ph-capture-preview {
    flex: 1;
    margin-top: 14px;
}

.ph-capture-empty {
    color: var(--ph-muted);
    font-size: 17px;
}

.ph-capture-title {
    margin-top: 14px;
    min-height: 44px;
    border: 0;
    background: transparent;
    color: var(--ph-ink);
    font-size: 20px;
    font-weight: 600;
    outline: none;
}

.ph-capture-text {
    flex: 1;
    min-height: 160px;
    border: 0;
    resize: none;
    background: transparent;
    color: var(--ph-ink);
    font-size: 17px;
    line-height: 1.5;
    outline: none;
}

/* Borderless fields: the caret shows focus; a ring would box the whole sheet. */
.ph-capture-title:focus-visible,
.ph-capture-text:focus-visible {
    outline: none;
}

.ph-capture-title::placeholder,
.ph-capture-text::placeholder {
    color: var(--ph-muted);
}

:deep(.ph-sheet-footer) {
    padding: 0;
}
</style>
