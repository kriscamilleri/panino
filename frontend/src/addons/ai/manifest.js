/**
 * How the AI agents add-on appears in the app (docs/specs/active/ai-integration.md §9).
 * Components load only through `() => import(…)`, so the main bundle carries
 * nothing of the add-on's but this file.
 */
export default Object.freeze({
    id: 'ai',
    // Under the switch in Settings, desktop and phone: MCP setup, connected
    // apps and API keys.
    settingsCard: {
        component: () => import('./components/AiSettingsCard.vue'),
    },
    // #/addons/ai/authorize: where an app's OAuth sign-in asks for consent.
    pages: [
        { id: 'authorize', title: 'Connect an app', maxWidthClass: 'max-w-xl', component: () => import('./components/AuthorizePage.vue') },
    ],
})
