<template>
    <div data-testid="tag-filter-results">
        <p
            class="pn-meta mb-2"
            role="status"
            data-testid="tag-filter-count"
        >
            <template v-if="loading && !results.length">Finding Documents…</template>
            <template v-else-if="!results.length">No Documents have {{ tagStore.filters.length > 1 ? 'all these tags' : 'this tag' }}.</template>
            <template v-else>{{ results.length }} {{ results.length === 1 ? 'Document' : 'Documents' }}</template>
        </p>
        <ul class="space-y-0.5">
            <li
                v-for="row in visible"
                :key="`${row.dbKey}:${row.id}`"
            >
                <div
                    class="flex cursor-pointer flex-col rounded-md px-2 py-1 hover:bg-gray-100"
                    :class="{ 'bg-gray-200 hover:bg-gray-300': isSelected(row) }"
                    role="button"
                    tabindex="0"
                    :data-testid="`tag-filter-result-${row.id}`"
                    @click="open(row)"
                    @keydown.enter.prevent="open(row)"
                >
                    <div class="flex min-w-0 items-center gap-2">
                        <File class="h-4 w-4 flex-shrink-0" />
                        <span class="flex-grow truncate">{{ row.title || 'Untitled' }}</span>
                        <DocumentTagChips
                            :db-key="row.dbKey"
                            :note-id="row.id"
                        />
                    </div>
                    <span
                        v-if="row.spaceName || row.folderPath"
                        class="pn-meta truncate pl-6"
                    >{{ [row.spaceName, row.folderPath].filter(Boolean).join(' · ') }}</span>
                </div>
            </li>
        </ul>
        <button
            v-if="results.length > visible.length"
            type="button"
            class="mt-2 w-full rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-100"
            data-testid="tag-filter-more"
            @click="limit += PAGE"
        >
            Show more
        </button>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { File } from 'lucide-vue-next'
import DocumentTagChips from './DocumentTagChips.vue'
import { useTagStore } from '@/store/tagStore'
import { useDocumentIndexStore } from '@/store/documentIndexStore'
import { useSyncStore } from '@/store/syncStore'
import { useDocStore } from '@/store/docStore'

/**
 * The Documents the active tag filters match, in place of the sidebar tree
 * (tag-system.md §5.2): every open database, merged, newest edit first.
 */
const PAGE = 100

const router = useRouter()
const tagStore = useTagStore()
const index = useDocumentIndexStore()
const syncStore = useSyncStore()
const docStore = useDocStore()

const results = ref([])
const loading = ref(false)
const limit = ref(PAGE)
const visible = computed(() => results.value.slice(0, limit.value))

let run = 0
let timer = null

async function refresh() {
    const current = ++run
    loading.value = true
    try {
        const rows = await tagStore.findTaggedDocuments([...tagStore.filters])
        if (current === run) results.value = rows
    } finally {
        if (current === run) loading.value = false
    }
}

function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => void refresh(), 50)
}

watch(() => tagStore.filters, () => {
    limit.value = PAGE
    schedule()
}, { immediate: true })
// Tags changed, a database came or went, or the tree was reloaded (a rename,
// a move, a sync).
watch(() => [index.version, syncStore.databases.size, docStore.rootItems, docStore.recentDocVersion], schedule)
onBeforeUnmount(() => clearTimeout(timer))

function isSelected(row) {
    return docStore.selectedFileId === row.id && docStore.selectedDbKey === row.dbKey
}

function open(row) {
    docStore.selectFile(row.id, row.dbKey)
    router.push({ name: 'doc', params: { fileId: row.id }, query: { dbKey: row.dbKey } })
}
</script>
