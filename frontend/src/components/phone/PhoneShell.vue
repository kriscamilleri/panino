<template>
    <div
        class="phone-ui ph-shell"
        :class="{ 'ph-keyboard-open': keyboardOpen }"
        :style="visibleStyle"
        data-testid="phone-shell"
    >
        <!--
        Root of every phone screen. `.phone-ui` scopes the phone tokens and
        styles; it covers exactly the visible screen, so it ends where the
        on-screen keyboard begins.
        -->
        <slot />
        <p
            class="sr-only"
            aria-live="polite"
            data-testid="phone-sync-announcer"
        >{{ announcement }}</p>
    </div>
</template>

<script setup>
import { useViewport } from '@/composables/useViewport'
import { usePhoneStatus } from '@/composables/usePhoneStatus'

const { visibleStyle, keyboardOpen } = useViewport()
const { announcement } = usePhoneStatus()
</script>

<style scoped>
.ph-shell {
    position: fixed;
    left: 0;
    right: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* Landscape notch; top and bottom insets are padded by each screen. */
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
}
</style>
