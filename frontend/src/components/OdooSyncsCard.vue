<template>
    <section
        class="space-y-3"
        data-testid="odoo-syncs"
    >
        <h3 class="pn-title-section">{{ spaceMode ? 'Sync to Odoo Knowledge' : 'Kept in sync with Knowledge' }}</h3>

        <p
            v-if="!odoo.isConnected"
            class="pn-help"
            data-testid="odoo-syncs-not-connected"
        >Connect your Odoo to keep folders in sync with Knowledge.</p>
        <p
            v-else-if="!hasKnowledge"
            class="pn-help"
            data-testid="odoo-syncs-no-knowledge"
        >This Odoo has no Knowledge app your Odoo user can use.</p>

        <template v-else>
            <div
                v-if="error"
                class="pn-alert pn-alert-error"
                role="alert"
                data-testid="odoo-syncs-error"
            >{{ error }}</div>

            <p
                v-if="loaded && !syncs.length"
                class="pn-help"
                data-testid="odoo-syncs-empty"
            >Nothing is kept in sync yet. A synced folder mirrors its Documents and subfolders into Knowledge, under the article you choose, a few minutes after each change.</p>

            <ul
                v-if="syncs.length"
                class="divide-y divide-gray-200 rounded-md border border-gray-200"
                data-testid="odoo-syncs-list"
            >
                <li
                    v-for="sync in syncs"
                    :key="sync.id"
                    class="p-3 space-y-2"
                    :data-testid="`odoo-sync-${sync.id}`"
                >
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="min-w-0">
                            <p class="font-medium truncate">
                                <template v-if="sync.scope === 'space'">Whole space</template>
                                <template v-else><span class="pn-help">{{ sync.scope === 'folder' ? 'Folder' : 'Document' }} · </span>{{ sync.sourceName || 'Removed' }}</template>
                            </p>
                            <p
                                class="pn-help"
                                :data-testid="`odoo-sync-status-${sync.id}`"
                            >{{ statusLine(sync) }}</p>
                            <p
                                v-if="spaceMode"
                                class="pn-help"
                                :data-testid="`odoo-sync-runner-${sync.id}`"
                            >Syncing as {{ sync.runAs === authStore.user?.id ? 'you' : (sync.runAsName || 'a member') }}, with their Odoo user.</p>
                        </div>
                        <div class="flex items-center gap-2">
                            <BaseButton
                                v-if="spaceMode && sync.runAs !== authStore.user?.id"
                                variant="secondary"
                                size="sm"
                                :disabled="busy === sync.id"
                                :data-testid="`odoo-sync-take-over-${sync.id}`"
                                @click="takeOver(sync)"
                            >Take over</BaseButton>
                            <BaseButton
                                variant="secondary"
                                size="sm"
                                :disabled="sync.running || sync.status !== 'active' || busy === sync.id"
                                :data-testid="`odoo-sync-run-${sync.id}`"
                                @click="runNow(sync)"
                            >{{ sync.running || busy === sync.id ? 'Syncing…' : 'Sync now' }}</BaseButton>
                            <BaseButton
                                variant="ghost"
                                size="sm"
                                :data-testid="`odoo-sync-remove-${sync.id}`"
                                @click="removing = removing === sync.id ? null : sync.id"
                            >Remove</BaseButton>
                        </div>
                    </div>
                    <p
                        v-if="failuresOf(sync).length"
                        class="pn-help text-red-700"
                        :data-testid="`odoo-sync-failures-${sync.id}`"
                    >{{ failuresOf(sync).length }} {{ failuresOf(sync).length === 1 ? 'record' : 'records' }} could not be written and will be retried: {{ failuresOf(sync).map((f) => f.name).slice(0, 3).join(', ') }}<span v-if="failuresOf(sync).length > 3">, …</span></p>
                    <div
                        v-if="removing === sync.id"
                        class="pn-alert pn-alert-warning flex flex-wrap items-center justify-between gap-2"
                        :data-testid="`odoo-sync-confirm-${sync.id}`"
                    >
                        <span>Stop keeping this in sync? The articles stay in Odoo as they are.</span>
                        <div class="flex gap-2">
                            <BaseButton
                                variant="secondary"
                                size="sm"
                                @click="removing = null"
                            >Keep</BaseButton>
                            <BaseButton
                                variant="danger"
                                size="sm"
                                :data-testid="`odoo-sync-remove-confirm-${sync.id}`"
                                @click="remove(sync)"
                            >Remove sync</BaseButton>
                        </div>
                    </div>
                </li>
            </ul>

            <div
                v-if="!adding"
                class="flex flex-wrap gap-2"
            >
                <BaseButton
                    variant="secondary"
                    size="sm"
                    data-testid="odoo-syncs-add"
                    @click="startAdding"
                >
                    <Plus class="h-4 w-4" />
                    <span>Add sync</span>
                </BaseButton>
                <BaseButton
                    v-if="syncs.length"
                    variant="ghost"
                    size="sm"
                    data-testid="odoo-syncs-refresh"
                    @click="load"
                >Refresh</BaseButton>
            </div>

            <form
                v-else
                class="pn-panel p-4 space-y-3"
                data-testid="odoo-syncs-form"
                @submit.prevent="create"
            >
                <div class="space-y-1">
                    <label
                        class="pn-label"
                        for="odoo-sync-folder"
                    >{{ spaceMode ? 'What' : 'Folder' }}</label>
                    <select
                        id="odoo-sync-folder"
                        v-model="folderId"
                        class="pn-select w-full"
                        data-testid="odoo-sync-folder"
                    >
                        <option
                            value=""
                            disabled
                        >{{ spaceMode ? 'Choose the whole space or a folder' : 'Choose a folder' }}</option>
                        <option
                            v-if="spaceMode"
                            value="__space__"
                        >The whole space</option>
                        <option
                            v-for="folder in folders"
                            :key="folder.id"
                            :value="folder.id"
                        >{{ folder.path }}</option>
                    </select>
                    <p
                        v-if="loadedFolders && !folders.length && !spaceMode"
                        class="pn-help"
                    >You have no folders yet. Use "Keep in sync" in the Send to Odoo sheet for a single Document.</p>
                </div>

                <div class="space-y-1">
                    <label
                        class="pn-label"
                        for="odoo-sync-parent-search"
                    >Under</label>
                    <input
                        id="odoo-sync-parent-search"
                        v-model="articleQuery"
                        class="pn-input"
                        type="search"
                        placeholder="Search articles"
                        autocomplete="off"
                        data-testid="odoo-sync-parent-search"
                    >
                    <ul
                        class="max-h-40 overflow-y-auto rounded-md border border-gray-200"
                        role="listbox"
                        aria-label="Knowledge articles"
                        data-testid="odoo-sync-parent-list"
                    >
                        <li
                            role="option"
                            :aria-selected="parentId === 0"
                        >
                            <button
                                type="button"
                                class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                                :class="{ 'bg-gray-100 font-medium': parentId === 0 }"
                                data-testid="odoo-sync-parent-top"
                                @click="parentId = 0"
                            >
                                <span>Top level</span>
                                <Check
                                    v-if="parentId === 0"
                                    class="h-4 w-4 shrink-0"
                                    aria-hidden="true"
                                />
                            </button>
                        </li>
                        <li
                            v-for="article in articles"
                            :key="article.id"
                            role="option"
                            :aria-selected="article.id === parentId"
                        >
                            <button
                                type="button"
                                class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                                :class="{ 'bg-gray-100 font-medium': article.id === parentId }"
                                :data-testid="`odoo-sync-parent-${article.id}`"
                                @click="parentId = article.id"
                            >
                                <span class="min-w-0 truncate">
                                    <span
                                        v-if="article.parentName"
                                        class="pn-help"
                                    >{{ article.parentName }} / </span>{{ article.name }}
                                </span>
                                <Check
                                    v-if="article.id === parentId"
                                    class="h-4 w-4 shrink-0"
                                    aria-hidden="true"
                                />
                            </button>
                        </li>
                    </ul>
                </div>

                <p class="pn-help">Colleagues can read the articles in Odoo but not edit them; the next sync would overwrite their changes. Syncing as {{ odoo.status.odooUserName || 'your Odoo user' }}<template v-if="spaceMode">, with your connection; another owner or editor can take over later</template>.</p>

                <div
                    v-if="formError"
                    class="pn-alert pn-alert-error"
                    role="alert"
                    data-testid="odoo-sync-form-error"
                >{{ formError }}</div>

                <div class="flex justify-end gap-2">
                    <BaseButton
                        variant="secondary"
                        size="sm"
                        type="button"
                        @click="adding = false"
                    >Cancel</BaseButton>
                    <BaseButton
                        variant="primary"
                        size="sm"
                        type="submit"
                        :disabled="!folderId || parentId === null || creating"
                        data-testid="odoo-sync-create"
                    >{{ creating ? 'Starting…' : 'Start syncing' }}</BaseButton>
                </div>
            </form>
        </template>
    </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Check, Plus } from 'lucide-vue-next'
