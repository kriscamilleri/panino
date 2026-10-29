<template>
    <PhoneShell v-if="isPhone">
        <PhoneEditor v-if="route.params.fileId" />
        <PhoneFolderView v-else-if="route.params.folderId" />
        <PhoneHome v-else />
        <PhoneDrawer
            :open="activeSheet === 'drawer'"
            @close="closeSheet"
        />
        <MoveSheet
            :open="activeSheet === 'move'"
            :target="sheetArg === 'selection' ? 'selection' : 'document'"
            @close="closeSheet"
        />
        <SortSheet
            :open="activeSheet === 'sort'"
            @close="closeSheet"
        />
    </PhoneShell>
    <div v-else class="h-screen flex flex-col overflow-hidden">
        <Navbar />
        <SubMenuBar />
        <div ref="mainContent" class="flex flex-1 overflow-hidden" data-testid="homepage-main-content">
            <SidebarWithResizer />
            <ContentArea />
        </div>
        <ImportModal :show="ui.showImportModal" @close="ui.closeImportModal()" @import-success="handleImportSuccess"
            data-testid="homepage-import-modal" />
        <ExportModal :show="ui.showExportModal" @close="ui.closeExportModal()" data-testid="homepage-export-modal" />
        <!-- Add-on modals on desktop; on a phone the Document menu hosts them. -->
        <AddonModalHost />
        <VariablesModal :show="ui.showVariablesModal" @close="ui.closeVariablesModal()" data-testid="homepage-variables-modal" />
        <ImageLibraryModal
            :show="ui.showImageLibraryModal"
            :db-key="docStore.selectedDbKey"
            @close="ui.closeImageLibraryModal()"
            @insert-selected="handleInsertSelectedImages"
            data-testid="homepage-image-library-modal"
        />
    </div>
</template>

<script setup>
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import Navbar from '@/components/Navbar.vue'
import SubMenuBar from '@/components/SubMenuBar.vue'
import SidebarWithResizer from '@/components/SidebarWithResizer.vue'
import ContentArea from '@/components/ContentArea.vue'
import ImportModal from '@/components/ImportModal.vue'
import ExportModal from '@/components/ExportModal.vue'
import VariablesModal from '@/components/VariablesModal.vue'
import ImageLibraryModal from '@/components/ImageLibraryModal.vue'
import AddonModalHost from '@/components/addons/AddonModalHost.vue'
import PhoneShell from '@/components/phone/PhoneShell.vue'
import PhoneEditor from '@/components/phone/PhoneEditor.vue'
import PhoneHome from '@/components/phone/PhoneHome.vue'
import PhoneFolderView from '@/components/phone/PhoneFolderView.vue'
import PhoneDrawer from '@/components/phone/PhoneDrawer.vue'
import MoveSheet from '@/components/phone/MoveSheet.vue'
import SortSheet from '@/components/phone/SortSheet.vue'
import { useViewport } from '@/composables/useViewport'
import { useSheetRoute } from '@/composables/useSheetRoute'
import { usePhoneSelection } from '@/composables/usePhoneSelection'
import { useUiStore } from '@/store/uiStore'
import { useDocStore } from '@/store/docStore'
import { useEditorStore } from '@/store/editorStore'
import { useGlobalVariablesStore } from '@/store/globalVariablesStore'

const ui = useUiStore()
const docStore = useDocStore()
const editorStore = useEditorStore()
const globalVariablesStore = useGlobalVariablesStore()
const route = useRoute()

const { isPhone } = useViewport()
const { activeSheet, sheetArg, closeSheet } = useSheetRoute()
const selection = usePhoneSelection()

// A selection belongs to the screen it was made on.
watch(() => [route.name, route.params.folderId, route.query.filter], () => {
    if (activeSheet.value !== 'move') selection.clear()
})

// Sync store on route param changes
async function applyRouteSelection() {
    const dbKey = typeof route.query.dbKey === 'string'
        ? route.query.dbKey
        : docStore.syncStore.personalDbKey
    if (route.params.fileId) {
        await docStore.selectFile(route.params.fileId, dbKey)
    } else if (route.params.folderId) {
        docStore.selectFolder(route.params.folderId, dbKey)
    } else {
        docStore.selectFolder(null, docStore.syncStore.personalDbKey)
    }
    await globalVariablesStore.loadGlobals(dbKey)
}
onMounted(applyRouteSelection)
watch(() => route.params.fileId, applyRouteSelection)
watch(() => route.params.folderId, applyRouteSelection)
watch(() => route.query.dbKey, applyRouteSelection)

function handleImportSuccess() {
    console.info('Import successful')
    ui.addToast('Data imported successfully!', 'success');
    docStore.loadInitialData();
}

function handleInsertSelectedImages(images) {
    editorStore.insertImageFromLibrary(images)
    ui.closeImageLibraryModal()
}
</script>
