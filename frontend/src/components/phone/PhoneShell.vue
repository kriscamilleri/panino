<template>
    <!--
        Root of every phone screen. `.phone-ui` scopes the phone tokens and
        styles; the height ends where the on-screen keyboard begins.
    -->
    <div
        class="phone-ui ph-shell"
        :style="{ height: `calc(100dvh - ${keyboardInset}px)` }"
        data-testid="phone-shell"
    >
        <slot />
        <p
            class="sr-only"
            aria-live="polite"
            data-testid="phone-sync-announcer"
        >{{ announcement }}</p>
    </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useViewport } from '@/composables/useViewport'
import { usePhoneStatus } from '@/composables/usePhoneStatus'

const { keyboardInset } = useViewport()
const { sync } = usePhoneStatus()

// Sync changes are announced politely; syncing itself is too frequent to say.
const ANNOUNCEMENTS = {
    offline: "You're offline. Changes are saved on this phone and sync when you're back online.",
    error: 'Not synced. Local changes are safe.',
    synced: 'Synced.',
    off: 'Sync is off. Changes are saved on this phone.',
}
const announcement = ref('')
watch(() => sync.value.state, (state, previous) => {
    if (!previous || state === 'syncing') return
    // "Synced" after an ordinary save is noise; say it only on recovery.
    if (state === 'synced' && previous === 'syncing') return
    announcement.value = ANNOUNCEMENTS[state] || ''
})
</script>

<style scoped>
.ph-shell {
    position: fixed;
    inset: 0 0 auto 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
</style>
