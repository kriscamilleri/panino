# Integration: typewriter mode, TOC and internal links, tags, advanced search

- Agent: Claude Code (Opus 5.5), orchestrating four Opus 5.5 implementers and five Fable 5.1
  reviewers
- Start: 2026-11-08, 20:00
- Status: Done on `feature/pending-specs` (from `develop` 10b06f4); not pushed, not merged into `develop`

## Objective

Kris asked for the four pending specs to be built by four Opus agents, with a Fable review of each
as it finished. I was to interpret each review and make the fixes, then bring everything together
and test it in the browser, with screenshots.

Specs:
- `typewriter-mode.md`
- `editor-toc-and-internal-links.md`
- `tag-system.md` (revised first)
- `advanced-search.md`

## Progress

1. **Briefed four agents in parallel worktrees from 10b06f4.** Each brief named the other agents'
   files to keep edits additive in shared files. Ownership:
   - the tag agent owns the shared metadata index;
   - search was split into phases 1–2 and then 3–4, because 3–4 build on that index.
2. **Reviewed each branch independently (Fable 5.1).** Each reviewer got the code and the spec, not
   my conclusions. Fixes per branch, as I interpreted them:
   - **Typewriter** (one high, one medium): fixed by me. Details in the typewriter log.
   - **Tags** (three medium): fixed by me. Details in the tag log.
   - **TOC** (two medium): fixed by me. Details in the TOC log.
   - **Search 1–2** (three medium): I wrote the list of fixes and the search agent applied it.
     I checked the diff and reran the suites before merging.
   - **Search 3–4** (two medium): I wrote the list of fixes and the search agent applied it.
     Fixes:
     - a capped database's matches were skipped by "Show more" (now one cursor that never passes a
       capped database's window);
     - stale `tag:`/`prop:` results;
     - an index that was not ready was treated as complete;
     - the whitespace prefilter differed between the index, the API and the parser;
     - picker messages, overlapping popovers, date detection.
3. **Merged into `feature/pending-specs`.** Conflicts:
   - `Editor.vue`: typewriter and tags each added an overlay. Kept both.
   - `Documents.vue`: the search panel and the tag filter both replace the tree. An open search
     wins, and the filter bar hides.
   - TOC: six conflicts, all additive (`shared/package.json` exports, SubMenuBar, ContentArea,
     Editor, DocumentMenuSheet, `frontend/AGENTS.md`).

   Then:
   - Two test mocks went missing in the merges; I added them back.
   - One unused import was left by my own TOC fix, which my background lint run caught and I first
     missed.
4. **Integration-time fixes:**
   - Typewriter settings reload only when a sync changed the `settings` table (tag branch's
     `onRemoteChangesApplied`).
   - The tag filter uses the shared Trash rule from search.
   - `stripInline` strips at most 2400 characters of a line: 656 ms for a 32 KB hostile line
     before. Both the search and the TOC agent had left this for the other.
5. **Pastel tag palette** (Kris, mid-run): seven hues and a neutral at one OKLCH lightness and
   chroma, with a fill and ink pair per theme. The verifier was rewritten for both themes. See
   tag spec §4.2.

6. **Search 3–4 merged** (metadata index for `prop:`/`tag:`, property picker, `tag:` in app and API,
   chips on results). It also includes the fix I asked for after phase 0: a query with checks in
   JS used to rescan the whole table for every refill batch (`lorem is:checklist` took 16.7 s).
   It now makes one metadata pass per database, then reads bodies by id.

## Browser run (dev stack, headless Chromium, throwaway accounts)

Screenshots are in `docs/agent-logs/2026/11/pending-specs-assets/` (not committed, as with the
other logs). Scenario scripts are in the session scratchpad.

