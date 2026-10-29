/**
 * How the GitHub backup add-on appears in the app (docs/specs/active/addon-folders.md §6).
 * Components load only through `() => import(…)`; keep it that way, so the
 * main bundle carries nothing of GitHub backup's but this file.
 */
import { Github } from 'lucide-vue-next'

export default Object.freeze({
    id: 'github',
    // The toolbar's Tools group only: a backup is not about the open Document,
    // so it stays out of the phone Document menu. Phones reach it from Settings.
    actions: [
        {
            id: 'backup',
            icon: Github,
            label: 'Backup',
            menuLabel: 'GitHub backup',
            hint: 'Back up your Documents to GitHub',
            requires: ['online'],
            surfaces: ['toolbar'],
            modal: 'backup',
        },
    ],
    modals: {
        backup: () => import('./components/GitHubBackupModal.vue'),
    },
    // Under the add-on's switch in Settings, desktop and phone (`layout` prop).
    // It also finishes the GitHub connection: the OAuth return lands on Settings.
    settingsCard: {
        component: () => import('./components/GitHubSettingsCard.vue'),
    },
})
