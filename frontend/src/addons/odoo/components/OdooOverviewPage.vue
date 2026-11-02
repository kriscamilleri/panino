<template>
    <div
        class="space-y-6"
        data-testid="odoo-overview"
    >
        <p
            v-if="loading && !data"
            class="pn-body"
        >Loading…</p>

        <div
            v-else-if="!odoo.isConnected"
            class="space-y-4"
            data-testid="odoo-overview-not-connected"
        >
            <p class="pn-body">Connect your Odoo in Settings first. The overview lists what you and your spaces sent to it.</p>
            <BaseButton
                variant="primary"
                size="md"
                @click="router.push('/settings')"
            >
                <Settings class="h-4 w-4" />
                <span>Open Settings</span>
            </BaseButton>
        </div>

        <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-2">
                <p
                    class="pn-help"
                    data-testid="odoo-overview-host"
                >{{ host }} as {{ odoo.status?.odooUserName || 'your Odoo user' }}</p>
                <BaseButton
                    variant="ghost"
                    size="sm"
                    :disabled="loading"
                    data-testid="odoo-overview-refresh"
                    @click="load"
                >
                    <RefreshCw class="h-4 w-4" />
                    <span>Refresh</span>
                </BaseButton>
            </div>

            <div
                v-if="error"
                class="pn-alert pn-alert-error"
                role="alert"
                data-testid="odoo-overview-error"
            >{{ error }}</div>

            <div class="flex flex-wrap items-center gap-2">
                <div
                    class="inline-flex rounded-md border border-gray-200 p-0.5"
                    role="tablist"
                >
                    <button
                        v-for="option in TABS"
                        :key="option.id"
                        type="button"
                        role="tab"
                        class="rounded px-3 py-1.5 text-sm"
                        :class="tab === option.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'"
                        :aria-selected="tab === option.id"
                        :data-testid="`odoo-overview-tab-${option.id}`"
                        @click="tab = option.id"
                    >{{ option.label }} <span class="opacity-75">{{ counts[option.id] }}</span></button>
                </div>
                <select
                    v-if="data?.places?.length > 1"
                    v-model="where"
                    class="pn-select w-auto"
                    aria-label="Where"
                    data-testid="odoo-overview-where"
                >
                    <option value="all">Everywhere</option>
                    <option
                        v-for="place in data.places"
                        :key="place.dbKey"
                        :value="place.dbKey"
                    >{{ place.name }}</option>
                </select>
                <input
                    v-model="search"
                    type="search"
                    class="pn-input max-w-xs"
                    placeholder="Search Documents"
                    aria-label="Search Documents"
                    data-testid="odoo-overview-search"
                >
            </div>

            <p
                v-if="data?.truncated"
                class="pn-alert pn-alert-info"
                data-testid="odoo-overview-truncated"
            >Showing the first {{ data.documents.length }} of {{ data.total }} Documents. Choose a place to see the rest.</p>

            <div
                v-if="!rows.length"
                class="pn-body"
                data-testid="odoo-overview-empty"
            >
                <template v-if="!data?.documents?.length">Nothing has been sent to Odoo yet. Send a Document from the Add-ons menu, or keep a folder in sync from Settings.</template>
                <template v-else-if="tab === 'attention' && !search">
                    Everything is up to date.
                    <button
                        type="button"
                        class="font-medium underline underline-offset-2"
                        data-testid="odoo-overview-show-all"
                        @click="tab = 'all'"
                    >Show all {{ counts.all }}</button>
                </template>
                <template v-else>No Documents match.</template>
            </div>

            <ul
                v-else
                class="divide-y divide-gray-200 rounded-md border border-gray-200"
                data-testid="odoo-overview-list"
            >
                <li
                    v-for="row in rows"
                    :key="row.key"
                    class="flex gap-3 p-3"
                    :data-testid="`odoo-overview-row-${row.noteId}`"
                >
                    <input
                        v-if="!isPhone"
                        type="checkbox"
                        class="pn-checkbox mt-1"
                        :disabled="!row.canSend || sending"
                        :checked="selected.has(row.key)"
                        :aria-label="`Select ${row.title || 'Document'}`"
                        :data-testid="`odoo-overview-select-${row.noteId}`"
                        @change="toggle(row)"
                    >
                    <div class="min-w-0 flex-1 space-y-1">
                        <div class="flex flex-wrap items-baseline gap-x-2">
                            <button
                                v-if="row.title !== null"
                                type="button"
                                class="truncate text-left font-medium hover:underline"
                                :data-testid="`odoo-overview-open-doc-${row.noteId}`"
                                @click="openDocument(row)"
                            >{{ row.title }}</button>
                            <span
                                v-else
                                class="font-medium text-gray-500"
                            >Deleted Document</span>
                            <span class="pn-help">{{ row.placeName }}</span>
                        </div>
                        <p
                            class="pn-help"
                            :class="{ 'text-red-700': ATTENTION.includes(row.state) }"
                            :data-testid="`odoo-overview-state-${row.noteId}`"
                        >{{ stateLine(row) }}</p>
                        <p
                            v-if="rowStatus[row.key]?.text"
                            class="pn-help text-red-700"
                            role="status"
                            :data-testid="`odoo-overview-result-${row.noteId}`"
                        >{{ rowStatus[row.key].text }}</p>
                        <p class="pn-help flex flex-wrap gap-x-3">
                            <a
                                v-for="record in row.records.filter((entry) => entry.url)"
                                :key="record.key"
                                :href="record.url"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="underline underline-offset-2"
                                :data-testid="`odoo-overview-link-${row.noteId}-${record.destination}`"
                            >{{ record.label }}</a>
                        </p>
                    </div>
                    <BaseButton
                        v-if="row.canSend && row.state === 'changed'"
                        variant="secondary"
                        size="sm"
                        class="self-start shrink-0"
                        :disabled="sending || !syncStore.isOnline"
                        :data-testid="`odoo-overview-send-${row.noteId}`"
                        @click="sendUpdates([row])"
                    >{{ rowStatus[row.key]?.sending ? 'Sending…' : 'Send update' }}</BaseButton>
                </li>
            </ul>

            <div
                v-if="!isPhone && selectedRows.length"
                class="sticky bottom-0 flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white p-3 shadow"
                data-testid="odoo-overview-bulk"
            >
                <span class="pn-body">{{ selectedRows.length }} selected</span>
                <BaseButton
                    variant="primary"
                    size="md"
                    :disabled="sending || !syncStore.isOnline"
                    data-testid="odoo-overview-send-selected"
                    @click="sendUpdates(selectedRows)"
                >
                    <Send class="h-4 w-4" />
                    <span>{{ sending ? 'Sending…' : (selectedRows.length > MAX_PER_PRESS ? `Send updates (first ${MAX_PER_PRESS})` : 'Send updates') }}</span>
                </BaseButton>
            </div>

            <section
                v-if="syncPlaces.length"
                class="space-y-4"
                data-testid="odoo-overview-syncs"
            >
                <h2 class="pn-title-section">Syncs</h2>
                <div
                    v-for="place in syncPlaces"
                    :key="place.dbKey"
                    class="pn-panel space-y-2 p-4"
                    :data-testid="`odoo-overview-syncs-${place.dbKey}`"
                >
                    <p class="font-medium">{{ place.name }}</p>
                    <OdooSyncsCard
                        :db-key="place.dbKey"
                        :space-mode="place.dbKey.startsWith('space:')"
                        :overview-link="false"
                    />
                </div>
            </section>
        </template>
    </div>
