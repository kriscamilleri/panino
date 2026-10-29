# GitHub backup add-on (API)

Backs up a user's personal Documents, folders and images to a GitHub repository they choose:
by hand, or once a day after a personal sync.

- Spec: [`docs/specs/active/github-integration.md`](../../../../docs/specs/active/github-integration.md);
  the backup itself in [`docs/specs/shipped/github-backup.md`](../../../../docs/specs/shipped/github-backup.md).
- How add-ons plug into core: [`docs/specs/active/addon-folders.md`](../../../../docs/specs/active/addon-folders.md).
- The app side lives in [`frontend/src/addons/github/`](../../../../frontend/src/addons/github/).

## Manifest (`index.js`)

| Field | Value |
|---|---|
| `isOffered` | `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are both set |
| `routes` | `githubRoutes`: status, connect, disconnect, repos, repo, run |
| `publicRoutes` | `githubPublicRoutes`: the OAuth `GET /callback`, which checks `state` and the switch itself |
| `schema` | `user`: `backup_config`; `upgrade`: old columns, and switching the add-on on for users connected before it was an add-on |
| `hooks.afterSyncRequest` | `triggerAutoBackupAfterSync`: personal databases only, when the add-on is on and the last backup is 24 hours old |
| `configWarnings` | `GITHUB_TOKEN_ENCRYPTION_KEY` not set (tokens fall back to `JWT_SECRET`) |

## Files

| File | Role |
|---|---|
| `index.js` | The manifest |
| `routes.js` | The routes, relative to `/addons/github` |
| `backup.js` | GitHub OAuth and API calls, `backup_config` access, the snapshot, backup jobs, the daily trigger |
| `schema.js` | `backup_config` and `upgradeGithubSchema` |
| `tests/integration/backup.test.js` | Connect, repositories, a backup run, missing-image warnings (`fetch` mocked) |
| `tests/integration/addon.test.js` | Offered or not, the gate on every route, the callback while off, the daily trigger, carrying users over |
