<template>
    <div class="app-frame">
        <TauriTitlebar />
        <router-view v-slot="{ Component }">
            <component :is="Component" />
        </router-view>
    </div>
    <ToastContainer />
    <PwaInstallPrompt />
</template>

<script setup>
import ToastContainer from '@/components/ToastContainer.vue'
import PwaInstallPrompt from '@/components/PwaInstallPrompt.vue'
import TauriTitlebar from '@/components/TauriTitlebar.vue'
</script>
