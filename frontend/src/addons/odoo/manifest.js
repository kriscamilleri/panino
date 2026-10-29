/**
 * How the Odoo add-on appears in the app (docs/specs/active/addon-folders.md §6).
 * Components load only through `() => import(…)`; keep it that way, so the
 * main bundle carries nothing of Odoo's but this file.
 */
import { Send, Sheet } from 'lucide-vue-next'

export default Object.freeze({
    id: 'odoo',
    // The toolbar's Tools group and the phone Document menu.
    actions: [
        {
            id: 'send',
            icon: Send,
            label: 'Odoo',
            menuLabel: 'Send to Odoo',
            hint: 'Send this document to Odoo',
            requires: ['online', 'document'],
            modal: 'send',
        },
        {
            id: 'data',
            icon: Sheet,
            label: 'Odoo data',
            menuLabel: 'Sales orders from Odoo',
            hint: 'Insert or refresh sales orders from Odoo',
            requires: ['online', 'document'],
            modal: 'data',
        },
    ],
    modals: {
        send: () => import('./components/OdooSendModal.vue'),
        data: () => import('./components/OdooDataBlockModal.vue'),
    },
    // Under the add-on's switch in Settings, desktop and phone (`layout` prop).
    settingsCard: {
        component: () => import('./components/OdooSettingsCard.vue'),
    },
    // On the Spaces page, for a space the user can edit.
    spaceCard: {
        component: () => import('./components/OdooSyncsCard.vue'),
        props: ({ spaceId }) => ({ dbKey: `space:${spaceId}`, spaceMode: true }),
        whenOff: 'Turn on the Odoo add-on in Settings → Add-ons to keep this space in sync with Odoo Knowledge.',
    },
})
