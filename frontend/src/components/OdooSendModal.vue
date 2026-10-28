<template>
    <BaseModal
        :show="show"
        title="Send to Odoo"
        size="md"
        close-testid="odoo-send-close"
        @close="emit('close')"
    >
        <div class="space-y-4">
            <p
                v-if="loading"
                class="pn-body"
            >Loading…</p>

            <template v-else-if="!odoo.isConnected">
                <p
                    class="pn-body"
                    data-testid="odoo-send-not-connected"
                >Connect your Odoo in Settings first. Sending uses your own Odoo user.</p>
                <BaseButton
                    variant="primary"
                    size="md"
                    data-testid="odoo-send-open-settings"
                    @click="openSettings"
                >
                    <Settings class="h-4 w-4" />
                    <span>Open Settings</span>
                </BaseButton>
            </template>

            <template v-else>
                <p
                    class="pn-help"
                    data-testid="odoo-send-target"
                >To {{ host }} as {{ odoo.status.odooUserName || 'your Odoo user' }}</p>

                <div
                    v-if="loadError"
                    class="pn-alert pn-alert-error"
                    role="alert"
                >{{ loadError }}</div>

                <div
                    v-if="!hasDestination"
                    class="pn-alert pn-alert-info"
                    data-testid="odoo-send-no-destination"
                >This Odoo has none of Documents, CRM or Sales available to your Odoo user, so there is nowhere to send a PDF yet.</div>

                <section
                    v-if="hasDocumentsApp"
                    class="pn-panel p-4 space-y-3"
                    data-testid="odoo-send-documents"
                >
                    <label class="flex items-center gap-2 pn-title-section">
                        <input
                            v-model="toDocuments"
                            type="checkbox"
                            class="pn-checkbox"
                            data-testid="odoo-send-documents-toggle"
                        >
                        PDF to Documents
                    </label>

                    <div
                        v-if="documentsLink"
                        class="pn-body"
                        data-testid="odoo-send-last-sent"
                    >
                        Sent {{ sentAgo(documentsLink.lastSentAt) }}<span v-if="documentsLink.lastSentBy"> by {{ documentsLink.lastSentBy }}</span>.
                        Sending again replaces that PDF in Odoo.
                        <a
                            v-if="documentsLink.url"
                            :href="documentsLink.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="font-medium underline underline-offset-2"
                        >Open in Odoo</a>
                    </div>

                    <div
                        v-else-if="toDocuments"
                        class="space-y-2"
                    >
                        <label
                            class="pn-label"
                            for="odoo-folder-search"
                        >Folder</label>
                        <input
                            id="odoo-folder-search"
                            v-model="folderQuery"
                            class="pn-input"
                            type="search"
                            placeholder="Search folders"
                            autocomplete="off"
                            data-testid="odoo-folder-search"
                        >
                        <ul
                            class="max-h-48 overflow-y-auto rounded-md border border-gray-200"
                            role="listbox"
                            aria-label="Documents folders"
                            data-testid="odoo-folder-list"
                        >
                            <li
                                v-for="folder in folders"
                                :key="folder.id"
                                role="option"
                                :aria-selected="folder.id === folderId"
                            >
                                <button
                                    type="button"
                                    class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                                    :class="{ 'bg-gray-100 font-medium': folder.id === folderId }"
                                    :data-testid="`odoo-folder-${folder.id}`"
                                    @click="folderId = folder.id"
                                >
                                    <span class="min-w-0 truncate">
                                        <span
                                            v-if="folder.parentName"
                                            class="pn-help"
                                        >{{ folder.parentName }} / </span>{{ folder.name }}
                                    </span>
                                    <Check
                                        v-if="folder.id === folderId"
                                        class="h-4 w-4 shrink-0"
                                        aria-hidden="true"
                                    />
                                </button>
                            </li>
                            <li
                                v-if="!folders.length && !loadingFolders"
                                class="px-3 py-2 pn-help"
                            >No folders match.</li>
                        </ul>
                    </div>

                    <div
                        v-if="results.documents"
                        :class="results.documents.ok ? 'pn-alert pn-alert-success' : 'pn-alert pn-alert-error'"
                        role="status"
                        data-testid="odoo-send-result"
                    >
                        <span>{{ documentsResultMessage }}</span>
                        <a
                            v-if="results.documents.ok && results.documents.url"
                            :href="results.documents.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="ml-1 font-medium underline underline-offset-2"
                            data-testid="odoo-send-open"
                        >Open in Odoo</a>
                    </div>
                </section>

                <section
                    v-if="hasChatterApps"
                    class="pn-panel p-4 space-y-3"
                    data-testid="odoo-send-chatter"
                >
                    <label class="flex items-center gap-2 pn-title-section">
                        <input
                            v-model="toChatter"
                            type="checkbox"
                            class="pn-checkbox"
                            data-testid="odoo-send-chatter-toggle"
                        >
                        PDF to {{ chatterLabel }}
                    </label>

                    <div
                        v-if="toChatter"
                        class="space-y-2"
                    >
                        <p class="pn-help">Posted as an internal note. The customer isn't emailed.</p>
                        <label
                            class="pn-label"
                            for="odoo-record-search"
                        >{{ chatterLabelCapitalized }}</label>
                        <input
                            id="odoo-record-search"
                            v-model="recordQuery"
                            class="pn-input"
                            type="search"
                            :placeholder="`Search by reference, name or customer`"
                            autocomplete="off"
                            data-testid="odoo-record-search"
                        >
                        <ul
                            class="max-h-48 overflow-y-auto rounded-md border border-gray-200"
                            role="listbox"
                            :aria-label="chatterLabelCapitalized"
                            data-testid="odoo-record-list"
                        >
                            <li
                                v-for="record in records"
                                :key="recordKey(record)"
                                role="option"
                                :aria-selected="recordKey(record) === selectedRecordKey"
                            >
                                <button
                                    type="button"
                                    class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                                    :class="{ 'bg-gray-100 font-medium': recordKey(record) === selectedRecordKey }"
                                    :data-testid="`odoo-record-${record.resModel}-${record.resId}`"
                                    @click="selectedRecordKey = recordKey(record)"
                                >
                                    <span class="min-w-0 flex-1">
                                        <span class="block truncate">
                                            <span class="pn-help">{{ record.resModel === 'sale.order' ? 'Order' : 'Opportunity' }} · </span>{{ record.name }}
                                        </span>
                                        <span class="block pn-help">
                                            <span v-if="record.partnerName">{{ record.partnerName }}</span>
                                            <span v-if="record.partnerName && record.status"> · </span>
                                            <span v-if="record.status">{{ record.status }}</span>
                                            <span
                                                v-if="sentTo(record)"
                                                :data-testid="`odoo-record-sent-${record.resModel}-${record.resId}`"
                                            > · Sent {{ sentAgo(sentTo(record).lastSentAt) }}<span v-if="sentTo(record).lastSentBy"> by {{ sentTo(record).lastSentBy }}</span></span>
                                        </span>
                                    </span>
                                    <Check
                                        v-if="recordKey(record) === selectedRecordKey"
                                        class="h-4 w-4 shrink-0"
                                        aria-hidden="true"
                                    />
                                </button>
                            </li>
                            <li
                                v-if="!records.length && !loadingRecords"
                                class="px-3 py-2 pn-help"
                            >No {{ chatterLabel }} match.</li>
                        </ul>
                        <p
                            v-if="selectedRecordLink"
                            class="pn-body"
                            data-testid="odoo-send-chatter-last-sent"
                        >Sending again replaces the PDF on the note Panino posted there and adds a short note.</p>
                    </div>

                    <div
                        v-if="results.chatter"
                        :class="results.chatter.ok ? 'pn-alert pn-alert-success' : 'pn-alert pn-alert-error'"
                        role="status"
                        data-testid="odoo-send-chatter-result"
                    >
                        <span>{{ chatterResultMessage }}</span>
                        <a
                            v-if="results.chatter.ok && results.chatter.url"
                            :href="results.chatter.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="ml-1 font-medium underline underline-offset-2"
                            data-testid="odoo-send-chatter-open"
                        >Open in Odoo</a>
                    </div>
                </section>

                <div
                    v-if="sendError"
                    class="pn-alert pn-alert-error"
                    role="alert"
                    data-testid="odoo-send-error"
                >{{ sendError }}</div>
            </template>
        </div>

        <template
            v-if="odoo.isConnected && hasDestination"
            #footer
        >
            <BaseButton
                variant="secondary"
                size="md"
                @click="emit('close')"
            >{{ allSent ? 'Done' : 'Cancel' }}</BaseButton>
            <BaseButton
                variant="primary"
                size="md"
                :disabled="!canSend"
                data-testid="odoo-send-submit"
                @click="send"
            >
                <Send class="h-4 w-4" />
                <span>{{ sending ? 'Sending…' : (allUpdates ? 'Update in Odoo' : 'Send') }}</span>
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Check, Send, Settings } from 'lucide-vue-next'
import BaseModal from '@/components/BaseModal.vue'
import BaseButton from '@/components/BaseButton.vue'
import { useDocStore } from '@/store/docStore'
import { useOdooStore } from '@/store/odooStore'
import { useSyncStore } from '@/store/syncStore'
import { useDocumentPdfRequest } from '@/composables/useDocumentPdfRequest'
import { odooHost, sentAgo } from '@/utils/odooConnection'

