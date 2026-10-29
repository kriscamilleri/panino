# GitHub Backup Add-on — Spec

> GitHub backup, moved from core into an add-on under the add-on framework.
> Status: active — implemented 2026-10-29, not yet deployed
> Created: 2026-10-29
> Principle (Kris, 2026-10-29): every integration with an outside service is an add-on.
> What the backup does is unchanged and is specified in
> [`../shipped/github-backup.md`](../shipped/github-backup.md). This spec covers only what the move
> changes.
> Framework: [`addons.md`](addons.md), [`addon-folders.md`](addon-folders.md).

---

## 1) Summary

GitHub backup was core code: `backup.js`, the `backup_config` table in `db.js`, a direct call
from `sync.js`, and a Backup button, modal and phone Settings entry in core components. It now
lives in `backend/api-service/addons/github/` and `frontend/src/addons/github/`, and core reaches
it only through the add-on registries.

| | Before | After |
|---|---|---|
| Offered | Always (the modal said when OAuth was not set up) | When `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set |
| Per user | Always visible | Off by default; the user switches it on in Settings → Add-ons |
| Routes | `/backup/github/…` | `/addons/github/…` behind `requireAddon('github')` |
| OAuth callback | `GET /backup/github/callback` | `GET /addons/github/callback` (public add-on route) |
| OAuth return lands on | `/#/?githubBackup=…` (HomePage) | `/#/settings?githubBackup=…` (the add-on's settings card) |
| Daily backup | `sync.js` called `triggerDailyAutoBackup` | `afterSyncRequest` hook; also needs the add-on on |
| Table | `backup_config` in core `USER_LOCAL_SCHEMA` | Same table and name, in the add-on's `schema.user` |
| Desktop entry | Core Tools button | Add-on action, Tools group, toolbar only |
| Phone entry | Core Settings → Tools row | The add-on's settings card |

## 2) What leaves Panino, and as whom

Unchanged: a snapshot of the user's **personal** Documents, folders and images, committed to a
repository they pick, under their GitHub account, with an OAuth token (`repo` scope). Shared
spaces are not backed up.

## 3) Operator variables

| Variable | Use |
|---|---|
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | The OAuth app. Both set: the add-on is offered. No separate `*_ENABLED` flag, so a server that offered backup before still offers it. |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Token encryption key. Falls back to `JWT_SECRET`, as before; the shipped `docker-compose.yml` does not pass it, so production uses `JWT_SECRET`. A startup warning says so. Changing the key in use disconnects every user. |
| `PUBLIC_API_BASE_URL`, `FRONTEND_URL` | As before, to build the callback and return URLs. |

**The OAuth app's callback URL must change** to `<PUBLIC_API_BASE_URL>/addons/github/callback`
(production: `https://panino.sh/api/addons/github/callback`). A GitHub OAuth app has one callback
URL, and GitHub refuses a `redirect_uri` outside it, so connecting fails until the app is
updated. Daily backups for users already connected keep running either way: they need no callback.

## 4) Carrying existing users over

Off by default would stop the daily backup of everyone who had connected. The add-on's
`schema.upgrade` therefore runs, on every user database as it opens:

```sql
INSERT OR IGNORE INTO addons (addon_id, enabled, enabled_at)
SELECT 'github', 1, :now
WHERE EXISTS (SELECT 1 FROM backup_config WHERE provider = 'github' AND access_token_enc IS NOT NULL)
```

- A user with a stored token is switched on, once.
- A user who never connected gets no row and stays off.
- `INSERT OR IGNORE` never touches a row the user set, so turning it off sticks.

`schema.upgrade` also carries the column upgrades for old `backup_config` tables that used to be
`ensureBackupConfigSchema` in `db.js`.

## 5) Routes

Mounted at `/addons/github` behind `requireAddon('github')`, except the callback:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/status` | |
| `POST` | `/connect` | Returns the GitHub authorize URL with a signed 10-minute `state` |
| `DELETE` | `/disconnect` | Revokes the grant, deletes `backup_config`. 409 while a backup runs |
| `GET`, `POST` | `/repos` | List pushable repositories; create a private one |
| `PUT` | `/repo` | Select a repository (push access required) |
| `POST` | `/run` | Start a backup; 409 while one runs |
| `GET` | `/callback` | **Public** (`publicRoutes`): no Panino token. Verifies `state`, then refuses unless the user still has the add-on on, then stores the token |

The bodies and errors are as before. They still pass some upstream messages through, as they did
in core (§8).

## 6) Switching off

No `onDisabled` hook is needed. The routes answer 403 `addon_disabled`, the daily backup checks
`isAddonActive` before it starts, and the callback refuses. The connection and repository stay
in `backup_config`, so switching back on resumes. Disconnect is still the only thing that removes
the token.

## 7) Extension points added to core

Each is generic, documented in [`addon-folders.md`](addon-folders.md), and tested with the probe
add-on in `backend/api-service/tests/integration/addonsRegistry.test.js` or the probe manifest in
`frontend/tests/unit/addonContributions.test.js`:

- **`publicRoutes`** in the backend manifest, mounted by `mountAddonPublicRoutes(app)` before
  `authenticateToken`, behind the offered check only.
- **`schema.upgrade(db, kind)`**, run after the add-on SQL, for idempotent column upgrades and
  one-time data steps.
- **`surfaces`** on a frontend action (`['toolbar']`, `['menu']`), so an action that is not
  about the open Document can stay out of the phone Document menu.

## 8) Open items

- Some route errors still return upstream GitHub messages (`error.message`) rather than closed
  codes (add-on rule 5). That was true in core and is left for a follow-up.
- GitHub calls use `fetch` directly, not `safeFetch.js`. The URLs come from operator settings
  (`GITHUB_API_URL`, `GITHUB_OAUTH_URL`), never from users, so there is no SSRF path.
