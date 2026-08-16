<!-- frontend/src/components/DocumentDashboardHeader.vue -->
<template>
    <!--
        The single-row header is the desktop layout (>= 1024px, per the spec).
        Below that the title keeps its own line so it is never squeezed to an
        ellipsis by the search field beside it.
    -->
    <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <h2
            class="min-w-0 truncate pn-title-page"
            :data-testid="titleTestid"
        >
            {{ title }}
        </h2>

        <div class="flex min-w-0 items-center gap-2 lg:shrink-0">
            <div class="relative min-w-0 flex-1 lg:w-72 lg:flex-none">
                <!--
                    Quick filter, not workspace search: it narrows the already
                    loaded documents of this dashboard's scope by title, folder
                    path, and excerpt. The label says exactly that.
                -->
                <label
                    class="sr-only"
                    :for="inputId"
                >{{ searchLabel }}</label>

                <Search
                    class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                    aria-hidden="true"
                />

                <input
                    :id="inputId"
                    :value="modelValue"
                    type="text"
                    class="pn-input pl-8"
                    :class="modelValue ? 'pr-8' : ''"
                    :placeholder="searchLabel"
                    :aria-label="searchLabel"
                    data-testid="document-dashboard-search"
                    @input="$emit('update:modelValue', $event.target.value)"
                />

                <button
                    v-if="modelValue"
                    type="button"
                    class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
                    aria-label="Clear search"
                    title="Clear search"
                    data-testid="document-dashboard-search-clear"
                    @click="$emit('update:modelValue', '')"
                >
                    <X
                        class="h-4 w-4"
                        aria-hidden="true"
                    />
                </button>
            </div>

            <div
                ref="createMenuRef"
                class="relative flex shrink-0"
            >
                <BaseButton
                    variant="primary"
                    size="md"
                    class="whitespace-nowrap rounded-r-none"
                    data-testid="document-dashboard-new-note"
                    @click="$emit('new-note')"
                >
                    <Plus
                        class="h-4 w-4"
                        aria-hidden="true"
                    />
                    <span>New</span>
                </BaseButton>

                <BaseButton
                    variant="primary"
                    size="md"
                    icon-only
                    class="rounded-l-none border-l border-gray-700"
                    :aria-expanded="isCreateMenuOpen"
                    aria-controls="document-dashboard-create-menu"
                    aria-haspopup="menu"
                    aria-label="More document creation options"
                    data-testid="document-dashboard-create-menu-toggle"
                    @click="isCreateMenuOpen = !isCreateMenuOpen"
                >
                    <ChevronDown
                        class="h-4 w-4"
                        aria-hidden="true"
                    />
                </BaseButton>

                <div
                    v-if="isCreateMenuOpen"
                    id="document-dashboard-create-menu"
                    class="absolute right-0 top-full z-10 mt-1 min-w-max rounded-md border border-gray-200 bg-white p-1 shadow-lg"
                    role="menu"
                    data-testid="document-dashboard-create-menu"
                >
                    <button
                        type="button"
                        class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
                        role="menuitem"
                        data-testid="document-dashboard-new-from-template"
                        @click="openTemplatePicker"
                    >
                        <FileText
                            class="h-4 w-4"
                            aria-hidden="true"
                        />
                        <span>New from Template</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ChevronDown, FileText, Search, Plus, X } from 'lucide-vue-next'
import BaseButton from '@/components/BaseButton.vue'

const props = defineProps({
    title: { type: String, required: true },
    /** Context-aware label: `Search recent documents` or `Search this folder`. */
    searchLabel: { type: String, required: true },
    modelValue: { type: String, default: '' },
    titleTestid: { type: String, default: 'document-dashboard-title' },
    scopeKey: { type: String, default: 'global' },
})

const emit = defineEmits(['update:modelValue', 'new-note', 'new-from-template'])

const inputId = computed(() => `document-dashboard-search-${props.scopeKey}`)
const createMenuRef = ref(null)
const isCreateMenuOpen = ref(false)

function openTemplatePicker() {
    isCreateMenuOpen.value = false
    emit('new-from-template')
}

function closeCreateMenuOnOutsideClick(event) {
    if (!createMenuRef.value?.contains(event.target)) {
        isCreateMenuOpen.value = false
    }
}

function closeCreateMenuOnEscape(event) {
    if (event.key === 'Escape') {
        isCreateMenuOpen.value = false
    }
}

onMounted(() => {
    document.addEventListener('click', closeCreateMenuOnOutsideClick)
    document.addEventListener('keydown', closeCreateMenuOnEscape)
})

onUnmounted(() => {
    document.removeEventListener('click', closeCreateMenuOnOutsideClick)
    document.removeEventListener('keydown', closeCreateMenuOnEscape)
})
</script>
