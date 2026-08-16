<!-- frontend/src/components/FolderPreview.vue -->
<template>
    <!--
        Thin route shim. Both the global `__recent__` branch and real folders
        render the same dashboard; the scope difference lives inside it.
    -->
    <DocumentDashboard :folder-id="folderId" />
</template>

<script setup>
import DocumentDashboard from '@/components/DocumentDashboard.vue'

defineProps({
    folderId: { type: String, default: null }
})
</script>
