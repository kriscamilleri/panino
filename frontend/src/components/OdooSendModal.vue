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
                    v-if="!hasDocumentsApp"
                    class="pn-alert pn-alert-info"
                    data-testid="odoo-send-no-documents"
                >This Odoo has no Documents app your Odoo user can use, so there is nowhere to send a PDF yet.</div>

                <section
                    v-else
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
                </section>

                <div
                    v-if="result"
                    :class="result.ok ? 'pn-alert pn-alert-success' : 'pn-alert pn-alert-error'"
                    role="status"
                    data-testid="odoo-send-result"
                >
                    <span>{{ result.ok ? resultMessage : result.message }}</span>
                    <a
                        v-if="result.ok && result.url"
                        :href="result.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="ml-1 font-medium underline underline-offset-2"
                        data-testid="odoo-send-open"
                    >Open in Odoo</a>
                </div>
            </template>
        </div>

        <template
            v-if="odoo.isConnected && hasDocumentsApp"
            #footer
        >
            <BaseButton
                variant="secondary"
                size="md"
                @click="emit('close')"
            >{{ result?.ok ? 'Done' : 'Cancel' }}</BaseButton>
            <BaseButton
                variant="primary"
                size="md"
                :disabled="!canSend"
                data-testid="odoo-send-submit"
                @click="send"
            >
                <Send class="h-4 w-4" />
                <span>{{ sending ? 'Sending…' : (documentsLink ? 'Update in Odoo' : 'Send') }}</span>
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
const links = ref([])
const folders = ref([])
const folderQuery = ref('')
const folderId = ref(null)
const loadingFolders = ref(false)
const toDocuments = ref(true)
const sending = ref(false)
const result = ref(null)

const host = computed(() => odooHost(odoo.status?.baseUrl))
const hasDocumentsApp = computed(() => Boolean(odoo.status?.apps?.includes('documents')))
const documentsLink = computed(() => links.value.find((link) => link.destination === 'documents' && link.sameOdoo) || null)
const canSend = computed(() => !sending.value && syncStore.isOnline && Boolean(file.value)
    && toDocuments.value && (documentsLink.value || folderId.value))
const resultMessage = computed(() => {
    if (!result.value?.ok) return ''
    if (result.value.recreated) return 'The earlier PDF was gone from Odoo, so a new one was made.'
    return result.value.created ? 'Sent to Odoo Documents.' : 'Updated in Odoo Documents.'
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

let folderTimer = null
watch(folderQuery, () => {
    clearTimeout(folderTimer)
    folderTimer = setTimeout(loadFolders, 250)
})

watch(() => props.show, async (open) => {
    if (!open) return
    loading.value = true
    loadError.value = ''
    result.value = null
    links.value = []
    folderId.value = null
    folderQuery.value = ''
    toDocuments.value = true
    try {
        await odoo.fetchStatus()
        if (odoo.isConnected && hasDocumentsApp.value && file.value) {
            const data = await odoo.fetchLinks(file.value.dbKey, file.value.id)
            links.value = data?.links || []
            folderId.value = data?.defaults?.folderId ?? null
            if (!documentsLink.value) await loadFolders()
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
    result.value = null
    try {
        const pdfRequest = await buildForSelected()
        const response = await odoo.send({
            dbKey: file.value.dbKey,
            noteId: file.value.id,
            title: file.value.title,
            pdfRequest,
            documents: documentsLink.value ? {} : { folderId: folderId.value },
        })
        result.value = response?.documents || { ok: false, message: 'Odoo did not answer.' }
        if (result.value.ok) {
            const data = await odoo.fetchLinks(file.value.dbKey, file.value.id)
            links.value = data?.links || []
        }
    } catch (error) {
        result.value = { ok: false, message: error.message }
    } finally {
        sending.value = false
    }
}

function openSettings() {
    emit('close')
    router.push('/settings')
}
</script>
