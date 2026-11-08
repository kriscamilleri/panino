# Advanced search, phases 1 and 2

- Agent: Claude Code (Opus 5.5), one of four parallel agents; orchestrated
- Start: 2026-11-08, 18:30
- Status: phases 1–2 done on `feature/advanced-search` (from `develop` 10b06f4); not pushed, not
  merged. Phase 0 (browser benchmark) is the orchestrator's; phases 3–4 wait for the tag system.

## Objective

Build phases 1 and 2 of [`advanced-search.md`](../../../specs/active/advanced-search.md) (§10):
the search helpers in `shared/`, one query language for the app and the AI add-on's API, the new
`docStore.searchDocuments`, the phone Search page on it, recent searches cleared on sign-out, and
the desktop search panel that replaces the sidebar's name filter. Kris's decisions are in the
spec's §12; the final Trash decision is "left out everywhere unless `in:Trash`".

## Progress

1. **Moved the shared pieces (§6.1).** `shared/searchText.js` (term helpers, word count, snippet,
   the new parser `parseSearchQuery`, `hasChecklistItem`), `shared/propertyFilter.js` (the filter
   language), `shared/trashFolder.js` (`findTrashFolderId`, folder subtree, path lookup, folder
   index). Exported as `search-text`, `property-filter`, `trash-folder`, `document-search`. The
   add-on re-exports every old name (`documentText.js`, `propertyText.js`, `keyUtils.js`), so its
   existing unit tests ran unchanged and passed before anything else changed.
2. **Took a perf baseline** of the add-on's load test before touching `searchDocuments`.
3. **Wrote the app's engine** as `shared/documentSearch.js` (`searchDatabases`), not inside
   `docStore`, so the backend can run it on better-sqlite3 next to the API for the parity test.
   `docStore.searchDocuments` hands it the open databases.
4. **Moved the API's search onto the parser** (§6.5) and extended the property scan
   (`scanTarget`) with the search's SQL filters and title score (`searchByProperties`). Every
   existing add-on test passed (439) before the new tests were added.
5. **Phone page and desktop panel** on one composable (`useDocumentSearch`); chips are query
   rewrites (`utils/searchQuery.js`).
6. **Headless browser check** on an isolated stack (API in Docker on 127.0.0.1:8014, Vite on
   127.0.0.1:5184, throwaway accounts), desktop 1280 px and phone 375 px: 18/18 checks passed.
7. **Rough phase 0 run** in headless Chrome (see Tests).

## Changes Made

Shared (`shared/`):
- `searchText.js`: query language, linear tokenizer that records token positions,
  `quoteSearchValue`, `textPartFound`, `foldedIncludes`, `hasChecklistItem`, and the moved term
  helpers. `parseSearchTerms` keeps the first release's behaviour.
- `propertyFilter.js`: the moved filter language plus `localBuiltInEntries`.
- `trashFolder.js`: Trash rule, `folderSubtree`, `trashFolderIds`, `findFoldersByPath`,
  `buildFolderIndex` (now also `segmentsOf`).
- `documentSearch.js`: `searchDatabases`, `resolveFolderScope` (shared `in:` + Trash rule, used
  by the API too), `compareSearchRows`, `compareBinary` (UTF-8 order without Buffer),
  `PERSONAL_LABELS` (`My Notes`).

AI add-on (`backend/api-service/addons/ai/`):
- `documentService.searchDocuments`: the parser; `in` parameter (fields) and `in:` (folders) side
  by side; `folderId` ∩ `in:`; Trash by `in:Trash`, `includeTrash` or a `folderId` inside it;
  `is:checklist` through a registered `panino_has_checklist`; `prop:` through
  `searchByProperties` with `truncated` / `scanned`; `notices` in every response.
- `propertyService.js`: `scanTarget` takes optional `filters` and `score`; new
  `searchByProperties` (negation-aware, cheapest conditions first, as the property query).
- `api/documents.js`: tool description, notices in the MCP text, OpenAPI parameters and
  response fields. `README.md`: a Search section with one example per part.
- `tests/integration/searchLanguage.test.js`: new parts through REST and MCP, and 16 parity cases.
- `tests/perf/load.perf.test.js`: eight new search measurements, added at the end so the
  existing rows are measured under the same conditions.

Frontend:
- `store/docStore.js`: `searchDocuments({ query, limit, cursor })` → `{ results, nextCursor,
  notices, terms, cancelled }`; a newer call cancels an older one.
- `composables/useDocumentSearch.js`: one search session (150 ms debounce, remember after 2 s or
  on open, paging), the desktop panel's session state, `isSearchShortcut`, `resultCountLabel`.
- `utils/searchQuery.js`: multi-term highlights, windowed snippets, `clearRecentSearches`, chip
  rewrites, `folderSearchPath`, `SEARCH_SYNTAX`; `hasChecklist` is the shared rule.
- `pages/PhoneSearchPage.vue`: the new engine, chips write into the query, `in:` filled when
  opened from a folder, notices, "In Trash", "Show more".
