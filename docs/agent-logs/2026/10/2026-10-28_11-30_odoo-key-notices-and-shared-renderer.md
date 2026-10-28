# Odoo integration — Phase 7 (key lifecycle) and Phase 8 (shared renderer)

- **Agent:** Claude Code (Fable 5.1)
- **Start:** 2026-10-28 11:30
- **Status:** Done

## Objective

Phases 7 and 8 of [`docs/specs/active/odoo-integration.md`](../../../specs/active/odoo-integration.md):
key expiry and rejection notices everywhere (with rotation if Odoo allows it), and one Markdown
renderer shared by the frontend and the API with fixtures proving parity.

## Progress

### Phase 7

- Probed the local Odoo 19 Community: `res.users.apikeys/generate` and `/revoke` answer 404 "The
  method … does not exist" through JSON-2 (`_generate` is private), while `search_read` on
  `res.users.apikeys` works. So rotation stays manual (Settings → Change key or address); the
  spec's §4 table records it.
- `OdooKeyNotice.vue`: the expiry warning (from 14 days before, via `keyExpiryMessage`) or the
  connection's `lastErrorMessage` (rejected key, unreachable, …), optionally with an "Open
  Settings" link. Mounted under the Odoo switch on desktop and phone Settings and at the top of
  the send sheet; a send answered `key_rejected` adds a pointer under the results.

### Phase 8

- `shared/markdownRender.js` (`createDocumentRenderer`, `renderDocumentHtml`,
  `applyDocumentVariables`, `normalizeVariableName`) and `shared/frontMatter.js` moved from the
  frontend, exported as `@panino/content-merge/markdown-render` and `/front-matter`. `markdown-it`
  and `markdown-it-task-lists` added to `shared/package.json` with the lockfile regenerated under
  the pinned Node 24.19.0 (`docker run … node:24.19.0 npm install`), as AGENTS.md asks.
- `markdownStore` builds its renderers on `createDocumentRenderer()` and delegates variable
  substitution; `frontend/src/utils/frontMatter.js` re-exports; the Knowledge send's
  `utils/odooArticle.js` renders through the shared module.
- `shared/tests/fixtures/document.{md,html}` is the recorded rendering (front matter, variables
  with the three precedence levels, task lists, lists, quote, table, code, image, typographer,
  linkify, raw HTML). Three suites render it and compare bytes: `shared/tests/markdownRender.test.js`,
  `frontend/tests/unit/odooArticle.test.js`, `backend/api-service/tests/unit/sharedRender.test.js`.
- Headless Preview check after the switch: front-matter variable, `GLOBAL_DATE`, task list
  checkbox, typographer, linkify and the inline preview styles all still render; no page errors.

## Changes Made

- Phase 7: `frontend/src/components/OdooKeyNotice.vue` (new), `OdooSendModal.vue`,
  `pages/SettingsPage.vue`, `pages/PhoneSettingsPage.vue`, `tests/unit/odooKeyNotice.test.js`
  (new, 4), `tests/unit/odooSendModal.test.js` (+1).
- Phase 8: `shared/markdownRender.js`, `shared/frontMatter.js`, `shared/tests/markdownRender.test.js`,
  `shared/tests/fixtures/`, `shared/package.json` and lockfile; `frontend/src/store/markdownStore.js`,
  `frontend/src/utils/frontMatter.js`, `frontend/src/utils/odooArticle.js`,
  `frontend/tests/unit/odooArticle.test.js`; `backend/api-service/tests/unit/sharedRender.test.js`.
- Docs: spec §4 row and Phases 7–8 ✅; `frontend/AGENTS.md`, `backend/api-service/AGENTS.md`.

## Tests

- `npm run test:shared`: 3 files, 46 tests passed.
- Frontend Odoo tests: key notice 4, send modal 18, article 4; `npm run test:fe`: 76 files,
  937 tests passed.
- Backend Docker run of `sharedRender`, `odooKnowledge` unit and integration: 20 passed;
  `npm run test:be`: 44 files, 627 tests passed.
- `npm run lint`: clean. Headless Preview check: 7/7.

## Open Items / Notes

- `GLOBAL_DATE` / `GLOBAL_TIME` use the renderer's locale; the server will need the account's
  locale (or a fixed format) when it renders for syncs in Phase 9.
