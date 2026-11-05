# GitHub backup becomes an add-on

- Agent: Claude Code (Opus 5.5)
- Start: 2026-10-29, approximately 22:00
- Status: Implemented and verified locally; not committed, not deployed

## Objective

Kris set a principle: every integration with an outside service is an add-on. Move GitHub
backup out of core and onto the add-on framework built in
[`2026-10-29_21-00_addon-folders.md`](2026-10-29_21-00_addon-folders.md). Spec:
[`github-integration.md`](../../../specs/active/github-integration.md).

## Progress

- Mapped the core footprint: `backup.js` (routes, OAuth, snapshot, jobs), `backup_config` and
  `ensureBackupConfigSchema` in `db.js`, the `triggerDailyAutoBackup` call in `sync.js`, the
  public callback in `index.js`; on the app side the store, modal, progress util, the Tools
  button, the phone Settings row, the `HomePage` modal and OAuth-return watcher, and the
  `uiStore` flags.
- Three things core could not do yet, each added as a generic extension point:
  - **`publicRoutes`**: the OAuth callback arrives from GitHub without a Panino token, so it
    cannot sit behind `requireAddon`. Mounted before `authenticateToken` behind the offered
    check only; the callback verifies the signed `state`, then checks the user's switch.
  - **`schema.upgrade(db, kind)`**: for the old `backup_config` column upgrades and the one-time
    switch-on below, which plain idempotent SQL cannot express.
  - **Action `surfaces`**: Backup is not about the open Document, so it is toolbar-only and stays
    out of the phone Document menu. Phones reach it through the settings card.
- **Carrying users over.** Off by default would silently stop the daily backup of everyone
  connected. `upgradeGithubSchema` does `INSERT OR IGNORE` an enabled `addons` row when a token
  is stored, so connected users stay on and a switch the user sets is never overridden.
- **Offered** when `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set; no new `*_ENABLED`
  variable, so production keeps offering it.
- **OAuth return** now lands on `/#/settings?githubBackup=…`; `GitHubSettingsCard` opens the
  dialog, toasts and clears the query. Core `HomePage` no longer knows about it.
- `UPLOADS_DIR` in the moved `backup.js` resolves two levels up to the core upload root.
- **Found in the carried-over migration:** SQLite refuses `ADD COLUMN … DEFAULT (datetime('now'))`,
  so a `backup_config` without `created_at` could never have upgraded. Now a constant default
  plus an `UPDATE`; covered by a test.
- Production does **not** pass `GITHUB_TOKEN_ENCRYPTION_KEY` through `docker-compose.yml`, so
  tokens there are encrypted with `JWT_SECRET`. Left alone (setting the key would disconnect
  everyone); a startup warning and the README say so.

## Changes Made

- Backend: `backup.js` → `addons/github/backup.js` (`git mv`); new `addons/github/routes.js`,
  `schema.js`, `index.js`, `README.md`; `addons/index.js` imports it. Core: `registry.js`
  (`publicRoutes`, `mountAddonPublicRoutes`), `db.js` (`backup_config` and its migration
  removed, `schema.upgrade` added), `index.js`, `sync.js`.
- Frontend: store, modal, progress util and tests → `src/addons/github/` (`git mv`); new
  `manifest.js`, `components/GitHubSettingsCard.vue`, `README.md`, `tests/settingsCard.test.js`;
  `addons/registry.js` lists it. Core: `AddonActions.vue` (`surfaces`), and GitHub removed from
  `HomePage.vue`, `SubMenuBar.vue`, `PhoneSettingsPage.vue`, `uiStore.js`.
- Tests: `tests/integration/backup.test.js` → `addons/github/tests/integration/backup.test.js`;
  new `addons/github/tests/integration/addon.test.js`; probe cases for `publicRoutes` and
  `schema.upgrade` in `tests/integration/addonsRegistry.test.js` and for `surfaces` in
  `frontend/tests/unit/addonContributions.test.js`; Odoo's add-on test and `db.test.js` no
  longer assume Odoo is the only add-on or that `backup_config` is core.
- Docs: `docs/specs/active/github-integration.md` (new), `addon-folders.md`, `addons.md`,
  `shipped/github-backup.md`, `architecture/data-model.md`, `README.md`, both `AGENTS.md` files.

## Tests

- `npm run lint`: clean.
- `npm run test:be` (Docker): 52 files, 707 tests passed. The first run had two failures in the
  new add-on test (a test that called `/status`, which clears an undecryptable fake token; and
  the `created_at` migration bug above); both fixed, then the full suite rerun green.
- `npm run test:fe`: 83 files, 1033 tests passed.
- `vite build`: `GitHubBackupModal` and `GitHubSettingsCard` in their own chunks, not `main`.
- Removal check: with the add-on's line commented out of both registries, lint, the core
  backend tests (`npx vitest run --dir tests`, 35 files, 547 tests, with `scripts/` mounted for
  the two backup-script tests) and the frontend tests and build passed. Lines restored.
- Browser, desktop (Claude in Chrome, dev stack): off → no Backup in Tools and no core button;
  Settings → Add-ons lists "GitHub backup", off. On → card appears (after a reload; the open
  page held a module graph from before the files existed), dialog opens with no errors,
  `/addons/github/connect` returns an authorize URL whose `redirect_uri` is
  `http://localhost:8000/addons/github/callback`. `/#/settings?githubBackup=error&message=…`
  opens the dialog, toasts and clears the query. Tools shows Backup, which opens the dialog.
  The dev user's switch was put back to off afterwards. Did not click Connect (would leave for
  github.com).
- Browser, phone (headless Puppeteer 375×812, throwaway account, `--no-sandbox` because the host
  has no usable Chromium sandbox): off → no GitHub row in Settings; on → row present, dialog
  opens over Settings; off again → row gone. The phone Document menu was not opened (the
  throwaway account has no Document); its exclusion of toolbar-only actions is covered by the
  `surfaces` unit test.

## Open Items / Notes

- **Before deploying:** change the production GitHub OAuth app's callback URL to
  `https://panino.sh/api/addons/github/callback`. Until then, connecting fails; daily backups of
  connected users continue.
- Some route errors still pass GitHub's own message through, and GitHub calls use `fetch`
  rather than `safeFetch.js` (operator-set URLs only). Both as in core; listed in the spec.
- The throwaway account `github-phone-<timestamp>@example.test` remains in the dev auth
  database, and the Puppeteer script and screenshots remain in the session scratchpad.
