# Add-on pages, and the Odoo overview

- Agent: Claude Code (Opus 5.5)
- Start: 2026-11-02, approximately 09:00
- Status: Implemented and verified locally on `feature/addons-menu`; not committed

## Objective

The Odoo overview spec (2026-11-01) had the overview as a wide dialog because add-ons could not
add pages. Kris said a dialog does not meet the requirement and asked what pages would take,
then to proceed: add page support for add-ons, then build the overview (spec Phase 1) on it.

## Progress

- Pages for add-ons: one fixed route rather than routes added at runtime, so a reload or a
  shared link works before the add-on list loads. The page renders in `AccountLayout`, the shell
  Images, Spaces and Templates use, which already works at phone width.
- Overview backend: per-database rows in `overview.js`; "changed since sent" from a new
  `odoo_links.sent_hash` stamped by every manual send (pinning moves `updated_at`, so the edit
  time is only a fallback for older links). `/resend` reuses the send code (Knowledge and
  Documents steps extracted from `/send` into helpers) with server rendering, as sync does.
- Changed from the spec while building, and recorded in it:
  - A press of Send updates counts as one send against the 10-a-minute limit; counting each
    Document would make a 25-Document press fail after ten.
  - Spaces have only owners and editors, so there is no viewer case.
- Browser findings that changed the code:
  - `AddonPage` put its test id on the page component, which overrode the page's own root id.
    It now sits on a wrapper.
  - Send update buttons stretched to row height; the place filter was full width; a sent row
    repeated "Sent just now." under a state line that already said so. Fixed. Send update now
    shows on changed rows only (desktop and phone); other rows go through ticking or the
    Send dialog.

## Changes Made

Core:
- `frontend/src/pages/AddonPage.vue` (new), route `addon-page` at `#/addons/:addonId/:pageId` in
  `router.js`; `AddonActions.vue`: an action with `page` goes to it.
- Docs: `addon-folders.md` §6.2.5, `frontend/AGENTS.md`, the `add-on-development` skill.

Odoo backend (`backend/api-service/addons/odoo/`):
- `overview.js` (new); `schema.js` (`sent_hash`, `upgradeOdooSchema`), `index.js` (registers the
  upgrade); `routes.js` (`GET /overview`, `POST /resend`, `knowledgeDestination` and
  `documentsDestination` shared with `/send`, which now stamps `sent_hash`);
  `syncScheduler.js` exports `globalsOf`.

Odoo frontend (`frontend/src/addons/odoo/`):
- `components/OdooOverviewPage.vue` (new); `manifest.js` (`overview` action, `pages`);
  `store.js` (`fetchOverview`, `resend`); `OdooSettingsCard.vue` (Overview, desktop and phone);
  `OdooSyncsCard.vue` (Open overview in a space, every failure named, not three).

Docs: `docs/specs/proposed/odoo-overview.md` (a page; phases; limits), both Odoo READMEs.

## Tests

- New: `addons/odoo/tests/integration/overview.test.js` (14: states, hash and fallback, pin,
  chatter, deleted, other Odoo, sync failed and paused, 500 cap, another member's send, a left
  space, `/resend` updating without creating, chatter skipped, synced skipped, input and auth
  refusals, the rate limit); `src/addons/odoo/tests/overviewPage.test.js` (8);
  `tests/unit/addonContributions.test.js` (+5: page action, page on/off/not offered/unknown,
  waiting for the list, following the switch).
- `npm run lint`: clean. `npm run test:fe`: 87 files, 1069 tests passed, rerun after the last
  layout fix. `npm run test:be` (Docker): 54 files, 735 tests passed.
- `vite build`: `OdooOverviewPage` is its own 10 kB chunk.
- Headless Chromium (`scratchpad/odoo-overview/check.mjs`) against the dev stack and local Odoo 20
  Enterprise, with a throwaway account and a Writers space: Add-ons → Odoo overview opens
  `#/addons/odoo/overview`; Needs attention 2 of 5 after editing two sent Documents (one in the
  space); ticking both and Send updates → Needs attention 0, "Everything is up to date"; All shows
  the Knowledge and Documents links; with the add-on off the page says to turn it on; phone
  Settings → Odoo → Overview opens the page with no tick boxes. 16/16, no page errors.

## Open Items / Notes

- Phase 3 (Refresh all for sales order blocks) is not started.
- Throwaway dev accounts `odoo-overview-<timestamp>@example.test` and `odoo-phone-<timestamp>@example.test`
  remain, connected to the local Odoo, with seeded PDFs and an article there.
- The dev API container was restarted to load the new backend files.
- `feature/addons-menu` holds four uncommitted pieces of work: the Add-ons menu, sidebar spaces
  and My Notes, Update mode, and this. Add-on pages (core) can be a commit of its own.