</template>

<script setup>
/**
 * The Odoo overview page (docs/specs/proposed/odoo-overview.md): every Document with
 * a record in Odoo, across My Notes and the caller's spaces, opened on what needs
 * attention; Send updates for several at once; and every sync. Rendered by core's
 * AddonPage at #/addons/odoo/overview, which passes the route query.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { RefreshCw, Send, Settings } from 'lucide-vue-next'
import BaseButton from '@/components/BaseButton.vue'
import OdooSyncsCard from '@/addons/odoo/components/OdooSyncsCard.vue'
import { useOdooStore } from '@/addons/odoo/store'
import { odooHost, sentAgo } from '@/addons/odoo/utils/connection'
import { useViewport } from '@/composables/useViewport'
import { useEditorStore } from '@/store/editorStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'

const props = defineProps({
    query: { type: Object, default: () => ({}) },
})

const TABS = [{ id: 'attention', label: 'Needs attention' }, { id: 'all', label: 'All' }]
const ATTENTION = ['sync_failed', 'sync_paused', 'changed']
const STATE_TEXT = {
    changed: 'Changed since sent',
    current: 'Up to date',
    synced: 'Kept in sync',
    sync_failed: 'Sync failed',
    sync_paused: 'Sync paused',
    deleted: 'Deleted in Panino',
    other_odoo: 'In another Odoo',
}
const MAX_PER_PRESS = 25
const SYNC_WAIT_MS = 10000

const router = useRouter()
const odoo = useOdooStore()
const syncStore = useSyncStore()
const editorStore = useEditorStore()
const ui = useUiStore()
const { isPhone } = useViewport()

const data = ref(null)
const loading = ref(false)
const error = ref('')
const tab = ref('attention')
const where = ref(typeof props.query?.where === 'string' ? props.query.where : 'all')
const search = ref('')
const selected = ref(new Set())
const sending = ref(false)
/** Per row: `{ sending }` while it sends; afterwards only a failure stays, as `{ text }`. */
const rowStatus = reactive({})

