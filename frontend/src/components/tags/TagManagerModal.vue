<template>
    <BaseModal
        :show="tagStore.managerOpen"
        title="Tags"
        size="lg"
        close-testid="tag-manager-close"
        @close="tagStore.closeManager()"
    >
        <div class="space-y-1">
            <label
                class="pn-label"
                for="tag-manager-scope"
            >Tags in</label>
            <select
                id="tag-manager-scope"
                v-model="scope"
                class="pn-select"
                data-testid="tag-manager-scope"
            >
                <option
                    v-for="option in scopes"
                    :key="option.dbKey"
                    :value="option.dbKey"
                >{{ option.name }}</option>
            </select>
            <p
                v-if="scopeIsSpace"
                class="pn-meta"
                data-testid="tag-manager-space-note"
            >Changes apply to everyone in {{ scopeName }}.</p>
            <p
                v-else
                class="pn-meta"
            >Tags come from the <code>tags:</code> list in a Document's front matter. A colour or display name here changes only how a tag looks; Documents are never edited.</p>
        </div>

        <p
            v-if="error"
            class="mt-3 text-sm text-red-600"
            role="alert"
            data-testid="tag-manager-error"
        >{{ error }}</p>

        <p
            v-if="loading"
            class="pn-body mt-5"
        >Reading tags…</p>
        <p
            v-else-if="!tags.length"
            class="mt-5 rounded-lg border border-dashed border-gray-300 p-4 pn-body"
            data-testid="tag-manager-empty"
        >No tags yet. Add <code>tags:</code> to a Document's front matter, for example <code>tags: [work, urgent]</code>.</p>

        <ul
            v-else
            class="mt-5 space-y-2"
            data-testid="tag-manager-list"
        >
            <li
                v-for="tag in tags"
                :key="tag.name"
                class="pn-panel px-3 py-2"
                :data-testid="`tag-manager-row-${tag.name}`"
            >
                <div class="flex flex-wrap items-center gap-3">
                    <span
                        class="h-3.5 w-3.5 flex-shrink-0 rounded-sm"
                        :style="{ background: tag.hex }"
                        aria-hidden="true"
                    />
                    <TagChip
                        :name="tag.name"
                        :label="tag.label"
                        :hex="tag.hex"
                        :color-key="tag.colorKey"
                    />
                    <span class="pn-meta">{{ tag.count }} {{ tag.count === 1 ? 'Document' : 'Documents' }}</span>
                    <div class="ml-auto flex items-center gap-2">
                        <BaseButton
                            variant="ghost"
                            size="sm"
                            :data-testid="`tag-manager-rename-${tag.name}`"
                            @click="startRename(tag)"
                        >
                            <Pencil class="h-4 w-4" />
                            <span>Display name</span>
                        </BaseButton>
                        <BaseButton
                            v-if="tag.styled"
                            variant="ghost"
                            size="sm"
                            :data-testid="`tag-manager-reset-${tag.name}`"
                            @click="reset(tag)"
                        >
                            <RotateCcw class="h-4 w-4" />
                            <span>Reset</span>
                        </BaseButton>
                    </div>
                </div>

                <div
                    class="mt-2 flex flex-wrap items-center gap-1.5"
                    role="radiogroup"
                    :aria-label="`Colour of ${tag.label}`"
                >
                    <button
                        v-for="color in TAG_PALETTE"
                        :key="color.key"
                        type="button"
                        role="radio"
                        class="h-6 w-6 rounded-md border-2 focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-1"
                        :class="isChosen(tag, color.key) ? 'border-gray-900' : 'border-transparent'"
                        :style="{ background: color.hex }"
                        :aria-checked="isChosen(tag, color.key)"
                        :aria-label="color.label"
                        :title="color.label"
                        :data-testid="`tag-manager-color-${tag.name}-${color.key}`"
                        @click="choose(tag, color.key)"
                    />
                </div>

                <form
                    v-if="renaming === tag.name"
                    class="mt-2 flex flex-wrap items-center gap-2"
                    @submit.prevent="saveRename(tag)"
                >
                    <label
                        class="sr-only"
                        :for="`tag-manager-name-${tag.name}`"
                    >Display name of {{ tag.name }}</label>
                    <input
                        :id="`tag-manager-name-${tag.name}`"
                        v-model="renameValue"
                        type="text"
                        maxlength="50"
                        class="pn-input max-w-xs"
                        :placeholder="tag.name"
                        :data-testid="`tag-manager-name-input-${tag.name}`"
                    />
                    <BaseButton
                        type="submit"
                        variant="primary"
                        size="sm"
                        :data-testid="`tag-manager-name-save-${tag.name}`"
                    >Save</BaseButton>
                    <BaseButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        @click="renaming = null"
                    >Cancel</BaseButton>
                    <p class="pn-meta w-full">Only capitals and spacing can change, for example {{ tag.name.toUpperCase() }}. Leave empty to use the spelling in each Document.</p>
                </form>
            </li>
        </ul>

        <template #footer>
            <BaseButton
                variant="secondary"
                size="md"
                data-testid="tag-manager-done"
                @click="tagStore.closeManager()"
            >Done</BaseButton>
        </template>
    </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Pencil, RotateCcw } from 'lucide-vue-next'
