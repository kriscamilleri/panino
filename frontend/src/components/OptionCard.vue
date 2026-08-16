<template>
    <!--
        The large "pick a format" row shared by Import and Export. The icon sits
        in a fixed box aligned to the title's cap height, so a one-line and a
        three-line option still read as the same component.
    -->
    <button
        type="button"
        class="group flex w-full items-start gap-4 rounded-lg border border-gray-200 p-4 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
    >
        <component
            :is="icon"
            class="mt-0.5 h-5 w-5 shrink-0 text-gray-500 transition-colors group-hover:text-gray-700"
        />
        <span class="min-w-0">
            <span class="block text-sm font-semibold text-gray-900">{{ title }}</span>
            <span class="mt-1 block pn-body">
                <slot>{{ description }}</slot>
            </span>
        </span>
    </button>
</template>

<script setup>
defineProps({
    /** A lucide-vue-next component. */
    icon: { type: [Object, Function], required: true },
    title: { type: String, required: true },
    /** Plain-text description; use the default slot when it needs markup. */
    description: { type: String, default: '' },
});
</script>
