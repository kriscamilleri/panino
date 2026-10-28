<template>
    <div
        v-if="message"
        :class="['pn-alert', rejected ? 'pn-alert-error' : 'pn-alert-warning']"
        role="status"
        data-testid="odoo-key-notice"
    >
        <span>{{ message }}</span>
        <button
            v-if="settingsLink"
            type="button"
            class="ml-1 font-medium underline underline-offset-2"
            data-testid="odoo-key-notice-settings"
            @click="emit('open-settings')"
        >Open Settings</button>
    </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useOdooStore } from '@/store/odooStore'
import { keyExpiryMessage } from '@/utils/odooConnection'

/**
 * One line about the Odoo API key when something needs doing: Odoo rejected it,
 * the address stopped answering, or the key expires within 14 days
 * (docs/specs/active/odoo-integration.md §5, "Key expiry"). Silent otherwise.
 */
const props = defineProps({
    /** Offer an "Open Settings" link (for places outside Settings). */
    settingsLink: { type: Boolean, default: false },
    /** Load the connection status on mount; off where the parent already does. */
    fetch: { type: Boolean, default: true },
})
const emit = defineEmits(['open-settings'])
const odoo = useOdooStore()

const rejected = computed(() => Boolean(odoo.status?.connected && odoo.status.lastError))
const message = computed(() => {
    if (!odoo.status?.connected) return ''
    if (odoo.status.lastError) return odoo.status.lastErrorMessage || 'Odoo rejected the connection.'
    return keyExpiryMessage(odoo.status.keyExpiresOn)
})

onMounted(() => {
    if (props.fetch && !odoo.status) void odoo.fetchStatus()
})
</script>
