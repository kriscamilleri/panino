<template>
    <BottomSheet
        :open="open"
        label="New note"
        tall
        testid="phone-capture-sheet"
        @close="requestCancel"
    >
        <template #header>
            <div class="ph-capture-head">
                <button
                    type="button"
                    class="ph-capture-text-btn"
                    data-testid="phone-capture-cancel"
                    @click="requestCancel"
                >Cancel</button>
                <h2>New note</h2>
                <button
                    type="button"
                    class="ph-capture-text-btn ph-capture-save"
                    :disabled="!draft || saving"
                    data-testid="phone-capture-save"
                    @click="save"
                >{{ saving ? 'Saving…' : 'Save' }}</button>
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
                    v-model="kind"
                    class="ph-capture-kind"
                    label="Note type"
                    testid-prefix="phone-capture-kind"
                    :options="KIND_OPTIONS"
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
            </ul>

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
                :placeholder="kind === 'checklist' ? 'List item' : 'Note'"
                data-autofocus
                data-testid="phone-capture-body"
                @keydown.enter.exact="handleEnter"
            ></textarea>
        </div>

        <template #footer>
            <KeyRow
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
            <p>What you typed has not been saved.</p>
            <template #footer>
                <BaseButton
                    variant="secondary"
                    @click="confirmingDiscard = false"
                >Keep editing</BaseButton>
                <BaseButton
                    variant="danger"
                    data-testid="phone-capture-discard"
                    @click="discard"
                >Discard</BaseButton>
            </template>
        </BaseModal>
    </BottomSheet>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { FolderMinus, Folder, ChevronDown, Check, Heading, Bold, Italic, List, ListChecks, Link, StickyNote } from 'lucide-vue-next'
import BottomSheet from '@/components/phone/BottomSheet.vue'
import SegmentedControl from '@/components/phone/SegmentedControl.vue'
import KeyRow from '@/components/phone/KeyRow.vue'
import BaseModal from '@/components/BaseModal.vue'
import BaseButton from '@/components/BaseButton.vue'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { useSheetRoute } from '@/composables/useSheetRoute'
import { buildCaptureDocument } from '@/utils/markdownSnippet'
import { applyKey, continueList } from '@/utils/markdownKeys'

const KIND_OPTIONS = [
    { value: 'note', label: 'Note', icon: StickyNote },
    { value: 'checklist', label: 'Checklist', icon: ListChecks },
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

const props = defineProps({
    open: { type: Boolean, default: false },
    /** 'note' or 'checklist' */
    initialKind: { type: String, default: 'note' },
    /** `{ dbKey, folderId, label }` the sheet saves to unless changed. */
    defaultDestination: { type: Object, required: true },
})

const emit = defineEmits(['close'])

const docStore = useDocStore()
const syncStore = useSyncStore()
const ui = useUiStore()
const { closeSheetAndGo } = useSheetRoute()

const kind = ref('note')
const title = ref('')
const body = ref('')
const bodyRef = ref(null)
const saving = ref(false)
const confirmingDiscard = ref(false)
const choosingDestination = ref(false)
const destination = ref({ ...props.defaultDestination })
const folders = ref([])

const draft = computed(() => buildCaptureDocument({ title: title.value, body: body.value }))
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

watch(() => props.open, (isOpen) => {
    if (!isOpen) return
    kind.value = props.initialKind === 'checklist' ? 'checklist' : 'note'
    title.value = ''
    body.value = kind.value === 'checklist' ? CHECKLIST_START : ''
    destination.value = { ...props.defaultDestination }
    choosingDestination.value = false
    confirmingDiscard.value = false
    nextTick(() => {
        const field = bodyRef.value
        if (field) field.setSelectionRange(field.value.length, field.value.length)
    })
}, { immediate: true })

watch(kind, (next) => {
    if (next === 'checklist' && !body.value.trim()) body.value = CHECKLIST_START
    if (next === 'note' && body.value === CHECKLIST_START) body.value = ''
    nextTick(() => bodyRef.value?.focus())
})

async function toggleDestinations() {
    choosingDestination.value = !choosingDestination.value
    if (choosingDestination.value && syncStore.personalDbKey) {
        try {
            folders.value = await docStore.listFolders(syncStore.personalDbKey)
        } catch (error) {
            console.warn('[QuickCapture] Could not list folders:', error)
        }
    }
}

function chooseDestination(option) {
    destination.value = option
    choosingDestination.value = false
    bodyRef.value?.focus()
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

function hasContent() {
    return Boolean(draft.value)
}

function requestCancel() {
    if (confirmingDiscard.value) return
    if (hasContent()) confirmingDiscard.value = true
    else emit('close')
}

function discard() {
    confirmingDiscard.value = false
    title.value = ''
    body.value = ''
    emit('close')
}

async function save() {
    const documentToSave = draft.value
    if (!documentToSave || saving.value) return
    saving.value = true
    try {
        const { dbKey, folderId } = destination.value
        const created = await docStore.createFile(dbKey, documentToSave.title, folderId || null, {
            content: documentToSave.content,
        })
        title.value = ''
        body.value = ''
        await closeSheetAndGo({ name: 'doc', params: { fileId: created.id }, query: { dbKey, mode: 'write' } })
    } catch (error) {
        console.error('[QuickCapture] Saving failed:', error)
        ui.addToast('The note could not be saved. Your text is still here.', 'error')
    } finally {
        saving.value = false
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

.ph-capture-head h2 {
    font-size: 17px;
    font-weight: 600;
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
    font-weight: 700;
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

.ph-capture-kind {
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
