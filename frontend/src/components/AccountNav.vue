<template>
    <nav class="bg-gray-100 border-b">
        <div class=" s px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between items-center py-2">
                <h1 class="text-xl font-semibold text-gray-800">{{ title }}</h1>
                <div class="flex items-center space-x-2">
                    <slot name="actions"></slot>
                </div>
            </div>
        </div>
    </nav>
</template>

<script setup>
defineProps({
    title: {
        type: String,
        required: true,
    },
});
</script>