const host = computed(() => odooHost(data.value?.odooHost || odoo.status?.baseUrl))
const keyOf = (doc) => `${doc.dbKey}|${doc.noteId}`

const inPlace = computed(() => (data.value?.documents || [])
    .filter((doc) => where.value === 'all' || doc.dbKey === where.value)
    .map((doc) => ({ ...doc, key: keyOf(doc) })))
const counts = computed(() => ({
    attention: inPlace.value.filter((doc) => ATTENTION.includes(doc.state)).length,
    all: inPlace.value.length,
}))
const rows = computed(() => {
    const term = search.value.trim().toLowerCase()
    return inPlace.value
        .filter((doc) => tab.value === 'all' || ATTENTION.includes(doc.state))
        .filter((doc) => !term || String(doc.title || '').toLowerCase().includes(term))
})
const selectedRows = computed(() => inPlace.value.filter((doc) => selected.value.has(doc.key)))
const syncPlaces = computed(() => {
    const withSyncs = new Set((data.value?.syncs || []).map((sync) => sync.dbKey))
    return (data.value?.places || [])
        .filter((place) => withSyncs.has(place.dbKey))
        .filter((place) => where.value === 'all' || place.dbKey === where.value)
})

function stateLine(doc) {
    const parts = [STATE_TEXT[doc.state] || '']
    if (doc.state === 'sync_failed' && doc.failure?.message) parts[0] += `: ${doc.failure.message}`
    if (doc.lastSentAt) {
        const by = doc.lastSentByMe ? 'by you' : (doc.lastSentBy ? `by ${doc.lastSentBy}` : '')
        parts.push(`sent ${sentAgo(doc.lastSentAt)}${by ? ` ${by}` : ''}`)
    }
    return parts.join(' · ')
}

function toggle(doc) {
    const next = new Set(selected.value)
    if (next.has(doc.key)) next.delete(doc.key)
    else next.add(doc.key)
    selected.value = next
}

function openDocument(doc) {
    router.push({ name: 'doc', params: { fileId: doc.noteId }, query: { dbKey: doc.dbKey } })
}

async function load() {
    loading.value = true
    error.value = ''
    try {
        await odoo.fetchStatus()
        if (odoo.isConnected) data.value = await odoo.fetchOverview()
        if (where.value !== 'all' && !(data.value?.places || []).some((place) => place.dbKey === where.value)) where.value = 'all'
    } catch (err) {
        error.value = err.message
    } finally {
        loading.value = false
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The server renders what it holds, so this browser's edits go up first: save the
 * open editor, sync the database, and wait (up to 10 seconds) for it to finish.
 */
async function syncFirst(dbKey) {
    await editorStore.flushPendingSave?.()
    await syncStore.sync(dbKey)
    const entry = () => syncStore.databases?.get?.(dbKey)
    const started = Date.now()
    while ((syncStore.isSyncing || entry()?.syncPending) && Date.now() - started < SYNC_WAIT_MS) await sleep(200)
    return !syncStore.isSyncing && !entry()?.syncPending && entry()?.status !== 'sync-error'
}

async function sendUpdates(docs) {
    const batch = docs.filter((doc) => doc.canSend).slice(0, MAX_PER_PRESS)
    if (!batch.length || sending.value) return
    sending.value = true
    error.value = ''
    const byDb = new Map()
    for (const doc of batch) {
        if (!byDb.has(doc.dbKey)) byDb.set(doc.dbKey, [])
        byDb.get(doc.dbKey).push(doc)
    }
    let ok = 0
    let failed = 0
    try {
        for (const [dbKey, docs] of byDb) {
            if (!(await syncFirst(dbKey))) {
                error.value = "Your latest changes haven't reached the server yet, so nothing was sent. Try again in a moment."
                return
            }
            for (const doc of docs) rowStatus[doc.key] = { sending: true }
            let results = {}
            try {
                results = (await odoo.resend(dbKey, docs.map((doc) => doc.noteId)))?.results || {}
            } catch (err) {
                for (const doc of docs) results[doc.noteId] = { ok: false, message: err.message }
            }
            for (const doc of docs) {
                const result = results[doc.noteId] || { ok: false, message: 'Odoo did not answer.' }
                if (result.ok) ok += 1
                else failed += 1
                if (result.ok) delete rowStatus[doc.key]
                else rowStatus[doc.key] = { text: result.message || 'Not sent.' }
            }
        }
    } finally {
        sending.value = false
        const total = ok + failed
        if (total) ui.addToast(`Sent ${ok} of ${total}.${failed ? ` ${failed} failed.` : ''}`, failed ? 'warning' : 'success')
        const sent = new Set(batch.filter((doc) => !rowStatus[doc.key]).map((doc) => doc.key))
        selected.value = new Set([...selected.value].filter((key) => !sent.has(key)))
        if (total) await load()
    }
}

onMounted(load)
</script>
