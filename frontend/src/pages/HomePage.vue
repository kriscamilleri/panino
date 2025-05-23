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

        <!-- Import Modal -->
        <ImportModal :show="ui.showImportModal" @close="ui.closeImportModal()" @import-success="handleImportSuccess"
            data-testid="homepage-import-modal" />
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import Navbar from '@/components/Navbar.vue'
import SubMenuBar from '@/components/SubMenuBar.vue'
import SidebarWithResizer from '@/components/SidebarWithResizer.vue'
import ContentArea from '@/components/ContentArea.vue'
import ImportModal from '@/components/ImportModal.vue'
import { useUiStore } from '@/store/uiStore'
import { useDocStore } from '@/store/docStore'

const ui = useUiStore()
const docStore = useDocStore()
const route = useRoute()

// Mobile view detection
const windowWidth = ref(window.innerWidth)
const isMobileView = computed(() => windowWidth.value < 768)
const handleResize = () => { windowWidth.value = window.innerWidth }
onMounted(() => window.addEventListener('resize', handleResize))
onUnmounted(() => window.removeEventListener('resize', handleResize))

// Sync store on route param changes
function applyRouteSelection() {
    if (route.params.fileId) {
        docStore.selectFile(route.params.fileId)
    } else if (route.params.folderId) {
        docStore.selectFolder(route.params.folderId)
    } else {
        docStore.selectFolder(null)
    }
}
onMounted(applyRouteSelection)
watch(() => route.params.fileId, applyRouteSelection)
watch(() => route.params.folderId, applyRouteSelection)

function handleImportSuccess() {
    console.log('Import successful')
}
</script>