import BaseModal from '@/components/BaseModal.vue'
import BaseButton from '@/components/BaseButton.vue'
import TagChip from './TagChip.vue'
import { TAG_PALETTE, NEUTRAL_TAG_COLOR } from '@/utils/tagPalette'
import { useTagStore } from '@/store/tagStore'
import { useDocumentIndexStore } from '@/store/documentIndexStore'
import { useSyncStore } from '@/store/syncStore'

/**
 * Tools → Tags (tag-system.md §5.3): the tags of one database — styled ones
 * and ones found in its Documents — with colour, display name and reset.
 */
const tagStore = useTagStore()
const index = useDocumentIndexStore()
const syncStore = useSyncStore()

const scope = ref(null)
const loading = ref(false)
const error = ref('')
const renaming = ref(null)
const renameValue = ref('')

const scopes = computed(() => [...syncStore.databases.values()]
    .filter((entry) => entry.db)
    .map((entry) => ({ dbKey: entry.dbKey, name: entry.kind === 'space' ? entry.name : 'Personal', kind: entry.kind })))
const current = computed(() => scopes.value.find((option) => option.dbKey === scope.value) || null)
const scopeIsSpace = computed(() => current.value?.kind === 'space')
const scopeName = computed(() => current.value?.name || '')

const tags = computed(() => {
    if (!scope.value) return []
    void index.versionOf(scope.value)
    void tagStore.styles[scope.value]
    return tagStore.listTags(scope.value)
})

watch(() => [tagStore.managerOpen, tagStore.managerDbKey], ([open, dbKey]) => {
    if (open) scope.value = dbKey || syncStore.personalDbKey
}, { immediate: true })

watch(scope, async (dbKey) => {
    error.value = ''
    renaming.value = null
    if (!dbKey || !tagStore.managerOpen) return
    loading.value = true
    try {
        await Promise.all([index.ensure(dbKey), tagStore.loadStyles(dbKey)])
    } catch {
        error.value = 'Could not read the tags of this database.'
    } finally {
        loading.value = false
    }
}, { immediate: true })

function isChosen(tag, key) {
    return tag.colorKey === key
}

async function attempt(work) {
    error.value = ''
    try {
        await work()
        return true
    } catch (failure) {
        error.value = failure?.message || 'Could not save the tag.'
        return false
    }
}

function choose(tag, key) {
    void attempt(() => tagStore.setColor(scope.value, tag.name, key === NEUTRAL_TAG_COLOR ? '' : key))
}

function startRename(tag) {
    renaming.value = tag.name
    renameValue.value = tagStore.styleRow(scope.value, tag.name)?.displayName || tag.label
}

async function saveRename(tag) {
    if (await attempt(() => tagStore.setDisplayName(scope.value, tag.name, renameValue.value))) renaming.value = null
}

function reset(tag) {
    void attempt(() => tagStore.resetTag(scope.value, tag.name))
}
</script>
