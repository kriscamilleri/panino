# Odoo integration: local Odoo, Phases 0–2 (verify, connect, PDF to Documents)

- **Agent:** Claude Code (Opus 5.5)
- **Started:** 2026-10-26 21:30
- **Status:** Phases 0, 1 and 2 done; Phase 3 (PDF to an opportunity or sales order) next
- **Branch:** `feature/odoo-integration` (off `develop`)
- **Spec:** `docs/specs/active/odoo-integration.md`

## Objective

Start the Odoo integration: stand up local Odoo to develop against, verify the Odoo behaviour the
spec assumed (Phase 0), and let a user connect their account to Odoo 19+ (Phase 1).

## Progress

- **Local Odoo.** `docker-compose.odoo.yml` + `scripts/odoo-dev.sh`: Odoo 19 Community
  (`localhost:8019`, `http://odoo:8069` from the API container, CRM + Sales + demo data) and, from
  an Enterprise `.deb` Kris supplied, Odoo 20 Enterprise (`localhost:8020`,
  `http://odoo-enterprise:8069`, adds Documents + Knowledge). Admin API keys go to the gitignored
  `.odoo-dev.env` / `.odoo-dev-ee.env`; `*.deb` is gitignored and the script refuses a `.deb`
  inside the repository. The existing `odoo18-staging-app` (another project's Enterprise 18
  staging) was inspected read-only and not used: Odoo 18 has no JSON-2 API, and it holds that
  project's data.
- **Phase 0.** Results are tables in spec §4. The ones that changed the design:
  - The file field differs by version and the wrong one fails silently: Odoo 19 needs `datas`
    (`raw` stores the base64 text); Odoo 20 removed `datas` (create returns 200 and stores 0 bytes)
    and needs `raw`. Uploads must pick the field per model and verify the attachment `checksum`.
  - `documents.document` has no `datas` in 20; one `create` with `raw` makes the document and
    file. On replace, the document's `file_size` goes stale; the attachment checksum is right.
  - `read` of a deleted record is `200 []`, not an error.
  - `access_url` / `article_url` use Odoo's own `web.base.url`; keep only the path.
  - Confirmed: chatter staging + internal note, escaped bodies, checklist markup, sanitizing,
    batch create, read-only roots with a write member, archive/unarchive, error shapes.
- **Phase 1.** Backend: `safeFetch.js` (extracted from `imageFetch.js`, generalized),
  `secrets.js` (extracted from `backup.js`, same stored format), `odooClient.js`, `odoo.js`
  routes, `odoo_connection` in `USER_LOCAL_SCHEMA`, flag + key + private-host allowlist in both
  Compose files, runbook section. Frontend: `utils/odooConnection.js`, `store/odooStore.js`,
  `OdooConnectionModal.vue` opened from Settings → Tools (desktop) and the phone Settings Tools
  list, only when the server has the integration on.

- **Phase 2 (2026-10-27).** `pdf.js` exposes `renderPdf(payload, { userId })` on the same queue,
  deadline and limits; `POST /render-pdf` is now a thin wrapper (all 31 PDF tests unchanged).
  `odoo_links` / `odoo_defaults` in both server-only schemas; `odooLinks.js`,
  `odooDocuments.js`; `fileField` (datas on 19, raw on 20, cached per database) and
  `verifyAttachment` (SHA-1 against Odoo's checksum) in `odooClient.js`; routes
  `GET …/folders`, `GET …/links`, `POST …/send` with a per-Document lock and 10 sends a minute.
  Frontend: `useDocumentPdfRequest` (Export's way of building the request), `OdooSendModal` from
  the desktop toolbar (Tools → Odoo) and the phone Document menu.

## Changes Made

- `backend/api-service/`: `safeFetch.js`, `secrets.js`, `odooClient.js`, `odoo.js` (new);
  `imageFetch.js`, `backup.js`, `db.js`, `index.js`; tests `unit/safeFetch`, `unit/secrets`,
  `unit/odooClient`, `integration/odoo`.
- `frontend/src/`: `utils/odooConnection.js`, `store/odooStore.js`,
  `components/OdooConnectionModal.vue` (new); `pages/SettingsPage.vue`,
  `pages/PhoneSettingsPage.vue`; test `tests/unit/odooConnection.test.js`.
- `docker-compose.odoo.yml`, `scripts/odoo-dev.sh`, `scripts/odoo-enterprise.Dockerfile` (new);
  `docker-compose.yml`, `docker-compose.dev.yml`, `.gitignore`, `docs/runbooks/deployment.md`,
  the spec.

## Tests

- `npm run test:be` (Docker): 37 files, 559 tests pass, including the existing image-fetch and
  GitHub backup suites after the two extractions.
- `npm run test:fe`: 71 files, 899 tests pass. `npm run lint`: clean (exit code checked; an
  earlier run piped through `tail` hid a failing exit and a lint error was committed, then fixed
  by amending the unpushed commit).
- Live API against both local Odoo instances, as the disposable local test account: connect to
  19 (CRM, Sales) and 20 Enterprise (all four apps), key never in a response, wrong database →
  `not_odoo`, wrong key → `key_rejected`, `169.254.169.254` refused, a failed attempt keeps the
  existing connection.
- Browser (Puppeteer, dev stack), 15/15: phone 390 px and desktop 1280 px; Tools entry, connected
  summary, change form starts with an empty password field, switch 19 ↔ 20, disconnect, wrong key
  message and field cleared, no horizontal overflow, styles loaded. Screenshots checked; one fix
  (the user's name broke mid-word: `break-all` → `break-words`).

- Phase 2 tests: backend 38 files / 577 tests (new `integration/odooSend` against a fake Odoo
  that reproduces the 19/20 file-field behaviour, deleted records as `[]`, and spaces: an editor
  sends, the owner updates the same record, an outsider gets 404); frontend 72 files / 907 tests;
  lint clean. Browser, 16/16 against local Odoo 20 Enterprise: phone menu → folder search → send →
  the PDF is in Finance / Sales with the right name and owner, is a real PDF and matches Odoo's
  checksum; resend shows "Sent just now by Capture Test", updates the same document with new
  bytes; desktop toolbar opens the same state. The harness first reported the routes as broken:
  the dev API runs `node` without a watcher and needed a restart to load them.

## Open Items / Notes

- Phase 3 (PDF to an opportunity or sales order) is next.
- 2026-10-27: Odoo became an optional add-on (`docs/specs/proposed/addons.md`). The add-on
  framework is the new Phase 3 of the Odoo spec; chatter and everything after moved up one.
- In the dev stack "Open in Odoo" points at `http://odoo-enterprise:8069`, the container address
  the connection uses; a browser on the host needs `localhost:8020`. Production connections use
  the public URL.
- Folder picker: same-named folders under the same parent look identical.
- `ExportSheet` still builds its PDF request inline; it can move to `useDocumentPdfRequest`.
- Unverified: whether Odoo removes a staged chatter attachment after a failed `message_post`; Odoo
  19 Enterprise (no instance).
- Both local Odoo databases hold probe records (a note and PDFs on demo opportunity 27, "Panino
  probe root" articles, probe documents). Local demo data only.
- The Enterprise `.deb` used to build `panino-odoo-enterprise:20.0` sits in the session scratchpad;
  keep a copy outside the repository to rebuild the image later.
- `docs/specs/proposed/tag-system.md` has an unrelated uncommitted rewrite from elsewhere; left
  untouched.
