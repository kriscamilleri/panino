# AI agents add-on: expanding the v1 API and MCP tools

- Agent: Claude Code (Opus 5.5), with five Opus 5.5 subagents (one per area, each in a worktree)
- Start: 2026-11-07, 19:30
- Status: Built and tested on `feature/ai-api-expansion`; not pushed, not merged

## Objective

After the first release of the AI agents add-on, Kris asked to find the gaps in the MCP server and
REST API and fill them. The gaps were:

- more Document and folder information;
- search;
- revision history;
- images;
- templates, variables and PDF.

Mid-way Kris added Document properties: word count, created on and by, modified on and by. Spec,
with Kris's decisions E1–E5: [`ai-api-expansion.md`](../../../specs/proposed/ai-api-expansion.md).

## Progress

1. **Gaps found** (see the spec §1). Kris decided four of them (2026-11-07):
   - restore is allowed and undoable;
   - images can be read and uploaded, and deleted only when unused;
   - folders can be renamed, moved, trashed and restored;
   - templates and variables can be read and used, and Documents exported as PDF.
2. **Groundwork** (`d89e6ba`):
   - Shared rules moved to `serviceCore.js`.
   - Each area got one adapter in `api/<area>.js` (MCP tools, REST routes, OpenAPI paths,
     next-step sentences), collected by `mcpTools.js`, `restRoutes.js` and `openapi.js`.
   - Tool calls and REST handlers may be async.
   - `scripts/test-backend.sh` accepts `PANINO_TEST_IMAGE`, so parallel runs don't share an image
     tag.
3. **Five subagents**, one per area: Documents, Folders and Trash, Revisions, Images, and
   Templates/variables/PDF.
   - Each worked in its own worktree and owned its files.
   - Each worktree was created from `main`, so each agent fast-forwarded to `d89e6ba` first.
   - I merged each branch with `--no-ff`. The only conflicts were in the tool-count assertions.
     The unit test now keeps per-area tool lists, so later areas only add a block.
4. **Properties**, built by me:
   - Built-in properties come from revision history (`authorship.js`), since Documents have no
     author columns.
   - Front matter properties use the shared parser.
   - There is a filter language for queries.
   - Five tools and five routes.
5. **Merge review fixes:**
   - A core test imported the Odoo add-on (lint `panino/addon-boundaries`). That check moved into
     Odoo's own suite.
   - The Trash record went stale when `update_document` moved a Document out of Trash; now fixed.
   - Two duplicate imports from the merges.

## Changes Made

- **Add-on files:**
  - `serviceCore.js`, `documentService.js`, `documentText.js`, `folderService.js`
  - `propertyService.js`, `propertyText.js`, `authorship.js`
  - `revisionService.js`, `lineDiff.js`, `imageService.js`, `libraryService.js`
  - `api/*`, `schema.js` (`ai_trash_origins`, `schema.content`), `index.js`, `mcpTools.js`,
    `mcp.js`, `restRoutes.js`, `openapi.js`
- **Core:**
  - `image.js`: `storeImage` and the listing helpers are extracted; the app routes are unchanged.
  - `revision.js`: `restoreNoteRevision` is extracted; the app route is unchanged.
  - New `documentPdf.js`: the PDF request builder, moved out of Odoo's `syncPdf.js`, which
    re-exports it.
- **Shared:** `templateVariables.js`, exported as `@panino/content-merge/template-variables`.
  `{{input:…}}` values are now inserted literally (`$&` used to expand).
- **Frontend:** `utils/templateVariables.js` re-exports the shared module, and
  `TemplatePickerModal.vue` uses `resolveTemplateTitle`.
- **Docs:**
  - the spec;
  - `docs/architecture/public-api.md` (areas, and a new "What agents can do" section);
  - the add-on README.
- 41 MCP tools in all (previously 11).

## Tests

- **Subagents' runs** (each on its own branch): full backend suites of 964–1008 tests, all
  passing.
- **On the merged branch:**
  - `./scripts/test-backend.sh`: 75 files, 1160 passed.
  - `npm run test:fe`: 89 files, 1085 passed.
  - `shared`: 57 passed.
  - `eslint --ignore-pattern '.claude/**' .`: clean.
  - After the last instruction and usage-note edits, `addons/ai`: 17 files, 405 passed.
- **Dev stack:**
  - Restarted the API (`docker restart`, keeping its flags).
  - With a local test account and API key, exercised the new tools over MCP: create, outline,
    edit, insert, section read, set property, read properties, query by property, list revisions,
    compare, upload image, append its Markdown, get image (MCP image content), delete refused
    while in use, list templates and variables, export PDF (embedded `application/pdf`, 1 page),
    create folder, move a Document into it, trash the folder, list Trash, restore.
- **Browser** (Chrome, localhost):
  - After sync, the app showed the API's edits, the restored folder and the front matter, and the
    uploaded image loaded in the Preview.
  - "New from template" (Bug Report) with the title `Retry $& works` gave
    "Bug Report: Retry $& works". The API's create-from-template gave the same title and front
    matter.
  - On the first try the browser ran stale code, because the dev Vite server (up 8 days, HMR
    socket not connecting) had missed the merged files. A `docker restart` of the frontend
    container fixed it. It was not a code defect.

## Open Items / Notes

- Not pushed or merged. Release needs the usual deploy pre-flight. The new `ai_trash_origins`
  table is created on each content database as it opens.
- **Core revision ordering:** found by two agents. `getLatestRevision` and the app's revision
  list order by `datetime(created_at)` (seconds), so revisions within the same second compare
  against a random one of them. The API orders by `created_at, rowid`. This is worth a separate
  core fix.
- `get_document` with no range still returns up to 2 MiB of text, for compatibility.
- PDF export has no per-agent limit beyond the queue cap and the agent rate limit.
- Template `{{today}}`/`{{now}}` use the server's time zone, as Odoo syncs already do.
- Local dev data left in place:
  - the account `ai-expansion-check@example.test`, its key, Documents, folder and image;
  - scratch credentials in the session scratchpad.
- The agents' worktrees are still under `.claude/worktrees/`, with their branches. Root
  `npm run lint` scans them, so lint with `--ignore-pattern '.claude/**'` until they are removed.
