/**
 * An add-on's return from an outside service, such as an OAuth callback, lands on
 * Settings as `?addon=<id>&addonResult=…&addonMessage=…` (docs/specs/active/addon-folders.md
 * §6.2). While the add-on is on, its settings card reads that and finishes the job. While
 * it is off the card is absent, so Settings shows the message itself and clears the
 * query, rather than leaving it unexplained in the address bar.
 */
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAddonsStore } from '@/store/addonsStore'
import { useUiStore } from '@/store/uiStore'

/** The query keys an add-on return uses; a card clears these once it has read them. */
export const ADDON_RETURN_KEYS = Object.freeze(['addon', 'addonResult', 'addonMessage', 'handle'])

/** The query without the add-on return keys. */
export function withoutAddonReturn(query) {
    const next = { ...query }
    for (const key of ADDON_RETURN_KEYS) delete next[key]
    return next
}

export function useAddonReturn() {
    const route = useRoute()
    const router = useRouter()
    const addonsStore = useAddonsStore()
    const ui = useUiStore()

    watch(() => [route.query.addon, addonsStore.isLoaded], async () => {
        const id = route.query.addon
        if (typeof id !== 'string' || !id || !addonsStore.isLoaded) return
        if (addonsStore.isActive(id)) return
        const message = typeof route.query.addonMessage === 'string' && route.query.addonMessage
            ? route.query.addonMessage
            : 'That add-on is off. Turn it on in Settings → Add-ons first.'
        ui.addToast(message, 'error')
        await router.replace({ query: withoutAddonReturn(route.query) })
    }, { immediate: true })
}