- `components/SearchPanel.vue` (new), `components/Documents.vue` (toggle opens the panel; the
  name filter and its tree branch removed), `components/SidebarWithResizer.vue` (the shortcut).
- `store/authStore.js`: recent searches cleared when the token goes away (sign-out).
- `utils/searchBench.js` + `main.js`: dev-only `window.__paninoSearchBench` and
  `window.__paninoSearchSeed`.

Docs: spec moved to `active/` with an Implementation line and §13 build notes;
`docs/architecture/public-api.md` (search), `frontend/AGENTS.md` (Search section).

## Tests

| Suite | Command | Result |
|---|---|---|
| Shared | `npm test --prefix shared` | 91 passed (7 files); after the review fixes 94 |
| Frontend | `cd frontend && npx vitest run` | 1112 passed (92 files); after the review fixes 1119 |
| Backend | `PANINO_TEST_IMAGE=panino-api-test-search ./scripts/test-backend.sh` | 1210 passed, 1 skipped (the opt-in perf file), 78 files; after the review fixes 1222 passed, 1 skipped (one test of mine expected `--` to match only one Document, but front matter fences contain it; fixed the test and re-ran its file: 26/26) |
| Lint | `npx eslint --ignore-pattern '.claude/**' .` | clean |
| Build | `npx vite build` | builds; the bench module is not in the production bundle |

New tests: `shared/tests/searchText.test.js` (every prefix, quoting, `-`, `Note:`, limits,
notices, folding, checklists, 2 MiB hostile input), `shared/tests/trashFolder.test.js`,
`frontend/tests/unit/documentSearch.test.js` (the engine on two real `node:sqlite` databases:
merge order, cursors, Trash and `in:Trash`, `in:` naming a space, a full checklist page,
folding, negation, properties, cancellation, an unreadable database, hostile input),
`searchChips.test.js`, `searchPanel.test.js` (mounted panel, Esc, chips, Show more, shortcut,
phone page), the rewritten `docStoreDocuments.test.js` search block, and the API's
`searchLanguage.test.js`.

### API load (87 MB account, `PANINO_PERF=1`, median of 3; A/B against an image of 10b06f4)

| Search | before (base, two runs) | after (two runs) |
|---|---|---|
| "zebra" (rare) | 19.7 / 19.2 ms | 19.0 / 17.8 ms |
| "lorem" (common) | 18.3 / 20.2 ms | 20.7 / 19.3 ms |
| 3 words | 20.0 / 22.2 ms | 26.0 / 20.9 ms |
| phrase | 27.8 / 29.1 ms | 33.1 / 28.2 ms |
| "über" | 85.2 / 86.8 ms | 98.0 / 85.2 ms |

No slower beyond run-to-run noise. The new parts on the same account: `in:` 17 ms, `-in:` 19 ms,
`in:Trash` 15 ms, `-dolor` 15 ms, `is:checklist` 22 ms, `lorem prop:status=draft` 49 ms,
`prop:status=draft` alone 48 ms (the property scan), `lorem prop:word_count>2000` 440 ms (word
counts read every candidate body, as `query word_count >= 1000` does at 270 ms).

A first A/B showed `query word_count >= 1000` at 352 ms against 275 ms. Rerunning the new code
with the base's perf file gave 272 ms: the new search rows had run first and left the heap
fuller. They now run last.

### Browser (headless Chromium, isolated stack, throwaway accounts)

Script: a Puppeteer run against 127.0.0.1:5184 / 127.0.0.1:8014, screenshots in
[`search-assets/`](search-assets/). All 18 checks passed:
- desktop 1280: Ctrl+Shift+F opens the panel with focus; `zebra` finds the two body matches and
  leaves Trash out; body HTML shows as text; count "2 Documents"; `in:Trash` shows "In Trash";
  `tag:` notice; `ÜBER` finds "Über uns"; the Checklists chip writes `is:checklist`; Esc
  returns to the tree; reopening keeps the query and its results; opening a result goes to it;
  `__paninoSearchBench` works.
- phone 375: opened from a folder, the field starts with `in:Projects`; `in:Projects zebra`
  finds both; Everything clears the folder part; sign-out clears recent searches.

### Phase 0 indication (not the decision run)

Headless Chromium 151 on the dev machine, no GPU, a fresh account seeded with
`__paninoSearchSeed({ count: 5000, confirm: true })` (83.8 MB, the API benchmark's generator,
no folders), sync switched off so no upload ran while timing. Median of 5:

| Query | 1× CPU | 4× throttled |
|---|---|---|
| raw `SELECT count(*), sum(length(content)) FROM notes` | 1116 ms | — |
| raw `content LIKE '%zebra%'` count | 1039 ms | 4403 ms |
| raw `instr(content, 'zebra')` count | 1050 ms | — |
| engine `zebra` | 1070 ms | 4291 ms |
| engine `lorem` | 1126 ms | 4023 ms |
| engine `alpha beta gamma` | 995 ms | — |
| engine `"quick brown"` | 1057 ms | — |
| engine `über` | 1088 ms | 4139 ms |
| engine `lorem is:checklist` | 1040 ms | — |
| engine `prop:status=draft` | 2193 ms | — |
| engine `title:lorem` | 186 ms | — |

