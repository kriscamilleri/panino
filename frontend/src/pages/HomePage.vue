<template>
    <div class="h-screen flex flex-col overflow-hidden">
        <!-- Top Navbar -->
        <Navbar />

        <!-- Sub Menu Bar -->
        <SubMenuBar />

        <!-- Main content area -->
        <div ref="mainContent" class="flex flex-1 overflow-hidden">
            <!-- Sidebar (Documents) + Resizer -->
            <SidebarWithResizer :isMobileView="isMobileView" />

            <!-- Content area (Folder preview or Editor+Preview) -->
            <ContentArea :isMobileView="isMobileView" />
        </div>

        <!-- Possibly keep your ImportModal here or move it to SubMenuBar.vue -->
        <ImportModal :show="showImportModal" @close="showImportModal = false" @import-success="handleImportSuccess" />
    </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import Navbar from '@/components/Navbar.vue'
import SubMenuBar from '@/components/SubMenuBar.vue'
import SidebarWithResizer from '@/components/SidebarWithResizer.vue'
import ContentArea from '@/components/ContentArea.vue'
import ImportModal from '@/components/ImportModal.vue'

const showImportModal = ref(false)

// Example for "mobile view" if your original code used windowWidth watchers
const windowWidth = ref(window.innerWidth)
const isMobileView = computed(() => windowWidth.value < 768)

function handleImportSuccess() {
    console.log('Import successful')
}

// If you still want to watch window resizing:
window.addEventListener('resize', () => {
    windowWidth.value = window.innerWidth
})
</script>