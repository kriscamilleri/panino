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

        <!-- Use uiStore state/actions for the ImportModal -->
        <ImportModal :show="ui.showImportModal" @close="ui.closeImportModal()" @import-success="handleImportSuccess" />
    </div>
</template>

<script setup>
import { ref, computed } from 'vue' // Removed local 'ref' for showImportModal
import Navbar from '@/components/Navbar.vue'
import SubMenuBar from '@/components/SubMenuBar.vue'
import SidebarWithResizer from '@/components/SidebarWithResizer.vue'
import ContentArea from '@/components/ContentArea.vue'
import ImportModal from '@/components/ImportModal.vue'
import { useUiStore } from '@/store/uiStore' // Import uiStore

const ui = useUiStore() // Initialize uiStore

// Removed: const showImportModal = ref(false)

// Example for "mobile view" if your original code used windowWidth watchers
const windowWidth = ref(window.innerWidth)
const isMobileView = computed(() => windowWidth.value < 768)

function handleImportSuccess() {
    console.log('Import successful')
    // Optionally close the modal here too if the component doesn't always emit 'close'
    // ui.closeImportModal()
}

// If you still want to watch window resizing:
window.addEventListener('resize', () => {
    windowWidth.value = window.innerWidth
})
</script>