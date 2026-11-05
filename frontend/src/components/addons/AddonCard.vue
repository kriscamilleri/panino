<template>
    <component
        :is="component"
        v-if="component && addonsStore.isActive(addonId)"
        v-bind="bindings"
        :data-testid="testId"
    />
    <p
        v-else-if="contribution?.whenOff && addonsStore.get(addonId)"
        class="pn-help"
        :data-testid="`${testId}-hint`"
    >{{ contribution.whenOff }}</p>
</template>

<script setup>
/**
 * One add-on's card at a contribution point (docs/specs/active/addon-folders.md
 * §6.2): `settingsCard` under its switch in Settings, `spaceCard` on the Spaces
 * page. Renders the card while the add-on is on; while it is offered but off,
 * the manifest's `whenOff` line if it has one; otherwise nothing.
 */
import { computed } from 'vue'
import { addonManifest } from '@/addons/registry'
import { useAddonsStore } from '@/store/addonsStore'

const cardProps = defineProps({
    addonId: { type: String, required: true },
    point: { type: String, required: true, validator: (value) => ['settingsCard', 'spaceCard'].includes(value) },
    /** settingsCard: 'desktop' or 'phone'. */
    layout: { type: String, default: 'desktop' },
    /** spaceCard: { spaceId }. */
    context: { type: Object, default: () => ({}) },
})

const addonsStore = useAddonsStore()

const contribution = computed(() => addonManifest(cardProps.addonId)?.[cardProps.point] || null)
const component = computed(() => (contribution.value ? cachedComponent(cardProps.addonId, cardProps.point, contribution.value.component) : null))
const bindings = computed(() => ({
    ...(cardProps.point === 'settingsCard' ? { layout: cardProps.layout } : {}),
    ...(typeof contribution.value?.props === 'function' ? contribution.value.props(cardProps.context) : {}),
}))
const testId = computed(() => (cardProps.point === 'spaceCard' ? `space-addon-${cardProps.addonId}` : `settings-addon-${cardProps.addonId}`))
</script>

<script>
import { defineAsyncComponent } from 'vue'

/** One async component per add-on card, shared by every AddonCard. */
const cards = new Map()
function cachedComponent(addonId, point, loader) {
    const key = `${addonId}:${point}`
    if (!cards.has(key)) cards.set(key, defineAsyncComponent(loader))
    return cards.get(key)
}
</script>