What this says, for the phase 0 decision (not made here):
- **The engine adds almost nothing**: any query that touches every body costs what reading every
  body costs, about 1 s for 84 MB, and 4× under throttling. Even `sum(length(content))` takes
  1.1 s, so the cost is reading pages through CR-SQLite WASM's storage layer (page cache is the
  default `cache_size = -2000`, 2 MB, page size 4096), not `LIKE`.
- The 150 ms budget is far away for body searches at 5000 Documents; titles only (`title:`) is
  186 ms. FTS5 (§8) or keeping the database in memory are the options to measure.
- **Raising the page cache broke the database in this run**: after `PRAGMA cache_size = -262144`
  on the repository connection, the next query failed with "database disk image is malformed".
  Not investigated; do not try that on a real account without understanding it.
- `prop:` without a word reads every candidate's first 16 KB in batches: 2.2 s. Phase 3's
  metadata index is what fixes that.
- In the first run, with sync on, the upload of the seeded rows overlapped the timing and gave
  1–3.9 s per run; those numbers are not used.

## Review fixes (independent review by Fable; the coordinator chose nine findings)

| # | Finding | Fix | Test (fails before, passes after) |
|---|---|---|---|
| 1 | Refill kept every body it read (`searchOne`), so a query that rejects most candidates could hold the whole account | `confirmBatch` checks a copy of each row with its body attached and keeps bodies only for rows that match (whole bodies only, reused for snippets); rejected bodies go with the batch, in both the exact-score and the JS-ordered path. `searchDatabases` reports `stats: { bodiesRead, bodiesKept }` | `documentSearch.test.js`: 300 candidates, 290 rejected, for `zebra -is:checklist`, `über -is:checklist`, `zebra prop:word_count>50000`: over 250 read, at most limit + 1 kept |
| 2a | `-5 degrees`, `--`, `-` changed meaning in the API | `-` negates only before a letter (any script) or a quote; documented in the tool description, OpenAPI, the README and spec §4 ("quote it to search literally") | `searchText.test.js`; API `searchLanguage.test.js` (`-5 degrees` finds the Document, `--` is a word) |
| 2b | `tag:urgent` alone was a 400 | the parser reports `onlyUnavailable`; the API answers 200 with no results and the notice, the app shows the notice only | API and app tests |
| 3 | `prop:status="in progress"` was split into two parts | a prefixed value runs to the next space outside quotes (each quote paired with the next, using the same once-only search for quotes, so it stays linear); an unclosed quote takes the rest of the query with a notice; `prop:` passes inner quotes to `parseFilter` | `searchText.test.js` (incl. 2 MiB hostile prefixed input); API test |
| 4 | the perf generator had no brackets, so `is:checklist` never ran its rule | a link in two of three paragraphs, without drawing from the generator (the same in `searchBench.js`) | perf row below |
| 5 | title-only checks read bodies | `plan.loads` is `body`, `head` or null; with null no body is read for confirmation | `documentSearch.test.js`: `title:über`, `budget -title:über` read 0 bodies |
| 6 | a re-run on every `recentDocVersion` bump | at most one re-run per 2 s (a burst gives one at its end), and only while a query is shown | `searchPanel.test.js` |
| 7 | the phone's folder `in:` part was remembered as a recent search | `setText` writes the field without arming the remember-on-pause timer (chips, the folder part, a recent search, Clear); typed text and opened results are still remembered | `searchPanel.test.js` |
| 8 | focus after closing | Esc or the close button puts focus on `documents-search-toggle`; the syntax help takes focus when it opens and gives it back to its button | `searchPanel.test.js` |
| 9 | checklist rule | front matter is skipped by the shared `findFrontMatterBlock` rule. **Not changed:** `- [ ] ` with nothing after the box still is not an item: the earlier rule (`toSnippetLines` drops a task with no text) and the Preview's markdown-it-task-lists both say so (checked: `- [ ] `, `- [ ]`, `- [ ]  ` → no task, no checkbox) | `searchText.test.js` |

Perf after the generator change (the account is now 86.4 MB; adding text changes how many
blocks each body gets, so counts shift slightly, e.g. `status = draft` 815 instead of 780):
`search lorem is:checklist` **77.8 ms** (was 22 ms when no body had a bracket); the existing
search rows are unchanged (`zebra` 19.3, `lorem` 19.2, 3 words 21.8, phrase 26.4, `über` 86.5 ms).

## Open Items / Notes

- **Browser checks not done here** (for the orchestrator, on the dev stack with a space):
  see the checklist in the final report; spaces were not created in the headless run.
- Phases 3–4 need the tag system's per-database index (§6.3); see the final report.
- `TreeItem.vue` keeps its `isFiltered` / `matchingFiles` props, now unused, because the tag
  agent is editing that file; remove them after the merge.
- The dashboard's quick filter ("Search recent documents") is unchanged, as §5.1 says.
