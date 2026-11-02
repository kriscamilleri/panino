<template>
    <AccountLayout
        :title="page?.title || 'Add-ons'"
        :max-width-class="page?.maxWidthClass || 'max-w-5xl'"
    >
        <p
            v-if="state === 'loading'"
            class="pn-body"
            data-testid="addon-page-loading"
        >Loading…</p>

        <div
            v-else-if="state === 'unavailable'"
            class="space-y-4"
            data-testid="addon-page-unavailable"
        >
            <p class="pn-body">{{ unavailableMessage }}</p>
            <BaseButton
                variant="primary"
                size="md"
                data-testid="addon-page-open-settings"
                @click="router.push('/settings')"
            >
                <Settings class="h-4 w-4" />
                <span>Open Settings</span>
            </BaseButton>
        </div>

        <div
            v-else
            :data-testid="`addon-page-${addonId}-${pageId}`"
        >
            <component
                :is="component"
                :query="route.query"
            />
        </div>
    </AccountLayout>
</template>

<script setup>
/**
 * The page an add-on contributes (docs/specs/active/addon-folders.md §6.2.5), at
 * `#/addons/:addonId/:pageId`. One fixed route serves every add-on page, so a
 * reload or a shared link works before the add-on list has loaded. The page is
 * looked up in the registry and rendered in the shared page shell; its code loads
 * only while the add-on is on. While the add-on is off, not offered, or has no such
 * page, this says so instead, including when it is switched off on this page.
 */
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Settings } from 'lucide-vue-next'
import AccountLayout from '@/components/AccountLayout.vue'
import BaseButton from '@/components/BaseButton.vue'
import { addonManifest } from '@/addons/registry'
import { useAddonsStore } from '@/store/addonsStore'

const route = useRoute()
const router = useRouter()
const addonsStore = useAddonsStore()

const loaded = ref(false)
const addonId = computed(() => String(route.params.addonId || ''))
const pageId = computed(() => String(route.params.pageId || ''))
const manifest = computed(() => addonManifest(addonId.value))
const page = computed(() => (manifest.value?.pages || []).find((entry) => entry.id === pageId.value) || null)
const offered = computed(() => Boolean(addonsStore.get(addonId.value)))
const active = computed(() => addonsStore.isActive(addonId.value))

const state = computed(() => {
    if (!loaded.value) return 'loading'
    return page.value && active.value ? 'ready' : 'unavailable'
})

const unavailableMessage = computed(() => {
    if (page.value && offered.value) {
        return `Turn on the ${addonsStore.get(addonId.value).name} add-on in Settings → Add-ons to use this page.`
    }
    return 'This page is not available.'
})

/** One async component per add-on page. */
const components = new Map()
const component = computed(() => {
    if (!page.value) return null
    const key = `${addonId.value}:${pageId.value}`
    if (!components.has(key)) components.set(key, defineAsyncComponent(page.value.component))
    return components.get(key)
})

onMounted(async () => {
    try {
        await addonsStore.fetchAddons()
    } catch {
        // The unavailable message covers a failed load.
    } finally {
        loaded.value = true
    }
})
</script>
