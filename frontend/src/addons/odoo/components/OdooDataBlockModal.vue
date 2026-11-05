<template>
    <BaseModal
        :show="show"
        :title="title"
        :size="view === 'choose' && !isTable ? 'lg' : 'md'"
        :close-on-backdrop="!busy"
        close-testid="odoo-data-close"
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
                    data-testid="odoo-data-not-connected"
                >Connect your Odoo in Settings first. Sales orders are read with your own Odoo user.</p>
                <BaseButton
                    variant="primary"
                    size="md"
                    @click="openSettings"
                >
                    <Settings class="h-4 w-4" />
                    <span>Open Settings</span>
                </BaseButton>
            </template>

            <div
                v-else-if="!hasSales"
                class="pn-alert pn-alert-info"
                data-testid="odoo-data-no-sales"
            >Odoo Sales isn't available to your Odoo user, so there are no sales orders to show.</div>

            <template v-else>
                <div
                    v-if="!editorReady"
                    class="pn-alert pn-alert-info"
                    data-testid="odoo-data-no-editor"
                >
                    <span>Show the editor to insert or refresh sales orders.</span>
                    <button
                        v-if="!ui.showEditor"
                        type="button"
                        class="ml-1 font-medium underline underline-offset-2"
                        @click="ui.toggleEditor()"
                    >Show the editor</button>
                </div>

                <div
                    v-if="error"
                    class="pn-alert pn-alert-error"
                    role="alert"
                    data-testid="odoo-data-error"
                >{{ error }}</div>

                <!-- The blocks already in this Document. -->
                <template v-if="view === 'list'">
                    <p
                        v-if="!blocks.length"
                        class="pn-body"
                    >This Document has no sales orders from Odoo yet.</p>
                    <ul
                        v-else
                        class="divide-y divide-gray-200 rounded-md border border-gray-200"
                        data-testid="odoo-data-blocks"
                    >
                        <li
                            v-for="(block, index) in blocks"
                            :key="block.start"
                            class="flex flex-wrap items-center gap-2 px-3 py-2"
                            :data-testid="`odoo-data-block-${index}`"
                        >
                            <div class="min-w-0 flex-1">
                                <div class="pn-title-section truncate">{{ block.config?.ref || 'Sales order' }}</div>
                                <div
                                    class="pn-help"
                                    :class="{ 'text-red-600': outcomes[block.start] && !outcomes[block.start].ok }"
                                >{{ blockNote(block) }}</div>
                            </div>
                            <template v-if="usable(block)">
                                <BaseButton
                                    size="sm"
                                    :disabled="busy || !canWrite"
                                    :data-testid="`odoo-data-edit-${index}`"
                                    @click="startEdit(block)"
                                >
                                    <SlidersHorizontal class="h-4 w-4" />
                                    <span>Edit</span>
                                </BaseButton>
                                <BaseButton
                                    variant="secondary"
                                    size="sm"
                                    :disabled="busy || !canWrite"
                                    :data-testid="`odoo-data-refresh-${index}`"
                                    @click="refreshOne(block)"
                                >
                                    <RefreshCw
                                        class="h-4 w-4"
                                        :class="{ 'animate-spin': refreshing === block.start }"
                                    />
                                    <span>Refresh</span>
                                </BaseButton>
                            </template>
                        </li>
                    </ul>
                </template>

                <!-- Choosing the order to insert. -->
                <template v-else-if="view === 'pick'">
                    <label
                        class="pn-label"
                        for="odoo-order-search"
                    >Sales order</label>
                    <input
                        id="odoo-order-search"
                        v-model="orderQuery"
                        class="pn-input"
                        type="search"
                        placeholder="Search by reference or customer"
                        autocomplete="off"
                        data-testid="odoo-data-order-search"
                    >
                    <ul
                        class="max-h-64 overflow-y-auto rounded-md border border-gray-200"
                        role="listbox"
                        aria-label="Sales orders"
                        data-testid="odoo-data-order-list"
                    >
                        <li
                            v-for="order in orders"
                            :key="order.id"
                            role="option"
                            :aria-selected="false"
                        >
                            <button
                                type="button"
                                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50"
                                :data-testid="`odoo-data-order-${order.id}`"
                                @click="pickOrder(order)"
                            >
                                <span class="min-w-0 truncate">
                                    <span class="font-medium">{{ order.name }}</span>
                                    <span
                                        v-if="order.partnerName"
                                        class="pn-help"
                                    > · {{ order.partnerName }}</span>
                                </span>
                                <span
                                    v-if="order.status"
                                    class="pn-help shrink-0"
                                >{{ order.status }}</span>
                            </button>
                        </li>
                        <li
                            v-if="!orders.length && !loadingOrders"
                            class="px-3 py-2 pn-help"
                        >No sales orders match.</li>
                    </ul>
                </template>

                <!-- Choosing the values and columns. -->
                <template v-else-if="view === 'choose'">
                    <div class="flex items-center justify-between gap-2">
                        <p
                            class="pn-body"
                            data-testid="odoo-data-chosen-order"
                        ><span class="font-medium">{{ chosenOrder.name }}</span><span v-if="chosenOrder.partnerName"> · {{ chosenOrder.partnerName }}</span></p>
                        <button
                            v-if="!editing"
                            type="button"
                            class="pn-help underline underline-offset-2"
                            @click="view = 'pick'"
                        >Change</button>
                    </div>

                    <div class="space-y-1">
                        <label
                            class="pn-label"
                            for="odoo-data-layout"
                        >Layout</label>
                        <select
                            id="odoo-data-layout"
                            class="pn-input"
                            :value="layoutChoice"
                            data-testid="odoo-data-layout"
                            @change="selectLayout($event.target.value)"
                        >
                            <option value="table">Table: choose values and columns</option>
                            <option
                                v-if="editing?.config?.layout !== undefined"
                                value="block"
                            >This block's layout</option>
                            <option
                                v-if="layoutChoice === 'custom'"
                                value="custom"
                            >Unsaved layout</option>
                            <optgroup label="Starters">
                                <option
                                    v-for="layout in BUILT_IN_LAYOUTS"
                                    :key="layout.id"
                                    :value="layout.id"
                                >{{ layout.name }}</option>
                            </optgroup>
                            <optgroup
                                v-if="layouts.length"
                                label="Your layouts"
                            >
                                <option
                                    v-for="layout in layouts"
                                    :key="layout.id"
                                    :value="layout.id"
                                >{{ layout.name }}</option>
                            </optgroup>
                        </select>
                    </div>

                    <template v-if="isTable">
                        <section
                            v-for="part in parts"
                            :key="part.key"
                            class="pn-panel p-4 space-y-2"
                            :data-testid="`odoo-data-${part.key}`"
                        >
                            <div class="flex items-center justify-between gap-2">
                                <h3 class="pn-title-section">{{ part.title }}</h3>
                                <button
                                    type="button"
                                    class="pn-help underline underline-offset-2"
                                    :data-testid="`odoo-data-${part.key}-defaults`"
                                    @click="useDefaults(part.key)"
                                >Use defaults</button>
                            </div>
                            <p class="pn-help">{{ part.help }}</p>
                            <ol class="space-y-1">
                                <li
                                    v-for="(name, index) in choice[part.key]"
                                    :key="name"
                                    class="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-sm"
                                    :data-testid="`odoo-data-${part.key}-item`"
                                >
                                    <span class="min-w-0 flex-1 truncate">{{ labelOf(part.key, name) }}</span>
                                    <BaseButton
                                        size="sm"
                                        :disabled="index === 0"
                                        :aria-label="`Move ${labelOf(part.key, name)} up`"
                                        @click="move(part.key, index, -1)"
                                    ><ArrowUp class="h-4 w-4" /></BaseButton>
                                    <BaseButton
                                        size="sm"
                                        :disabled="index === choice[part.key].length - 1"
                                        :aria-label="`Move ${labelOf(part.key, name)} down`"
                                        @click="move(part.key, index, 1)"
                                    ><ArrowDown class="h-4 w-4" /></BaseButton>
                                    <BaseButton
                                        size="sm"
                                        :aria-label="`Remove ${labelOf(part.key, name)}`"
                                        @click="remove(part.key, index)"
                                    ><X class="h-4 w-4" /></BaseButton>
                                </li>
                                <li
                                    v-if="!choice[part.key].length"
                                    class="pn-help"
                                >{{ part.empty }}</li>
                            </ol>
                            <select
                                class="pn-input"
                                :aria-label="`Add to ${part.title.toLowerCase()}`"
                                :data-testid="`odoo-data-${part.key}-add`"
                                :disabled="choice[part.key].length >= MAX_FIELDS"
                                @change="add(part.key, $event)"
                            >
                                <option value="">Add…</option>
                                <option
                                    v-for="field in available(part.key)"
                                    :key="field.name"
                                    :value="field.name"
                                >{{ field.label }}</option>
                            </select>
                        </section>
                        <button
                            type="button"
                            class="pn-help underline underline-offset-2"
                            data-testid="odoo-data-edit-markdown"
                            @click="editAsMarkdown"
                        >Edit as Markdown, to change the layout itself</button>
                    </template>

                    <section
                        v-else
                        class="pn-panel p-4 space-y-2"
                        data-testid="odoo-data-layout-editor"
                    >
                        <textarea
                            ref="layoutArea"
                            v-model="layoutBody"
                            rows="14"
                            spellcheck="false"
                            class="pn-input font-mono text-xs"
                            aria-label="Layout"
                            data-testid="odoo-data-layout-body"
                        />
                        <div class="flex flex-wrap gap-2">
                            <select
                                class="pn-input min-w-0 flex-1"
                                aria-label="Insert an order value"
                                data-testid="odoo-data-insert-order"
                                @change="insertPlaceholder('order', $event)"
                            >
                                <option value="">Insert an order value…</option>
                                <option
                                    v-for="field in catalog?.order || []"
                                    :key="field.name"
                                    :value="field.name"
                                >{{ field.label }}</option>
                            </select>
                            <select
                                class="pn-input min-w-0 flex-1"
                                aria-label="Insert a line value"
                                data-testid="odoo-data-insert-line"
                                @change="insertPlaceholder('line', $event)"
                            >
                                <option value="">Insert a line value…</option>
                                <option
                                    v-for="field in catalog?.line || []"
                                    :key="field.name"
                                    :value="field.name"
                                >{{ field.label }}</option>
                            </select>
                        </div>
                        <p
                            v-pre
                            class="pn-help"
                        >Markdown, with {{order.…}} for the order's values. Between {{#lines}} and {{/lines}}, {{line.…}} repeats for each order line; {{#product}}, {{#section}} and {{#note}} give each kind of line its own text. {{odoo.updated}} and {{odoo.url}} say when it was read and where it is in Odoo.</p>
                        <div
                            v-if="!layoutCheck.ok"
                            class="pn-alert pn-alert-error"
                            role="alert"
                            data-testid="odoo-data-layout-error"
                        >{{ layoutCheck.error }}</div>
                        <div
                            v-else-if="unknownFields.length"
                            class="pn-alert pn-alert-info"
                            data-testid="odoo-data-layout-unknown"
                        >Your Odoo has no {{ unknownFields.join(', ') }}, so {{ unknownFields.length === 1 ? 'it stays' : 'they stay' }} empty.</div>
                        <div class="flex flex-wrap items-center gap-2">
                            <input
                                v-model="layoutName"
                                class="pn-input min-w-0 flex-1"
                                placeholder="Layout name"
                                aria-label="Layout name"
                                maxlength="80"
                                data-testid="odoo-data-layout-name"
                            >
                            <BaseButton
                                variant="secondary"
                                size="sm"
                                :disabled="savingLayout || !layoutCheck.ok || !layoutName.trim()"
                                data-testid="odoo-data-layout-save"
                                @click="storeLayout(false)"
                            >
                                <Save class="h-4 w-4" />
                                <span>{{ savedLayout ? 'Save changes' : 'Save layout' }}</span>
                            </BaseButton>
                            <BaseButton
                                v-if="savedLayout"
                                size="sm"
                                :disabled="savingLayout || !layoutCheck.ok || !layoutName.trim()"
                                data-testid="odoo-data-layout-save-new"
                                @click="storeLayout(true)"
                            >Save as new</BaseButton>
                            <BaseButton
                                v-if="savedLayout"
                                variant="danger"
                                size="sm"
                                :disabled="savingLayout"
                                data-testid="odoo-data-layout-delete"
                                @click="removeLayout"
                            >Delete</BaseButton>
                        </div>
                        <p
                            v-if="layoutMessage"
                            class="pn-help"
                            role="status"
                            data-testid="odoo-data-layout-message"
                        >{{ layoutMessage }}</p>
                    </section>
                </template>
            </template>
        </div>

        <template
            v-if="odoo.isConnected && hasSales && !loading"
            #footer
        >
            <template v-if="view === 'list'">
                <BaseButton
                    v-if="blocks.some(usable)"
                    variant="secondary"
                    size="md"
                    :disabled="busy || !canWrite"
                    data-testid="odoo-data-refresh-all"
                    @click="refreshAll"
                >
                    <RefreshCw class="h-4 w-4" />
                    <span>Refresh all</span>
                </BaseButton>
                <BaseButton
                    variant="primary"
                    size="md"
                    :disabled="busy || !canWrite"
                    data-testid="odoo-data-insert-start"
                    @click="startInsert"
                >
                    <Plus class="h-4 w-4" />
                    <span>Insert a sales order</span>
                </BaseButton>
            </template>
            <template v-else>
                <BaseButton
                    variant="secondary"
                    size="md"
                    :disabled="busy"
                    @click="back"
                >Back</BaseButton>
                <BaseButton
                    v-if="view === 'choose'"
                    variant="primary"
                    size="md"
                    :disabled="busy || !canWrite || !catalog || !layoutCheck.ok"
                    data-testid="odoo-data-submit"
                    @click="submit"
                >
                    <span>{{ busy ? 'Reading from Odoo…' : (editing ? 'Update' : 'Insert') }}</span>
                </BaseButton>
            </template>
        </template>
    </BaseModal>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ArrowDown, ArrowUp, Plus, RefreshCw, Save, Settings, SlidersHorizontal, X } from 'lucide-vue-next'
