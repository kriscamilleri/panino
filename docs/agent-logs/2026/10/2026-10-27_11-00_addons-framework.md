# Add-ons framework: optional integrations, Odoo as the first (Odoo Phase 3)

- **Agent:** Claude Code (Fable 5.1)
- **Started:** 2026-10-27 11:00
- **Status:** Done; tests and browser checks below
- **Branch:** `feature/odoo-integration`
- **Specs:** `docs/specs/active/addons.md` (new), `docs/specs/active/odoo-integration.md` (§2, §5, §6, §8–§13)

## Objective

Kris asked that the Odoo integration, and every future external service integration, be an
optional add-on: offered by the operator, switched on per user, off by default. First the two
specs were written (the add-ons framework, and the Odoo spec reworked onto it with the framework
as its new Phase 3), then Kris asked for it to be implemented and tested.

## Progress

- **Backend.** `addons.js`: a manifest registry (`registerAddon`, called by `odoo.js` at load),
  `offeredAddons()`, `isAddonActive(userId, id)`, `setAddonEnabled()` with `onEnabled` /
  `onDisabled` hooks, the `requireAddon(id)` gate (404 while the operator does not offer the
  add-on, 403 `addon_disabled` until the user switches it on) and the routes `GET /addons` and
  `PUT /addons/:id/enabled`. The `addons` table joined `USER_LOCAL_SCHEMA` (no row: off). Every
  Odoo route moved from `/integrations/odoo` to `/addons/odoo` behind the gate.
- **Design correction found by the tests.** The spec first put the switch at `PUT /addons/:id`,
  which shadows the Odoo connect route `PUT /addons/odoo` once the generic router mounts first.
  The switch now lives at `PUT /addons/:id/enabled`; both specs say why.
- **Frontend.** `addonsStore` (`fetchAddons` once per session or forced, `isActive`,
  `setEnabled`), `AddonsSection.vue` for desktop Settings (switch per add-on, slot named after
  the add-on id for its card, inline "turn off?" question), the same section on
  `PhoneSettingsPage` with `.ph-switch`. The Settings → Tools → Odoo button is gone; the
  toolbar Tools → Odoo button and the phone Document menu entry render only when
  `addonsStore.isActive('odoo')`; the Odoo modals are `defineAsyncComponent` behind that check.
  `odooStore` lost `available` and treats 404 and `addon_disabled` as "no status".
- **Docs.** Runbook sentence, module rows in both `AGENTS.md` layer files, `addons.md` moved to
  `docs/specs/active/`, Odoo spec Phase 3 ticked.

## Changes Made

- `backend/api-service/`: `addons.js` (new); `db.js`, `index.js`, `odoo.js`, `AGENTS.md`;
  tests `integration/addons.test.js` (new), `integration/odoo.test.js`,
  `integration/odooSend.test.js` (new prefix; each user switches the add-on on first).
- `frontend/src/`: `store/addonsStore.js`, `components/AddonsSection.vue` (new);
  `store/odooStore.js`, `pages/SettingsPage.vue`, `pages/PhoneSettingsPage.vue`,
  `pages/HomePage.vue`, `components/SubMenuBar.vue`, `components/phone/DocumentMenuSheet.vue`;
  tests `addonsStore.test.js`, `addonsSection.test.js` (new), `odooConnection.test.js`,
  `odooSendModal.test.js`; `frontend/AGENTS.md`.
- `docs/specs/active/addons.md`, `docs/specs/active/odoo-integration.md`,
  `docs/runbooks/deployment.md`, this log.

## Tests

- `npm run test:be` (Docker): **39 files, 588 tests pass** (was 37 / 559 before Phase 2; the
  add-ons file adds 11). The first full run found the route shadowing (23 Odoo failures) and,
  after that fix, one real bug: switching an add-on on when it was already on reset
  `enabled_at`; the upsert now only stamps a change of state.
- `npm run test:fe`: **74 files, 919 tests pass** (12 new). `npm run lint`: clean.
- **Browser, phone width (Claude in Chrome, 652 px, dark theme, signed-in local test account):**
  Settings shows an Add-ons section with Odoo off and no Odoo entry under Tools; the switch turns
  it on with an "Odoo is on." toast and an "Odoo connection" row; the row opens the Odoo sheet
  (lazy-loaded); switching again shows the inline question with Turn off / Keep on; Keep on
  leaves it on; the phone Document menu shows "Send to Odoo" while on.
- **Browser, desktop 1280 px (headless Puppeteer from the backend's node_modules, a throwaway
  account made through `/signup`):** 20 of 21 checks pass: `GET /addons` lists Odoo off for a
  new account; `GET /addons/odoo` answers 403 `addon_disabled`; the Add-ons section renders with
  the switch off, no card, no Tools → Odoo button, no horizontal overflow; switching on shows the
  card and the toast, stores the switch on the server, opens the lazy-loaded connection modal,
  and puts the Odoo button in the toolbar Tools menu; after reload the switch is still on;
  turning off asks first (server still on while asking), then the card and the toolbar button
  go and the server stores off. The one failing check is a pre-existing console 404 from
  `GET /spaces` because `SHARED_SPACES_ENABLED` is off in the dev stack, unrelated to this work.
  Screenshots in the session scratchpad (`shots/desktop-*.png`).
- Harness traps, not product bugs: the Claude in Chrome window would not resize to desktop
  width (hence headless Puppeteer, as on 2026-10-25); on the second visit to Settings the PWA
  "Install Panino" prompt floated over the Odoo switch and swallowed the click until dismissed.

## Open Items / Notes

- The dev API runs `node` without a watcher; it was restarted twice to load the new routes.
- `onEnabled` / `onDisabled` hooks exist but the Odoo manifest does not use them yet: syncs
  (Odoo Phase 9) will pause and resume through them.
- Users who connected Odoo on a development stack before this change keep their connection; it
  reappears once they switch the add-on on.
- `docs/specs/proposed/tag-system.md` still carries an unrelated uncommitted rewrite from
  elsewhere; left untouched, not committed with this work.
