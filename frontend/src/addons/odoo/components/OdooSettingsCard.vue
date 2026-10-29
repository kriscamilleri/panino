<template>
    <div v-if="layout === 'phone'">
        <button
            type="button"
            class="ph-row"
            :disabled="!syncStore.isOnline"
            data-testid="phone-settings-tool-odoo"
            @click="showConnection = true"
        >
            <Plug
                class="h-5 w-5"
                aria-hidden="true"
            />
            <span class="ph-settings-grow">Odoo connection</span>
            <ChevronRight
                class="h-5 w-5"
                aria-hidden="true"
            />
        </button>
        <OdooKeyNotice class="mx-4 my-2" />
        <OdooSyncsCard
            ref="syncsCard"
            class="mx-4 my-3"
        />
        <OdooConnectionModal
            :show="showConnection"
            @close="closeConnection"
        />
    </div>
    <div
        v-else
        class="space-y-3"
    >
        <BaseButton
            variant="secondary"
            size="md"
            data-testid="settings-odoo-button"
            @click="showConnection = true"
        >
            <Plug class="w-4 h-4" />
            <span>Odoo connection</span>
        </BaseButton>
        <OdooKeyNotice />
        <OdooSyncsCard ref="syncsCard" />
        <OdooConnectionModal
            :show="showConnection"
            @close="closeConnection"
        />
    </div>
</template>

<script setup>
/**
 * The Odoo card under the add-on's switch in Settings, desktop and phone
 * (manifest.js `settingsCard`): the connection, the key notice and the syncs.
 * It owns the connection modal, so the Settings pages know nothing of Odoo.
 */
import { ref } from 'vue'
import { ChevronRight, Plug } from 'lucide-vue-next'
import BaseButton from '@/components/BaseButton.vue'
import { useSyncStore } from '@/store/syncStore'
import OdooConnectionModal from './OdooConnectionModal.vue'
import OdooKeyNotice from './OdooKeyNotice.vue'
import OdooSyncsCard from './OdooSyncsCard.vue'

defineProps({
    layout: { type: String, default: 'desktop', validator: (value) => ['desktop', 'phone'].includes(value) },
})

const syncStore = useSyncStore()
const showConnection = ref(false)
const syncsCard = ref(null)

// A connection change (new key, disconnect) changes what the syncs card can show.
function closeConnection() {
    showConnection.value = false
    syncsCard.value?.load?.()
}
</script>
