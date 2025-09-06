<template>
    <div class="min-h-screen bg-gray-100">
        <AccountNav :title="title">
            <template #actions>
                <router-link to="/"
                    class="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100  border-gray-200 rounded-md hover:bg-gray-200 flex items-center space-x-2">
                    <ArrowLeft class="w-4 h-4" />
                    <span>Back</span>
                </router-link>
            </template>
        </AccountNav>
        <main class="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            <div class="bg-white p-6 sm:p-8 rounded-lg shadow">
                <slot></slot>
            </div>
        </main>
    </div>
</template>

<script setup>
import { ArrowLeft } from 'lucide-vue-next';
import AccountNav from './AccountNav.vue';

defineProps({
    title: {
        type: String,
        required: true,
    },
});
</script>