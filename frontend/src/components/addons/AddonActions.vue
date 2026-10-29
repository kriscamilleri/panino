<template>
    <template v-if="surface === 'toolbar'">
        <BaseButton
            v-for="item in items"
            :key="item.key"
            :disabled="Boolean(item.blocked)"
            :title="item.blocked === 'online' ? 'Needs an internet connection' : item.blocked === 'document' ? 'Select a document first' : item.action.hint"
            :data-testid="`submenu-tools-addon-${item.addonId}-${item.action.id}`"
            @click="open(item)"
        >
            <component
                :is="item.action.icon"
                class="w-4 h-4"
            /><span class="button-text">{{ item.action.label }}</span>
        </BaseButton>
    </template>
    <template v-else>
        <button
            v-for="item in items"
            :key="item.key"
            type="button"
            class="ph-row"
            :disabled="Boolean(item.blocked)"
            :data-testid="`phone-menu-addon-${item.addonId}-${item.action.id}`"
            @click="open(item)"
        >
            <component
                :is="item.action.icon"
                class="h-5 w-5"
                aria-hidden="true"
            />
            {{ item.action.requires?.includes('online') && !syncStore.isOnline
                ? `${item.action.menuLabel || item.action.label} (needs a connection)`
                : (item.action.menuLabel || item.action.label) }}
        </button>
    </template>
</template>

<script setup>
/**
 * The actions add-ons contribute to the toolbar's Tools group (`surface="toolbar"`)
 * or the phone Document menu (`surface="menu"`), from their manifests
 * (docs/specs/active/addon-folders.md §6.2). An action is absent while its add-on
 * is off, and disabled while what it `requires` is missing:
 *   online    the app has a connection (syncStore.isOnline)
 *   document  a Document is selected
 * An action shows on both surfaces unless its `surfaces` lists only one.
 * Choosing one opens the add-on's modal through ui.openAddonModal.
 */
import { computed } from 'vue'
import BaseButton from '@/components/BaseButton.vue'
import { ADDON_MANIFESTS } from '@/addons/registry'
import { useAddonsStore } from '@/store/addonsStore'
import { useDocStore } from '@/store/docStore'
import { useSyncStore } from '@/store/syncStore'
import { useUiStore } from '@/store/uiStore'

const actionProps = defineProps({
    surface: { type: String, required: true, validator: (value) => ['toolbar', 'menu'].includes(value) },
})

const addonsStore = useAddonsStore()
const docStore = useDocStore()
const syncStore = useSyncStore()
const ui = useUiStore()

/** The first requirement that is not met, or null. */
function blockedBy(action) {
    for (const need of action.requires || []) {
        if (need === 'online' && !syncStore.isOnline) return 'online'
        if (need === 'document' && !docStore.selectedFileId) return 'document'
    }
    return null
}

const items = computed(() => ADDON_MANIFESTS
    .filter((manifest) => addonsStore.isActive(manifest.id))
    .flatMap((manifest) => (manifest.actions || [])
        .filter((action) => (action.surfaces || ['toolbar', 'menu']).includes(actionProps.surface))
        .map((action) => ({
        key: `${manifest.id}:${action.id}`,
        addonId: manifest.id,
        action,
        blocked: blockedBy(action),
        }))))

function open(item) {
    if (item.blocked) return
    ui.openAddonModal(item.addonId, item.action.modal)
}
</script>