import BaseButton from '@/components/BaseButton.vue'
import { useAuthStore } from '@/store/authStore'
import { useDocStore } from '@/store/docStore'
import { useOdooStore } from '@/store/odooStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { sentAgo } from '@/utils/odooConnection'

/**
 * The person's Knowledge syncs (docs/specs/active/odoo-integration.md §11):
 * what is kept in sync, how the last run went, Sync now, Remove, and Add sync
 * for a folder. Single Documents are added from the Send to Odoo sheet.
 */
const props = defineProps({
    /** The database whose syncs to show; the personal one by default. */
    dbKey: { type: String, default: '' },
    /** A shared space: offer the whole space, show who runs each sync, allow take-over. */
    spaceMode: { type: Boolean, default: false },
})

const authStore = useAuthStore()
const docStore = useDocStore()
const odoo = useOdooStore()
const syncStore = useSyncStore()
const ui = useUiStore()

const syncs = ref([])
const loaded = ref(false)
const error = ref('')
const busy = ref(null)
const removing = ref(null)
const adding = ref(false)
const creating = ref(false)
const formError = ref('')
const folders = ref([])
const loadedFolders = ref(false)
const folderId = ref('')
const articles = ref([])
const articleQuery = ref('')
const parentId = ref(null)

const dbKey = computed(() => props.dbKey || syncStore.personalDbKey)
const hasKnowledge = computed(() => Boolean(odoo.status?.apps?.includes('knowledge')))

