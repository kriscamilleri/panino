<template>
    <span
        v-if="shown.length"
        class="pn-doc-tags"
        :data-testid="`document-tags-${noteId}`"
    >
        <TagChip
            v-for="tag in shown"
            :key="tag.name"
            :name="tag.name"
            :label="tag.label"
            :hex="tag.hex"
            :color-key="tag.colorKey"
            size="xs"
            :clickable="filterable"
            :title="filterable ? `Show Documents tagged ${tag.label}` : tag.label"
            :data-testid="`document-tag-${noteId}-${tag.name}`"
            @click.stop="filterable && tagStore.addFilter(tag.name)"
        />
        <span
            v-if="overflow > 0"
            class="flex-shrink-0 text-[11px] text-gray-500"
            :title="hiddenLabels"
            :data-testid="`document-tags-more-${noteId}`"
        >+{{ overflow }}</span>
    </span>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue'
import TagChip from './TagChip.vue'
import { useDocumentIndexStore } from '@/store/documentIndexStore'
import { useTagStore } from '@/store/tagStore'

/**
 * The tags of one Document, from the metadata index, coloured from the
 * Document's own database (tag-system.md §5.1): the first three, then `+N`.
 */
const props = defineProps({
    dbKey: { type: String, default: null },
    noteId: { type: String, required: true },
    /** Clicking a chip filters the sidebar by that tag. */
    filterable: { type: Boolean, default: true },
    max: { type: Number, default: 3 },
})

const index = useDocumentIndexStore()
const tagStore = useTagStore()

function prepare() {
    if (!props.dbKey) return
    index.ensure(props.dbKey).catch(() => {})
    void tagStore.loadStyles(props.dbKey)
}

onMounted(prepare)
watch(() => props.dbKey, prepare)

const tags = computed(() => {
    if (!props.dbKey) return []
    void index.versionOf(props.dbKey)
    const entry = index.entry(props.dbKey, props.noteId)
    if (!entry) return []
    return entry.tags.map((name) => tagStore.tagLook(props.dbKey, name, entry.tagLabels[name]))
})

const shown = computed(() => tags.value.slice(0, props.max))
const overflow = computed(() => Math.max(0, tags.value.length - props.max))
const hiddenLabels = computed(() => tags.value.slice(props.max).map((tag) => tag.label).join(', '))
</script>

<style scoped>
.pn-doc-tags {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    flex-shrink: 1;
    overflow: hidden;
}
</style>