| Scenario | Result | Notes |
|---|---|---|
| a: typewriter, desktop | 6/6 | band mid-pane; shortcut toggles without inserting a newline; nothing left when off |
| b: TOC and links, desktop | 11/11 | insert after H1; `-1` duplicate slugs; fenced line left out; stale then refresh; doc link to a heading; `/#/settings` inert; Ctrl+K picker |
| c: tags, desktop, light and dark | 8/8 | chips with +N; quoted `issue #12`; filter leaves Trash out; manager colour; Documents untouched; autocomplete |
| e: search 1–2, desktop | 10/10 | shortcut and focus; Trash out unless `in:Trash`; `prop:`; `ÜBER`; `-title:`; Esc order and focus return |
| f: phone 375 | 6/6 | card chips; search; menu rows; TOC insert; typewriter layer |
| g: search 3–4, desktop | 11/11 | `tag:` with Trash out and `in:Trash`; chips on results add `tag:` once; picker inside the sidebar, date field, writes `prop:status=draft`; syntax help no longer clipped; typed date comparison |
| **Final pass, all scenarios on the merged branch** | **52/52** | file names prefixed `final-` |

The browser run found these:
- **Dark-mode tag chips were unreadable** after the palette change: Vue's scoped `:global()` drops
  the rest of the selector. The rule moved to `main.css`.
- **The search syntax popover was clipped** at the sidebar's left edge. Sent to the search agent and
  fixed in phases 3–4.
- **Pre-existing:**
  - The Preview's headings keep the named style's dark ink in dark mode.
  - The Recent Documents dashboard lists Documents in Trash.

## Phase 0 (advanced search §8)

Chrome against the dev stack: 5000 seeded Documents (86.1 MB), sync off, median of 5.

| Query | 1× CPU | 4× CPU |
|---|---|---|
| zebra / lorem / über | 1.06 / 1.03 / 1.08 s | 4.2 / 4.1 / 4.3 s |
| title:lorem | 182 ms | 761 ms |
| prop:status=draft | 2.19 s → 191 ms with the index (phase 3) | 8.65 s → 808 ms |
| lorem is:checklist, 0 results | 16.7 s → 1.1 s after the one-pass fix | 62.9 s → 4.4 s |
| tag:alpha (~330 Documents) | 93 ms (phase 4) | 330 ms |
| index build | 1.07 s | 4.3 s |

Any query that reads bodies costs about 1 s at this size. The cost is reading pages through the
WASM storage: a bare `SELECT sum(length(content))` costs the same. That misses the spec's 150 ms
budget, and the spec leaves the FTS5 decision to Kris.

**Decision (Kris, 2026-11-08):** ship LIKE search as is, and measure real account sizes before
FTS5. Recorded in the search spec §8.

## Tests (final, `feature/pending-specs`)

- Frontend: 122 files, 1457 passed.
- Shared: 199 passed.
- Backend (Docker, `panino-api-test-integration`): 79 files, 1260 passed, 1 skipped (the opt-in perf file).
- Lint: clean. Tag palette verifier: pass.
- Link check: no new broken links. The remaining ones are examples in specs and older historical
  paths.

## Open Items / Notes

- **Not merged into `develop` and not pushed.** That needs Kris's go-ahead.
- **Before release:**
  - **Content schema 3 is forward-only** (`tags` table): deploy the backend first and never roll
    back past it (runbook updated).
  - **`FRONTEND_URL` must be set in production,** or links to other Documents in PDFs print as
    plain text. The startup warning says so.
  - A client from before the release stalls on pulled `tags` rows until its service worker reloads,
    about a minute.
- **Not verified in this run:**
  - real iOS and Android keyboards, IME, Safari and Firefox sentence boundaries;
  - typewriter mode during live sessions (`LIVE_SESSIONS_ENABLED` is off in the dev stack);
  - two-member tag colours in a space (the tag agent ran it headless on its own stack: 15/15);
  - PDF export with internal links (U12), ZIP export and re-import (U15), the signed-out deep
    link (U17).
- **Pre-existing, found in passing:**
  - Preview headings keep the named style's dark ink in dark mode.
  - The Recent Documents dashboard lists Documents in Trash.
  - Undo after a word ending in `.` or `,` seems to do nothing at first (typewriter log).
- **Follow-ups:**
  - Measure real account sizes, then decide on FTS5 or putting `notes.content` last / a local
    covering index (search spec §8).
  - Remove `TreeItem`'s unused filter props.
  - Lavender is not in the palette, because it falls too close to `--pn-accent`. It can be added
    if Kris prefers it to the rule.
- **Housekeeping:**
  - The agents' worktrees and branches are still under `.claude/worktrees/`. Run root lint with
    `--ignore-pattern '.claude/**'`.
  - The first browser shots (no scenario prefix) were superseded by the prefixed ones and left in
    place.