const props = defineProps({
    show: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const router = useRouter()
const docStore = useDocStore()
const odoo = useOdooStore()
const syncStore = useSyncStore()
const { buildForSelected } = useDocumentPdfRequest()
const { selectedFile: file } = storeToRefs(docStore)

const loading = ref(false)
const loadError = ref('')
const sendError = ref('')
const links = ref([])
const folders = ref([])
const folderQuery = ref('')
const folderId = ref(null)
const loadingFolders = ref(false)
const toDocuments = ref(true)
const records = ref([])
const recordQuery = ref('')
const selectedRecordKey = ref(null)
const loadingRecords = ref(false)
const toChatter = ref(false)
const sending = ref(false)
const results = ref({})

const host = computed(() => odooHost(odoo.status?.baseUrl))
const apps = computed(() => odoo.status?.apps || [])
const hasDocumentsApp = computed(() => apps.value.includes('documents'))
const hasCrm = computed(() => apps.value.includes('crm'))
const hasSales = computed(() => apps.value.includes('sales'))
const hasChatterApps = computed(() => hasCrm.value || hasSales.value)
const hasDestination = computed(() => hasDocumentsApp.value || hasChatterApps.value)
const chatterLabel = computed(() => {
    if (hasCrm.value && hasSales.value) return 'an opportunity or sales order'
    return hasCrm.value ? 'an opportunity' : 'a sales order'
})
const chatterLabelCapitalized = computed(() => {
    if (hasCrm.value && hasSales.value) return 'Opportunity or sales order'
    return hasCrm.value ? 'Opportunity' : 'Sales order'
})

const documentsLink = computed(() => links.value.find((link) => link.destination === 'documents' && link.sameOdoo) || null)
const recordKey = (record) => `${record.resModel}:${record.resId}`
const sentTo = (record) => links.value.find((link) => link.destination === 'chatter' && link.sameOdoo && link.targetKey === recordKey(record)) || null
const selectedRecord = computed(() => records.value.find((record) => recordKey(record) === selectedRecordKey.value) || null)
const selectedRecordLink = computed(() => (selectedRecord.value ? sentTo(selectedRecord.value) : null))

const wantsDocuments = computed(() => hasDocumentsApp.value && toDocuments.value)
const wantsChatter = computed(() => hasChatterApps.value && toChatter.value)
const documentsReady = computed(() => Boolean(documentsLink.value || folderId.value))
const chatterReady = computed(() => Boolean(selectedRecord.value))
const canSend = computed(() => !sending.value && syncStore.isOnline && Boolean(file.value)
    && (wantsDocuments.value || wantsChatter.value)
    && (!wantsDocuments.value || documentsReady.value)
    && (!wantsChatter.value || chatterReady.value))
const allUpdates = computed(() => (wantsDocuments.value || wantsChatter.value)
    && (!wantsDocuments.value || Boolean(documentsLink.value))
    && (!wantsChatter.value || Boolean(selectedRecordLink.value)))
const allSent = computed(() => {
    const done = Object.values(results.value)
    return done.length > 0 && done.every((result) => result.ok)
})

const documentsResultMessage = computed(() => {
    const result = results.value.documents
    if (!result) return ''
    if (!result.ok) return result.message
    if (result.recreated) return 'The earlier PDF was gone from Odoo, so a new one was made.'
    return result.created ? 'Sent to Odoo Documents.' : 'Updated in Odoo Documents.'
})
const chatterResultMessage = computed(() => {
    const result = results.value.chatter
    if (!result) return ''
    if (!result.ok) return result.message
    if (result.recreated) return 'The earlier PDF was gone from that record, so it was posted again.'
    if (!result.created && result.noteMissing) return 'The PDF was replaced, but the note saying so could not be posted.'
    return result.created ? 'Posted as an internal note.' : 'The PDF on the note was replaced.'
})

async function loadFolders() {
    loadingFolders.value = true
    try {
        folders.value = await odoo.fetchFolders(folderQuery.value.trim())
    } catch (error) {
        loadError.value = error.message
    } finally {
        loadingFolders.value = false
    }
}

async function loadRecords() {
    if (!file.value) return
    loadingRecords.value = true
    try {
        records.value = await odoo.fetchRecords(recordQuery.value.trim(), { dbKey: file.value.dbKey, noteId: file.value.id })
    } catch (error) {
        loadError.value = error.message
    } finally {
        loadingRecords.value = false
    }
}

let folderTimer = null
watch(folderQuery, () => {
    clearTimeout(folderTimer)
    folderTimer = setTimeout(loadFolders, 250)
})

let recordTimer = null
watch(recordQuery, () => {
    clearTimeout(recordTimer)
    recordTimer = setTimeout(loadRecords, 250)
})

// The picker loads when the destination is first ticked, not before.
watch(toChatter, (on) => {
    if (on && !records.value.length && !loadingRecords.value) void loadRecords()
})

watch(() => props.show, async (open) => {
    if (!open) return
    loading.value = true
    loadError.value = ''
    sendError.value = ''
    results.value = {}
    links.value = []
    folderId.value = null
    folderQuery.value = ''
    records.value = []
    recordQuery.value = ''
    selectedRecordKey.value = null
    toChatter.value = false
    try {
        await odoo.fetchStatus()
        toDocuments.value = hasDocumentsApp.value
        if (odoo.isConnected && hasDestination.value && file.value) {
            const data = await odoo.fetchLinks(file.value.dbKey, file.value.id)
            links.value = data?.links || []
            folderId.value = data?.defaults?.folderId ?? null
            if (hasDocumentsApp.value && !documentsLink.value) await loadFolders()
        }
    } catch (error) {
        loadError.value = error.message
    } finally {
        loading.value = false
    }
}, { immediate: true })

async function send() {
    if (!canSend.value) return
    sending.value = true
    sendError.value = ''
    results.value = {}
    try {
        const pdfRequest = await buildForSelected()
        const body = {
            dbKey: file.value.dbKey,
            noteId: file.value.id,
            title: file.value.title,
            pdfRequest,
        }
        if (wantsDocuments.value) body.documents = documentsLink.value ? {} : { folderId: folderId.value }
        if (wantsChatter.value) body.chatter = { resModel: selectedRecord.value.resModel, resId: selectedRecord.value.resId }
        const response = await odoo.send(body)
        results.value = {
            ...(wantsDocuments.value ? { documents: response?.documents || { ok: false, message: 'Odoo did not answer.' } } : {}),
            ...(wantsChatter.value ? { chatter: response?.chatter || { ok: false, message: 'Odoo did not answer.' } } : {}),
        }
        if (Object.values(results.value).some((result) => result.ok)) {
            const data = await odoo.fetchLinks(file.value.dbKey, file.value.id)
            links.value = data?.links || []
        }
    } catch (error) {
        sendError.value = error.message
    } finally {
        sending.value = false
    }
}

function openSettings() {
    emit('close')
    router.push('/settings')
}
</script>
