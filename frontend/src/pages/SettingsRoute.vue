<template>
    <PhoneSettingsPage v-if="isPhone" />
    <SettingsPage v-else />
</template>

<script setup>
// Phones get the phone Settings screen; account details stay one tap away.
import PhoneSettingsPage from '@/pages/PhoneSettingsPage.vue'
import SettingsPage from '@/pages/SettingsPage.vue'
import { useViewport } from '@/composables/useViewport'

const { isPhone } = useViewport()
</script>