const PAUSE_TEXT = {
    key_rejected: 'Paused: Odoo rejected the API key. Connect again with a new key.',
    not_connected: 'Paused: Odoo is not connected.',
    addon_disabled: 'Paused: the Odoo add-on is off.',
    left_space: 'Paused: the person running it left the space.',
    manual: 'Paused.',
}

function failuresOf(sync) {
    return Array.isArray(sync.lastResult?.failures) ? sync.lastResult.failures : []
}

function statusLine(sync) {
    if (sync.status === 'paused') return PAUSE_TEXT[sync.pausedReason] || 'Paused.'
    if (sync.running) return 'Syncing now…'
    if (!sync.lastRunAt) return 'First sync is on its way.'
    const r = sync.lastResult || {}
    const parts = []
    if (r.created) parts.push(`${r.created} created`)
    if (r.updated) parts.push(`${r.updated} updated`)
    if (r.archived) parts.push(`${r.archived} archived`)
    if (!parts.length) parts.push('nothing to change')
    return `Last sync ${sentAgo(sync.lastRunAt)}: ${parts.join(', ')}.`
}

async function load() {
    error.value = ''
    try {
        if (!odoo.status) await odoo.fetchStatus()
        if (odoo.isConnected && hasKnowledge.value && dbKey.value) syncs.value = await odoo.fetchSyncs(dbKey.value)
    } catch (err) {
        error.value = err.message
    } finally {
        loaded.value = true
    }
}

async function runNow(sync) {
    busy.value = sync.id
    error.value = ''
    try {
        const updated = await odoo.runSync(dbKey.value, sync.id)
        if (updated) syncs.value = syncs.value.map((s) => (s.id === updated.id ? updated : s))
        const failures = failuresOf(updated || sync).length
        ui.addToast?.(failures ? `Synced, ${failures} ${failures === 1 ? 'record' : 'records'} to retry.` : 'Synced to Odoo Knowledge.', failures ? 'warning' : 'success')
    } catch (err) {
        error.value = err.message
    } finally {
        busy.value = null
    }
}

async function takeOver(sync) {
    busy.value = sync.id
    error.value = ''
    try {
        const updated = await odoo.takeOverSync(dbKey.value, sync.id)
        if (updated) syncs.value = syncs.value.map((s) => (s.id === updated.id ? updated : s))
        ui.addToast?.('You run this sync now, with your Odoo user.', 'success')
    } catch (err) {
        error.value = err.message
    } finally {
        busy.value = null
    }
}

async function remove(sync) {
    error.value = ''
    try {
        await odoo.removeSync(dbKey.value, sync.id)
        syncs.value = syncs.value.filter((s) => s.id !== sync.id)
        removing.value = null
        ui.addToast?.('No longer kept in sync. The articles stay in Odoo.', 'info')
    } catch (err) {
        error.value = err.message
    }
}

async function startAdding() {
    adding.value = true
    formError.value = ''
    folderId.value = ''
    parentId.value = null
    articleQuery.value = ''
    try {
        folders.value = await docStore.listFolders(dbKey.value)
    } catch (err) {
        formError.value = err.message
    } finally {
        loadedFolders.value = true
    }
    void loadArticles()
}

async function loadArticles() {
    try {
        articles.value = await odoo.fetchArticles(articleQuery.value.trim())
    } catch (err) {
        formError.value = err.message
    }
}

let articleTimer = null
watch(articleQuery, () => {
    clearTimeout(articleTimer)
    articleTimer = setTimeout(loadArticles, 250)
})

async function create() {
    if (!folderId.value || parentId.value === null) return
    creating.value = true
    formError.value = ''
    try {
        const sync = folderId.value === '__space__'
            ? await odoo.createSync({ dbKey: dbKey.value, scope: 'space', parentArticleId: parentId.value })
            : await odoo.createSync({ dbKey: dbKey.value, scope: 'folder', sourceId: folderId.value, parentArticleId: parentId.value })
        if (sync) syncs.value = [...syncs.value, sync]
        adding.value = false
        ui.addToast?.(`Keeping the ${sync?.scope === 'space' ? 'space' : 'folder'} in sync with Odoo Knowledge. The first sync is on its way.`, 'success')
    } catch (err) {
        formError.value = err.message
    } finally {
        creating.value = false
    }
}

onMounted(load)
defineExpose({ load })
</script>