import BaseModal from '@/components/BaseModal.vue'
import BaseButton from '@/components/BaseButton.vue'
import { useDocStore } from '@/store/docStore'
import { useDraftStore } from '@/store/draftStore'
import { useEditorStore } from '@/store/editorStore'
import { useOdooStore } from '@/addons/odoo/store'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'
import { buildBlockMarkdown, findBlocks, insertBlock, replaceBlock } from '@/addons/odoo/utils/saleOrderBlock'
import { BUILT_IN_LAYOUTS, layoutFields, parseLayout, tableLayout } from '@/addons/odoo/utils/saleOrderLayout'

/**
 * Sales orders from Odoo in the current Document
 * (docs/specs/active/odoo-sales-order-blocks.md): list, refresh and edit the
 * blocks it holds, or insert a new one. Every change goes through the editor,
 * so it is undoable and saved like typing. A block is either a table of chosen
 * values and columns, or drawn from a Markdown layout (a starter, one of the
 * person's saved layouts, or one written here).
 */

const MAX_FIELDS = 30

const props = defineProps({
    show: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

const router = useRouter()
const docStore = useDocStore()
const draftStore = useDraftStore()
const editorStore = useEditorStore()
const odoo = useOdooStore()
const syncStore = useSyncStore()
const ui = useUiStore()
const { selectedFile: file } = storeToRefs(docStore)

const loading = ref(false)
const error = ref('')
const view = ref('list')
const busy = ref(false)
const refreshing = ref(null)
const outcomes = ref({})
const orders = ref([])
const orderQuery = ref('')
const loadingOrders = ref(false)
const catalog = ref(null)
const chosenOrder = ref(null)
const editing = ref(null)
const choice = reactive({ fields: [], columns: [] })
const layouts = ref([])
const layoutChoice = ref('table')
const layoutBody = ref('')
const layoutName = ref('')
const layoutArea = ref(null)
const savingLayout = ref(false)
const layoutMessage = ref('')

const parts = [
    { key: 'fields', title: 'Values', help: 'Shown from the order, one per row, under its reference.', empty: 'Only the reference is shown.' },
    { key: 'columns', title: 'Line columns', help: 'Shown for each order line, left to right.', empty: 'The lines are not shown.' },
]

const hasSales = computed(() => (odoo.status?.apps || []).includes('sales'))
const editorReady = computed(() => editorStore.isEditorAvailable)
const canWrite = computed(() => syncStore.isOnline && editorReady.value && Boolean(file.value))
const text = computed(() => (file.value ? (draftStore.getDraft(file.value.id) ?? file.value.content ?? '') : ''))
const blocks = computed(() => findBlocks(text.value))
const title = computed(() => {
    if (view.value === 'pick') return 'Insert a sales order'
    if (view.value === 'choose') return editing.value ? 'Edit a sales order' : 'Insert a sales order'
    return 'Sales orders from Odoo'
})

const isTable = computed(() => layoutChoice.value === 'table')
const savedLayout = computed(() => layouts.value.find((layout) => layout.id === layoutChoice.value) || null)
const layoutCheck = computed(() => (isTable.value ? { ok: true } : parseLayout(layoutBody.value)))
const unknownFields = computed(() => {
    if (isTable.value || !catalog.value || !layoutCheck.value.ok) return []
    const { fields, columns } = layoutFields(layoutBody.value)
    const known = (key, name) => catalog.value[key].some((field) => field.name === name)
    return [
        ...fields.filter((name) => !known('order', name)).map((name) => `order.${name}`),
        ...columns.filter((name) => !known('line', name)).map((name) => `line.${name}`),
    ]
})

const catalogKey = (key) => (key === 'fields' ? 'order' : 'line')
const usable = (block) => Boolean(block.config && block.closed)
const timeNow = () => new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date())

function blockNote(block) {
    const outcome = outcomes.value[block.start]
    if (outcome) return outcome.message
    if (!block.config) return "This block's settings are damaged, so it can't be refreshed."
    if (!block.closed) return 'The end of this block is missing, so it can\'t be refreshed.'
    if (block.config.layout !== undefined) return 'Markdown layout'
    const count = block.config.columns.length
    return `${block.config.fields.length} values · ${count ? `${count} line columns` : 'no lines'}`
}

function labelOf(key, name) {
    return catalog.value?.[catalogKey(key)].find((field) => field.name === name)?.label || name
}

function available(key) {
    const chosen = new Set(choice[key])
    return (catalog.value?.[catalogKey(key)] || []).filter((field) => !chosen.has(field.name))
}

function move(key, index, step) {
    const list = choice[key]
    const target = index + step
    if (target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]
}

function remove(key, index) {
    choice[key].splice(index, 1)
}

function add(key, event) {
    const name = event.target.value
    event.target.value = ''
    if (name && !choice[key].includes(name) && choice[key].length < MAX_FIELDS) choice[key].push(name)
}

function useDefaults(key) {
    choice[key] = [...(catalog.value?.defaults?.[key] || [])]
}

function selectLayout(value) {
    layoutChoice.value = value
    layoutMessage.value = ''
    if (value === 'table' || value === 'custom') return
    if (value === 'block') {
        layoutBody.value = editing.value?.config?.layout || ''
        layoutName.value = ''
        return
    }
    const found = BUILT_IN_LAYOUTS.find((layout) => layout.id === value) || layouts.value.find((layout) => layout.id === value)
    layoutBody.value = found?.body || ''
    layoutName.value = savedLayout.value?.name || ''
}

/** Turn the table choice into the same layout as Markdown, to edit freely. */
function editAsMarkdown() {
    const describe = (scope, name) => catalog.value?.[scope].find((field) => field.name === name) || { label: name }
    layoutBody.value = tableLayout(choice.fields, choice.columns, describe)
    layoutName.value = ''
    layoutChoice.value = 'custom'
}

async function insertPlaceholder(scope, event) {
    const name = event.target.value
    event.target.value = ''
    if (!name) return
    const tag = `{{${scope}.${name}}}`
    const area = layoutArea.value
    const start = area?.selectionStart ?? layoutBody.value.length
    const end = area?.selectionEnd ?? start
    layoutBody.value = `${layoutBody.value.slice(0, start)}${tag}${layoutBody.value.slice(end)}`
    await nextTick()
    area?.focus()
    area?.setSelectionRange(start + tag.length, start + tag.length)
}

async function storeLayout(asNew) {
    if (!layoutCheck.value.ok) return
    savingLayout.value = true
    layoutMessage.value = ''
    error.value = ''
    try {
        const saved = await odoo.saveLayout({ id: asNew ? undefined : savedLayout.value?.id, name: layoutName.value, body: layoutBody.value })
        layouts.value = await odoo.fetchLayouts()
        layoutChoice.value = saved.id
        layoutName.value = saved.name
        layoutMessage.value = `Saved “${saved.name}”.`
    } catch (err) {
        error.value = err.message
    } finally {
        savingLayout.value = false
    }
}

/** Delete the saved layout; its text stays in the editor, so it can be saved again. */
async function removeLayout() {
    const target = savedLayout.value
    if (!target) return
    savingLayout.value = true
    error.value = ''
    try {
        await odoo.deleteLayout(target.id)
        layouts.value = await odoo.fetchLayouts()
        layoutChoice.value = 'custom'
        layoutName.value = ''
        layoutMessage.value = `Deleted “${target.name}”. Its text is still here.`
    } catch (err) {
        error.value = err.message
    } finally {
        savingLayout.value = false
    }
}

async function loadCatalog() {
    if (catalog.value) return true
    try {
        const [fields, saved] = await Promise.all([odoo.fetchSaleOrderFields(), odoo.fetchLayouts()])
        catalog.value = fields
        layouts.value = saved
        return true
    } catch (err) {
        error.value = err.message
        return false
    }
}

async function loadOrders() {
    loadingOrders.value = true
    try {
        orders.value = await odoo.searchSaleOrders(orderQuery.value.trim())
    } catch (err) {
        error.value = err.message
    } finally {
        loadingOrders.value = false
    }
}

let orderTimer = null
watch(orderQuery, () => {
    clearTimeout(orderTimer)
    orderTimer = setTimeout(loadOrders, 250)
})

async function startInsert() {
    error.value = ''
    editing.value = null
    view.value = 'pick'
    if (!orders.value.length) await loadOrders()
}

async function pickOrder(order) {
    error.value = ''
    if (!(await loadCatalog())) return
    chosenOrder.value = order
    if (!choice.fields.length && !choice.columns.length) {
        useDefaults('fields')
        useDefaults('columns')
    }
    view.value = 'choose'
}

async function startEdit(block) {
    error.value = ''
    if (!(await loadCatalog())) return
    const known = (key, names) => names.filter((name) => catalog.value[catalogKey(key)].some((field) => field.name === name))
    editing.value = block
    chosenOrder.value = { id: block.config.id, name: block.config.ref }
    layoutMessage.value = ''
    if (block.config.layout !== undefined) {
        selectLayout('block')
    } else {
        layoutChoice.value = 'table'
        choice.fields = known('fields', block.config.fields)
        choice.columns = known('columns', block.config.columns)
    }
    view.value = 'choose'
}

function back() {
    error.value = ''
    if (view.value === 'choose' && !editing.value) {
        view.value = 'pick'
        return
    }
    editing.value = null
    view.value = 'list'
}

/** Read an order and build its block; checks it is still the order the block showed. */
async function blockFor(orderId, choiceOf, expectedRef, layout) {
    const snapshot = await odoo.fetchSaleOrder(orderId, choiceOf)
    if (expectedRef && snapshot.order.name !== expectedRef) {
        const reason = new Error(`Order ${orderId} in your Odoo is ${snapshot.order.name || 'another order'}, not ${expectedRef}. This block may come from another Odoo, so it was left as it is.`)
        reason.code = 'other_order'
        throw reason
    }
    return buildBlockMarkdown(snapshot, { layout })
}

/** Replace a block in the editor; false when it was edited or removed meanwhile. */
function writeBlock(block, markdown) {
    let replaced = false
    editorStore.transformText((state) => {
        const next = replaceBlock(state, block, markdown)
        replaced = Boolean(next)
        return next || state
    }, { focus: false })
    return replaced
}

async function refreshBlock(block) {
    refreshing.value = block.start
    try {
        const markdown = await blockFor(block.config.id, block.config, block.config.ref, block.config.layout)
        const ok = writeBlock(block, markdown)
        return ok
            ? { ok: true, message: `Updated at ${timeNow()}.` }
            : { ok: false, message: 'This block changed while it was being read. Try again.' }
    } catch (err) {
        return { ok: false, message: err.message }
    } finally {
        refreshing.value = null
    }
}

async function refreshOne(block) {
    busy.value = true
    error.value = ''
    const outcome = await refreshBlock(block)
    // Offsets move with the new text; key the outcome by the block's new start.
    const now = findBlocks(text.value).find((candidate) => candidate.config?.id === block.config.id)
    outcomes.value = { [now?.start ?? block.start]: outcome }
    busy.value = false
}

async function refreshAll() {
    busy.value = true
    error.value = ''
    const results = []
    for (const block of blocks.value.filter(usable)) {
        results.push({ id: block.config.id, outcome: await refreshBlock(block) })
    }
    const next = {}
    for (const block of findBlocks(text.value)) {
        const found = results.find((result) => result.id === block.config?.id)
        if (found) next[block.start] = found.outcome
    }
    outcomes.value = next
    const failed = results.filter((result) => !result.outcome.ok).length
    if (failed) error.value = failed === 1 ? 'One sales order could not be refreshed.' : `${failed} sales orders could not be refreshed.`
    busy.value = false
}

async function submit() {
    if (!chosenOrder.value || !canWrite.value) return
    busy.value = true
    error.value = ''
    try {
        const layout = isTable.value ? undefined : layoutBody.value
        const picked = layout === undefined ? { fields: [...choice.fields], columns: [...choice.columns] } : layoutFields(layout)
        if (editing.value) {
            const markdown = await blockFor(chosenOrder.value.id, picked, editing.value.config.ref, layout)
            if (!writeBlock(editing.value, markdown)) {
                error.value = 'This block changed while it was being read. Try again.'
                return
            }
        } else {
            const markdown = await blockFor(chosenOrder.value.id, picked, undefined, layout)
            editorStore.transformText((state) => insertBlock(state, markdown), { focus: false })
        }
        outcomes.value = {}
        editing.value = null
        view.value = 'list'
    } catch (err) {
        error.value = err.message
    } finally {
        busy.value = false
    }
}

function openSettings() {
    emit('close')
    router.push('/settings')
}

watch(() => props.show, async (open) => {
    if (!open) return
    loading.value = true
    error.value = ''
    outcomes.value = {}
    editing.value = null
    chosenOrder.value = null
    orderQuery.value = ''
    orders.value = []
    choice.fields = []
    choice.columns = []
    layoutChoice.value = 'table'
    layoutBody.value = ''
    layoutName.value = ''
    layoutMessage.value = ''
    view.value = 'list'
    try {
        await odoo.fetchStatus()
        if (odoo.isConnected && hasSales.value && !blocks.value.length) await startInsert()
    } finally {
        loading.value = false
    }
}, { immediate: true })
</script>
