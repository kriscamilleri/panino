# Spec housekeeping: ship and deprecate specs, rewrite advanced search

- Agent: Claude Code (Opus 5.5)
- Start: 2026-11-08, 16:00
- Status: Done on `develop`, not committed

## Objective

Kris asked for three things:

- Move the finished specs out of `proposed/` and `active/`.
- Deprecate the AI editor pane, GitLab backup, calendar sync and PDF render hardening specs.
- Bring the advanced search spec up to date with everything shipped since March, and with the
  forthcoming tag spec.

## Progress

1. **Sorted the specs** by header and by searching the code. Release dates came from the
   first-parent merges on `main`.
2. **Moved 22 specs** with `git mv`, from a script that also rewrote every reference to them.
   - It resolved links in spec files from each file's old location, so sibling links still work.
   - A first pass also rewrote prose mentions such as `` `README.md` `` into wrong relative
     paths. These were found in the diff and restored.
3. **Status headers:**
   - Each shipped spec got `Status: shipped`, a `Shipped:` line with its release commit and agent
     logs, and an `Implementation:` line.
   - Each deprecated spec records the decision. PDF render hardening also records that phases 1–3
     are live and documented in `docs/architecture/pdf-pipeline.md`.
4. **Advanced search rewrite.**
   - Read the phone search (`docStore.searchDocuments`, `utils/searchQuery.js`,
     `PhoneSearchPage.vue`), the desktop sidebar filter (`Documents.vue`), the AI add-on's search
     and property filter, the shared front matter parser and the tag spec.

## Changes Made

- **To `shipped/`:**
  - collab-00 to collab-05, and the collab-04 phase 0 artifacts (live 2026-10-11, `d2f5ed5`);
  - dark-mode (2026-08-16), document-folder-image-import (2026-10-10);
  - addons, addon-folders, github-integration, odoo-integration, odoo-sales-order-blocks and
    odoo-overview (release #18, 2026-11-05);
  - llm-api and ai-integration (release #19, 2026-11-07);
  - ai-api-expansion (PR #20, 2026-11-08).
- **Odoo overview phase 3:** the header said it was not started. In fact "Refresh all" was
  already in `OdooDataBlockModal.vue` from the sales order blocks work. The header now says so,
  and notes the small differences from the spec.
- **To a new `deprecated/` folder:** ai-editor-pane, gitlab-backup, calendar-sync,
  pdf-render-hardening.
  - `docs/specs/README.md` describes the new folder.
  - The `feature-development` skill lists it.
- **References:** 149 files had their path rewritten, and only the path: code comments, READMEs,
  architecture docs, skills, compose files and non-archived agent logs. The diff has 208
  insertions and 208 deletions.
- **Three broken links fixed**, all predating this change:
  - `ui-design-system.md` → identity palette;
  - the folder-import agent log → its spec;
  - `recent-documents-redesign.md` → advanced search.
- **`proposed/advanced-search.md` rewritten.** Its key points:
  - One engine for phone and desktop.
  - The API's term and property-filter code moves to `shared/`, since core may not import an
    add-on.
  - Query parts: `title:`, `in:`, `tag:`, `is:checklist`, `prop:` and `-`.
  - Case folding for every letter.
  - The API's result order and paging.
  - A per-database metadata index, shared with tags.
  - A browser benchmark before deciding on FTS5.

## Tests

- `npx eslint --ignore-pattern '.claude/**' .`: clean.
- Link check (scratch script over tracked Markdown, plus every `docs/specs/<dir>/<name>.md`
  mention in any file):
  - 39 broken before the change, 34 after;
  - none of the remaining ones involve the moved specs. They are examples in specs and older
    historical paths.
- No code changed, so the test suites were not run.

## Open Items / Notes

- **Found while rewriting the search spec, not fixed:**
  - Recent searches (`panino-recent-searches`) survive sign-out. The spec makes this phase 1
    work.
  - The phone's Checklists scope filters after the SQL limit, so a page can come back short.
  - Phone search misses other cases of non-ASCII letters.
- **The tag spec needs aligning** when it is revised (search spec §7):
  - It cites the old `markdownStore.js` parser.
  - The shared parser does not read `tags:` list items.
  - Its index should be the same as search's metadata index.
- `docs/specs/active/` is now empty.
- **Kris decided Q1–Q4** (2026-11-08); the spec records them in §12:
  - the full search replaces the sidebar's name-only filter;
  - Trash is left out of search in the app and the API alike. One shared rule decides which
    folder is Trash, and `in:Trash` includes it. Kris first chose to include Trash in the app,
    then unified both on leaving it out;
  - properties can be typed as `prop:` or chosen with a picker that writes `prop:`;
  - the API's search accepts the same parts in phase 1.
