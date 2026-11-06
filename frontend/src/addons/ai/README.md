# AI agents add-on (frontend)

The browser side of the AI agents add-on
([`docs/specs/active/ai-integration.md`](../../../../docs/specs/active/ai-integration.md)).

## Contribution points

- `settingsCard` → `components/AiSettingsCard.vue`, under the switch in Settings (desktop and
  phone): MCP setup (`McpSetup.vue`), connected apps (`ConnectedApps.vue`), API keys
  (`ApiKeysSection.vue`).
- `pages` → `authorize` (`components/AuthorizePage.vue`) at `#/addons/ai/authorize`: the OAuth
  consent page an app's sign-in lands on (`?request=<id>`, or `?error=<code>`).

## Files

| File | Contents |
|---|---|
| `manifest.js` | Contribution points; components load lazily |
| `store.js` | `useAiAddonStore`: keys, connected apps, setup, consent calls (`/addons/ai/*`) |
| `utils/apiKeys.js` | Key form options and labels |
| `utils/mcpSetup.js` | Setup steps and snippets per MCP client |
| `tests/` | Store, components, helpers |
