<template>
    <div
        v-if="tagStore.hasFilters"
        class="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5"
        role="group"
        aria-label="Tag filters"
        data-testid="tag-filter-bar"
    >
        <span class="pn-meta mr-0.5">Tagged</span>
        <TagChip
            v-for="tag in active"
            :key="tag.name"
            :name="tag.name"
            :label="tag.label"
            :hex="tag.hex"
            :color-key="tag.colorKey"
            size="sm"
            clickable
            :title="`Remove the ${tag.label} filter`"
            :aria-label="`Remove the ${tag.label} filter`"
            :data-testid="`tag-filter-${tag.name}`"
            @click="tagStore.removeFilter(tag.name)"
        >
            <X
                class="ml-0.5 h-3 w-3"
                aria-hidden="true"
            />
        </TagChip>
        <button
            type="button"
            class="ml-auto rounded-md px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-gray-500"
            data-testid="tag-filter-clear"
            @click="tagStore.clearFilters()"
        >
            Clear
        </button>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import TagChip from './TagChip.vue'
import { useTagStore } from '@/store/tagStore'
import { useSyncStore } from '@/store/syncStore'

/**
 * The active tag filters at the top of the sidebar (tag-system.md §5.2). A
 * filter spans every database, so its chip takes the personal database's look
 * when it styles the tag, else the first space's that does.
 */
const tagStore = useTagStore()
const syncStore = useSyncStore()

const active = computed(() => tagStore.filters.map((name) => {
    const keys = [...syncStore.databases.keys()]
    const styledIn = keys.find((dbKey) => tagStore.styleRow(dbKey, name))
    return tagStore.tagLook(styledIn || syncStore.personalDbKey, name)
}))
</script>
