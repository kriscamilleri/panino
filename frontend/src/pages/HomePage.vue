<template>
    <div class="h-screen flex flex-col overflow-hidden">
        <!-- Top Navbar -->
        <Navbar />

        <!-- Sub Menu Bar -->
        <SubMenuBar />

        <!-- Main content area -->
        <div ref="mainContent" class="flex flex-1 overflow-hidden" data-testid="homepage-main-content">
            <!-- Sidebar (Documents) + Resizer -->
            <SidebarWithResizer :isMobileView="isMobileView" />

            <!-- Content area (Folder preview or Editor+Preview) -->
            <ContentArea :isMobileView="isMobileView" />
        </div>

        <!-- Use uiStore state/actions for the ImportModal -->
        <ImportModal :show="ui.showImportModal" @close="ui.closeImportModal()" @import-success="handleImportSuccess"
            data-testid="homepage-import-modal" />
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue' // Added life cycle hooks
import Navbar from '@/components/Navbar.vue'
import SubMenuBar from '@/components/SubMenuBar.vue'
import SidebarWithResizer from '@/components/SidebarWithResizer.vue'
import ContentArea from '@/components/ContentArea.vue'
import ImportModal from '@/components/ImportModal.vue'
import { useUiStore } from '@/store/uiStore' // Import uiStore

const ui = useUiStore() // Initialize uiStore

// Removed: const showImportModal = ref(false)

// Reactive window width for mobile view detection
const windowWidth = ref(window.innerWidth)
const isMobileView = computed(() => windowWidth.value < 768) // Standard Tailwind md breakpoint

const handleResize = () => {
    windowWidth.value = window.innerWidth
}

onMounted(() => {
    window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
})


function handleImportSuccess() {
    console.log('Import successful')
    // Optionally close the modal here too if the component doesn't always emit 'close'
    // ui.closeImportModal() // Modal should close itself on success via emit('close')
}

</script>
