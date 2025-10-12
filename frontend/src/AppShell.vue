<template>
    <router-view v-slot="{ Component }">
        <component :is="Component" />
    </router-view>
    <ToastContainer />
    <PwaInstallPrompt />
</template>

<script setup>
import ToastContainer from '@/components/ToastContainer.vue'
import PwaInstallPrompt from '@/components/PwaInstallPrompt.vue'
</script>
