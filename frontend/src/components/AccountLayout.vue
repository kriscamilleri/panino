<template>
    <div class="min-h-screen bg-gray-100">
        <AccountNav :title="title">
            <template #actions>
                <router-link
                    to="/"
                    custom
                    v-slot="{ navigate }"
                >
                    <BaseButton @click="navigate">
                        <ArrowLeft class="w-4 h-4" />
                        <span>Back</span>
                    </BaseButton>
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
import BaseButton from './BaseButton.vue';

defineProps({
    title: {
        type: String,
        required: true,
    },
});
</script>
