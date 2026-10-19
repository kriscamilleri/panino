<template>
    <div
        class="phone-ui ph-shell"
        :style="{ height: `calc(100dvh - ${keyboardInset}px)` }"
        data-testid="phone-shell"
    >
        <!--
        Root of every phone screen. `.phone-ui` scopes the phone tokens and
        styles; the height ends where the on-screen keyboard begins.
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

const { keyboardInset } = useViewport()
const { announcement } = usePhoneStatus()
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
