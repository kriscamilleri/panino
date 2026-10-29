<template>
    <component
        :is="entry.component"
        v-for="entry in entries"
        :key="entry.key"
        :show="isOpen(entry)"
        @close="ui.closeAddonModal()"
    />
</template>

<script setup>
/**
 * Mounts the modals of every add-on that is on, and shows the one
 * ui.addonModal names (docs/specs/active/addon-folders.md §6.2.1). Modals stay
 * mounted while their add-on is on, so they keep state between openings; their
 * code loads only once the add-on is on. Mounted in two places that are never
 * on screen together: HomePage's desktop layout and the phone Document menu.
 */
import { computed, defineAsyncComponent } from 'vue'
import { ADDON_MANIFESTS } from '@/addons/registry'
import { useAddonsStore } from '@/store/addonsStore'
import { useUiStore } from '@/store/uiStore'

const addonsStore = useAddonsStore()
const ui = useUiStore()

/** One async component per add-on modal. */
const loaded = new Map()
function asyncModal(addonId, modalId, loader) {
    const key = `${addonId}:${modalId}`
    if (!loaded.has(key)) loaded.set(key, defineAsyncComponent(loader))
    return loaded.get(key)
}

const entries = computed(() => ADDON_MANIFESTS
    .filter((manifest) => addonsStore.isActive(manifest.id))
    .flatMap((manifest) => Object.entries(manifest.modals || {}).map(([modalId, loader]) => ({
        key: `${manifest.id}:${modalId}`,
        addonId: manifest.id,
        modalId,
        component: asyncModal(manifest.id, modalId, loader),
    }))))

function isOpen(entry) {
    return ui.addonModal?.addonId === entry.addonId && ui.addonModal?.modalId === entry.modalId
}
</script>
