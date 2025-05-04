<template>
    <!-- Main outlet for page components --> <router-view v-slot="{ Component }">
        <component :is="Component" :key="$route.fullPath" />
    </router-view> <!-- Global toast container (bottom-right, auto-dismiss) -->
    <ToastContainer />

</template>
<script setup>
import ToastContainer from './components/ToastContainer.vue'
</script>
