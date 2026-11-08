<template>
    <PhoneShell v-if="isPhone">
        <DocumentNotAvailable v-if="route.params.fileId && docUnavailable" />
        <PhoneEditor v-else-if="route.params.fileId" />
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
            <DocumentNotAvailable v-if="route.params.fileId && docUnavailable" />
            <ContentArea v-else />
        </div>
        <ImportModal :show="ui.showImportModal" @close="ui.closeImportModal()" @import-success="handleImportSuccess"
            data-testid="homepage-import-modal" />
        <ExportModal :show="ui.showExportModal" @close="ui.closeExportModal()" data-testid="homepage-export-modal" />
        <!-- Add-on modals on desktop; on a phone the Document menu hosts them. -->
        <AddonModalHost />
        <LinkPickerPopover />
        <TocOptionsModal />
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
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Navbar from '@/components/Navbar.vue'
import SubMenuBar from '@/components/SubMenuBar.vue'
import SidebarWithResizer from '@/components/SidebarWithResizer.vue'
import ContentArea from '@/components/ContentArea.vue'
import ImportModal from '@/components/ImportModal.vue'
import ExportModal from '@/components/ExportModal.vue'
import VariablesModal from '@/components/VariablesModal.vue'
import ImageLibraryModal from '@/components/ImageLibraryModal.vue'
import AddonModalHost from '@/components/addons/AddonModalHost.vue'
import DocumentNotAvailable from '@/components/DocumentNotAvailable.vue'
import LinkPickerPopover from '@/components/LinkPickerPopover.vue'
import TocOptionsModal from '@/components/TocOptionsModal.vue'
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
import { STARTUP_WAIT_MS, locateDocument, usableDbKey } from '@/utils/routeDocument'

const ui = useUiStore()
const docStore = useDocStore()
const editorStore = useEditorStore()
const globalVariablesStore = useGlobalVariablesStore()
const route = useRoute()
const router = useRouter()
// A `#/doc/<id>` address this device cannot open (§6.8 of the TOC and links spec).
const docUnavailable = ref(false)

const { isPhone } = useViewport()
const { activeSheet, sheetArg, closeSheet } = useSheetRoute()
const selection = usePhoneSelection()

// A selection belongs to the screen it was made on.
watch(() => [route.name, route.params.folderId, route.query.filter], () => {
    if (activeSheet.value !== 'move') selection.clear()
})

/**
 * Resolve once the first start-up work is done: space discovery (it opens and syncs
 * each space) and any sync in flight. Bounded, so an unreachable server cannot hold the
 * screen; offline it resolves with what this device holds.
 */
async function waitForStartup() {
    const syncStore = docStore.syncStore
    const deadline = Date.now() + STARTUP_WAIT_MS
    await Promise.race([
        syncStore.refreshMembership().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, STARTUP_WAIT_MS)),
    ])
    while (syncStore.isSyncing && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
}

let selectionRun = 0

// Sync store on route param changes
async function applyRouteSelection() {
    const run = ++selectionRun
    const fileId = route.params.fileId
    const requested = route.query.dbKey
    let dbKey = usableDbKey(requested, docStore.syncStore.databases)
    if (fileId) {
        if (!dbKey) {
            // No key, or one that is no use here: look the Document up, the same way
            // whether it never existed, was deleted, or is in someone else's database.
            const found = await locateDocument(fileId, {
                lookup: (id) => docStore.findDocumentDbKey(id),
                waitForStartup,
            })
            if (run !== selectionRun || route.params.fileId !== fileId) return
            if (!found) {
                docUnavailable.value = true
                return
            }
            docUnavailable.value = false
            if (found !== requested) {
                // A reload goes straight there; the dbKey watcher selects it.
                await router.replace({ query: { ...route.query, dbKey: found } })
                return
            }
            dbKey = found
        }
        docUnavailable.value = false
        await docStore.selectFile(fileId, dbKey)
    } else if (route.params.folderId) {
        docUnavailable.value = false
        dbKey = typeof requested === 'string' ? requested : docStore.syncStore.personalDbKey
        docStore.selectFolder(route.params.folderId, dbKey)
    } else {
        docUnavailable.value = false
        dbKey = docStore.syncStore.personalDbKey
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
