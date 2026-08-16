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

        <div class="flex items-center gap-2 lg:shrink-0">
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

            <BaseButton
                variant="primary"
                size="md"
                class="shrink-0 whitespace-nowrap"
                data-testid="document-dashboard-new-note"
                @click="$emit('new-note')"
            >
                <Plus
                    class="h-4 w-4"
                    aria-hidden="true"
                />
                <span>New</span>
            </BaseButton>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { Search, Plus, X } from 'lucide-vue-next'
import BaseButton from '@/components/BaseButton.vue'

const props = defineProps({
    title: { type: String, required: true },
    /** Context-aware label: `Search recent documents` or `Search this folder`. */
    searchLabel: { type: String, required: true },
    modelValue: { type: String, default: '' },
    titleTestid: { type: String, default: 'document-dashboard-title' },
    scopeKey: { type: String, default: 'global' },
})

defineEmits(['update:modelValue', 'new-note'])

const inputId = computed(() => `document-dashboard-search-${props.scopeKey}`)
</script>
