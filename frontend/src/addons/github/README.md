# GitHub backup add-on (app)

The app side of GitHub backup: the Backup action, the backup dialog, and its card in Settings.

- Spec: [`docs/specs/active/github-integration.md`](../../../../docs/specs/active/github-integration.md).
- How add-ons plug into core: [`docs/specs/active/addon-folders.md`](../../../../docs/specs/active/addon-folders.md).
- The API side lives in [`backend/api-service/addons/github/`](../../../../backend/api-service/addons/github/).

## Manifest (`manifest.js`)

| Contribution point | What GitHub backup puts there |
|---|---|
| `actions` | **backup** ("Backup"), needs a connection, `surfaces: ['toolbar']`: desktop Tools group only |
| `modals` | `backup` → `GitHubBackupModal` |
| `settingsCard` | `GitHubSettingsCard` (desktop and phone): opens its own backup dialog; the way in on a phone |

The server's OAuth return lands on `/settings?addon=github&addonResult=pending&handle=…` (or
`=error&addonMessage=…`). `GitHubSettingsCard` clears the query, hands the handle back through
`store.completeConnect` with this session's sign-in (that is what ties the GitHub account to the
person who pressed Connect), then shows a toast and opens the dialog. While the add-on is off,
core's `useAddonReturn` shows the message instead.

## Files

| File | Role |
|---|---|
| `store.js` | `useGithubBackupStore` (Pinia id `githubBackupStore`): status, repositories, connect and complete, run |
| `components/GitHubBackupModal.vue` | The backup dialog |
| `components/GitHubSettingsCard.vue` | The Settings card and the OAuth return |
| `utils/backupProgress.js` | Progress steps and labels for a running backup |
| `tests/` | Store, progress, settings card and manifest tests |
