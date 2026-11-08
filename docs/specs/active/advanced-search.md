# Advanced Search — Spec

> Find Documents by their text, title, folder, front matter properties and tags, in personal
> Documents and every space at once, on desktop and phone, with one search engine behind both.
> Status: active — phases 1–2 merged on `feature/pending-specs`; phases 3–4 on
> `feature/advanced-search-3-4`
> Created: 2026-03-21
> Last updated: 2026-11-08 — rewritten for what shipped since March: shared spaces, the phone
> Search page, the shared front matter parser, the AI agents add-on's search and property
> filters, and the forthcoming [tag system](tag-system.md); then Kris decided Q1–Q4 (§12)
> Implementation (phases 1–2): `shared/searchText.js`, `shared/propertyFilter.js`,
> `shared/trashFolder.js`, `shared/documentSearch.js` (the app's engine), `docStore.searchDocuments`,
> `composables/useDocumentSearch.js`, `pages/PhoneSearchPage.vue`, `components/SearchPanel.vue`,
> the AI add-on's `documentService.searchDocuments` and `propertyService.searchByProperties`.
> Implementation (phases 3–4): `metadataRestrictions` in `shared/documentSearch.js` (the metadata
> index answers `tag:` and front matter `prop:`), `documentIndexStore.metadataEntries`,
> `utils/propertyPicker.js`, `components/PropertyPicker.vue`, `composables/usePropertyPicker.js`,
> tag chips on results (`DocumentTagChips` with `selectable`), the API's `tag:` through
> `searchByProperties`. Build notes in §13. Remaining: the phase 0 decision (FTS5 or not, §8)

---

## 1) Summary

Panino already has two searches, and neither is the one this spec asked for:

- **Phone:** Search (`PhoneSearchPage.vue`, `docStore.searchDocuments`) matches titles and
  bodies across every open database, with snippets and recent searches. But it matches the
  whole query as one literal string, has no field prefixes, and misses other cases of non-ASCII
  letters (searching `über` misses `Über`).
- **Desktop:** the sidebar's search (`Documents.vue`) and the dashboard's quick filter only match
  Document and folder **names**. The body text cannot be searched on desktop at all.

This spec turns the phone search into one engine with a small query language, and gives desktop
a search panel on top of it. The language is the one agents already use through the AI agents
add-on ([`ai-api-expansion.md`](../shipped/ai-api-expansion.md) §4.5, §4.6). Its term and
property-filter code moves to `shared/`, so the app, the REST API and MCP read a query the same
way and return results in the same order.

---

## 2) What changed since the March draft

| March draft assumed | Now |
|---|---|
| One local database | Personal plus one database per space ([COLLAB-04](../shipped/collab-04-shared-spaces.md)). Every query runs per database and merges in JS; limits apply after the merge |
| No search UI exists | Phone Search exists ([mobile UI spec](../shipped/mobile-ui/panino-mobile-ui-spec.md), "Search"): scope chips Everything / Titles / Checklists / Folder, snippets, recent searches |
| "Existing YAML parser" | `shared/frontMatter.js` (`@panino/content-merge/front-matter`). A block counts as front matter only if closed and YAML-shaped. It reads `key: value` lines; list items (`- work`) are kept but not read |
| `var:author:Jane` | The AI add-on has a property filter language (`status = draft AND priority >= 2`, `due exists`, dates by day) and built-in properties. Reuse it rather than invent a second one |
| `LIKE` is enough | LIKE folds ASCII letters only. The API pairs a LIKE prefilter with a JS case check for other letters; the app needs the same |
| Notes | Product language is **Document** |
| No Trash | Agents trash into a top-level folder named `Trash`, and the API leaves it out of search unless asked. The app and the API follow one rule (§4, §12 Q2) |
| FTS5 "later" | The bundled `crsqlite.wasm` includes FTS5. Whether a local index is worth it is decided by measurement (§8) |

---

## 3) Goals and non-goals

### Goals

1. Search Document **text and titles** on desktop and phone, in personal Documents and every
   space together, or within one folder.
2. **Several words** must all match, in any order. `"quoted phrases"` match exactly.
3. Ignore case for every letter, not only ASCII.
4. Narrow by **title**, **folder**, **front matter property**, **tag** and **checklist**.
5. Show results with the space name, folder path, edited time and a snippet with matches
   marked, in the same order the API would return them.
6. Stay fast on a large account (§8) without new tables or anything synced.

### Non-goals

- No fuzzy or typo-tolerant matching, no stemming.
- No search of revision history, templates, global variable values or images. A body's
  `{{variable}}` matches as written, not as resolved.
- No server-side search for the app. Search runs against the local databases and works offline.
- No saved searches.
- `created_by` / `modified_by` filters: they come from revision history, which lives on the
  server. The app can add them later through the API if wanted.

---

## 4) Query language

A query is a list of parts separated by spaces. Every part must match (AND).

| Part | Matches | Example |
|---|---|---|
| a word | the title or the body contains it | `budget` |
| `"a phrase"` | the title or body contains the exact phrase | `"quarterly review"` |
| `title:` word or phrase | the title only | `title:kickoff`, `title:"team sync"` |
| `in:` folder path | Documents in that folder and below; a space name may lead | `in:Projects/2026`, `in:"Acme Team/Contracts"` |
| `tag:` name | Documents carrying the tag ([tag system](tag-system.md) §3), case and spacing ignored | `tag:urgent`, `tag:"to do"` |
| `is:checklist` | Documents with at least one checklist item (the phone's Checklists chip) | `is:checklist` |
| `prop:` condition | one condition of the property filter language, quoted when it has spaces | `prop:status=draft`, `prop:"due <= 2026-12-01"`, `prop:"owner missing"` |
| `-` before any part | must **not** match | `-tag:archived`, `-"draft"` |

Rules:

- Prefixes are case-insensitive. A word that only looks like a prefix (`Note:`) is a plain word
  unless its prefix is in the table. Quote it to search it literally: `"title:"`.
- `-` negates only when a letter or a quote follows it (`-draft`, `-"old plan"`, `-in:Archive`).
  `-5 degrees`, `--` and `-` alone are plain words, as the first release of the API read them.
  To search a word that starts with a dash, quote it: `"-draft"`.
- A prefixed value runs to the next space outside quotes, so `prop:status="in progress"` and
  `title:"team sync"` are one part each. A quote with no closing quote takes the rest of the
  query, with a notice.
- `prop:` uses `parseFilter` from the AI add-on, moved to `shared/` (§6.1): the operators
  `= != ~ ^= > < >= <=`, `exists` and `missing`, numbers as numbers, and dates at the precision
  both sides give. The built-in properties available locally are `word_count`, `created_on` and
  `modified_on`.
- `in:` resolves against the folder paths of each database.
- **Trash is left out, everywhere.** Documents in a database's top-level `Trash` folder (and its
  subfolders) never appear in results, in the app or the API, unless the query names it:
  `in:Trash`. Results found that way carry an "In Trash" label beside the folder path. Which
  folder is Trash is decided by one shared function (`findTrashFolderId`, §6.1), the rule the API
  uses today: the oldest top-level folder named `Trash`, ignoring case and surrounding spaces.
- `tag:` matches the canonical (lower-case, trimmed) name, across every database, as the tag
  spec's filter bar does (§5.2 there).
- Limits, matching the API: at most 20 parts and 200 characters. An unknown or malformed part
  shows one line under the field ("`prop:` needs a condition, e.g. `prop:status=draft`") and
  searches the rest.

The chips are shortcuts that write into the query, so there is one source of truth:

| Chip | Adds |
|---|---|
| Everything | nothing (clears the others) |
| Titles | turns every plain word into `title:` |
| Checklists | `is:checklist` |
| Folder | `in:<current folder>` |
| a tag chip on a result | `tag:<name>` |
| Property… | opens the property picker (§5.4), which adds a `prop:` part |

---

## 5) UX

### 5.1 Desktop

- **Entry points:** the sidebar's search button (`documents-search-toggle`) and
  `Ctrl+Shift+F` / `Cmd+Shift+F`. No existing binding uses that shortcut.
- The search **replaces the sidebar list** while open. Esc or the close button returns to the
  tree, keeping the query for the session.
- The sidebar's current name-only filter goes away: typing a name still finds the Document,
  since titles are searched. The dashboard's quick filter stays as it is. It narrows the list on
  screen and is labelled as such.
- **Results:** title (opens the Document), space name and folder path, edited time, a snippet with
  matches marked, and up to three tag chips (the tag spec's shape and colour rules, §4.3 there).
  "Show more" loads the next page.
- The result count, or "No Documents match", shows under the field. With an empty field, the
  recent searches show.
- Above the results: the same chips as on the phone, and a "Search syntax" link that opens a
  short help popover listing the table in §4.

### 5.2 Phone

The existing Search page keeps its layout and chips. It gains the query language, tag chips on
results, case folding for every letter, and "Show more". With a folder chip set, the page opens
with `in:` filled in.

### 5.3 Both

- Results update 150 ms after typing stops (the phone's current timing). A newer query cancels
  the older one's work.
- Snippets come from `searchSnippet` (`utils/searchQuery.js`), extended to mark every term and to
  prefer the first term found in the body.
- A query is remembered as a recent search when a result is opened, or after 2 s without
  typing. Recent searches are kept per device (8 at most) and **cleared on sign-out**. Today they
  survive sign-out (§9).

### 5.4 Property picker

People can filter by property in two ways, both writing the same `prop:` parts (§12, Q3):

- **Typed:** `prop:status=draft` in the field, as in §4.
- **Picked:** the Property… chip opens a small form in three steps.
  - **Property:** the front matter keys found in the Documents being searched (from the metadata
    index, §6.3), most used first, then the built-ins `word_count`, `created_on` and
    `modified_on`.
  - **Condition:** in words: is, is not, contains, starts with, more than, less than, at least,
    at most, is set, is not set. These map to the operators of `parseFilter`.
  - **Value:** a text field, offering the values seen for that key. It is a date field for
    `created_on` and `modified_on` and for keys whose values all read as dates. It is hidden for
    "is set" and "is not set".

  Add writes the part into the query, quoted when needed (`prop:"due <= 2026-12-01"`). It shows
  as text the person can edit or delete like anything else they typed.
- On the phone the form is a bottom sheet. On desktop it is a popover under the chip.
- The picker never builds a condition the parser would refuse: the parser checks the part it
  writes, and the form shows the parser's message if the check fails.

---

## 6) Implementation

### 6.1 Shared code, one implementation

Core may not import an add-on (`panino/addon-boundaries`). So the pieces the app needs move from
`backend/api-service/addons/ai/` to `shared/` and are exported like `template-variables`:

| From | To | What |
|---|---|---|
| `documentText.js` | `shared/searchText.js` | `parseSearchTerms` (extended with the prefixes and `-` of §4), `termMatches`, `likeContains`, `likeShape`, `hasCasedNonAscii`, `MAX_SEARCH_TERMS` |
| `propertyText.js` | `shared/propertyFilter.js` | `readProperties`, `parseFilter`, `matchesFilter`, `isoParts`, `compareTimes` |
| `keyUtils.js` | `shared/trashFolder.js` | `findTrashFolderId`, and the subtree walk behind `isInTrash`, so the app and the API agree on which Documents are in Trash |
| — | `shared/frontMatter.js` | `readTags(markdown)`: the `tags` list or single string, canonicalised. The tag system needs it too |

The add-on keeps re-exporting the old names, so its existing tests keep passing. The API's
search accepts the same parts in phase 1 (§6.5, §12 Q4), so agents and people share one
language from the start.

### 6.2 The search function

`docStore.searchDocuments` becomes `searchDocuments({ query, limit, cursor })`:

1. Parse the query once (`parseSearchTerms`).
2. For each open database, or the one named by `in:`, run one parameterized query:
   - Each word or phrase becomes `title LIKE ? OR content LIKE ?` (only `title` for `title:`), with
     `likeContains`. A term with cased non-ASCII letters uses `likeShape` instead, and JS confirms
     the match (step 4).
   - `in:` becomes the folder subtree, through the existing `FOLDER_PATHS_CTE`. `-in:` excludes
     a subtree. The Trash subtree is excluded unless the query has `in:Trash`.
   - `is:checklist` adds the existing `content LIKE '%[%]%'` prefilter.
   - Order: the number of terms found in the title, descending, then `updated_at` descending, then
     `id`. This is the API's order. Use `updated_at` directly, not `datetime(updated_at)`: it is
     ISO 8601 and sorts as text, and the function call costs per row.
   - Fetch `limit + 1` candidates.
3. Merge the databases' candidates with the same comparator (`mergeDashboardRows` gains a
   comparator argument). The cursor is the last result's `(title_score, updated_at, id)`.
4. In JS, confirm each candidate: folded-case terms, `-` parts, `is:checklist` (`hasChecklist`),
   `prop:` (`matchesFilter`) and `tag:` (from the metadata index, §6.3). If confirmation drops
   rows, the database is read again from its last candidate until the page is full or the
   database is exhausted. Today's checklist filter runs after the limit, so a page can come back
   short; this fixes it.
5. Return `{ results, nextCursor, notices }`. `notices` holds the parse messages from §4.

Only the page's bodies are read into JS for snippets, as in the API (§8).

### 6.3 Metadata index (shared with tags)

`prop:` and `tag:` need front matter from many Documents. Parsing every body on each keystroke
would be the cost the API's property scan was rebuilt to avoid. So keep **one in-memory index
per database** that both search and the tag system use (tag spec §7 describes the tag half):

- Per Document: its tags (canonical) and its front matter properties, read from the first 16 KB
  of the body (the API's limit, documented the same way), plus `word_count` when asked for.
- Built lazily, the first time a query needs it, by streaming rows. Never at start-up.
- Updated on save, and after sync for the changed ids only. Dropped when a space is left.
- Never written to the database and never synced.

With `prop:` or `tag:` in a query, the index gives the candidate ids first, and the SQL query is
restricted to them (`id IN (SELECT value FROM json_each(?))`).

### 6.4 Live sessions and conflicts

Search reads the local databases. A Document in a live session
([COLLAB-05](../shipped/collab-05-live-sessions.md)) matches its last committed text. A Document
with an unresolved conflict matches its current local text. Both are the text the person sees
when they open the Document from the list.

### 6.5 The API's search, in phase 1

`search_documents` (MCP) and `GET /addons/ai/v1/search` (REST) parse `q` with the same shared
parser, so every part in §4 works there too:

- **Plain words and phrases are unchanged.** Every existing query gives the same results.
- **The `in` parameter** (`all` / `title` / `content`) chooses fields, which is unrelated to the
  `in:` part, which chooses folders. It stays for compatibility. `in=title` has the same effect
  as the Titles chip. The tool description says both plainly, so an agent does not confuse them.
- **`folder_id` and `in:`** both apply when both are given: the results are the Documents in both.
- **Trash:** the same rule as the app (§4). Trash is left out unless asked. An `in:Trash` part
  asks, and so do the existing `include_trash: true` and a `folder_id` inside Trash, which keep
  working. Results in Trash keep the existing `inTrash: true` field.
- **`prop:`** also accepts `created_by` and `modified_by` on the server, which has revision
  history. In the app these give a notice and are ignored (§3).
- **`tag:`** returns the same "not available yet" notice until tags ship. A query whose only
  part is `tag:` answers 200 with no results and that notice.
- **Responses** gain `notices`, the parse messages as text, next to the existing `terms`. Update
  the OpenAPI document, the tool description and the add-on README, and give one example per new
  part.
- **Cost:** `prop:` with no word or phrase is a property scan. It goes through the existing
  `scanTarget` path, with the same 5000-Document cap and `truncated` / `scanned` fields as
  `query_documents_by_property`, never through a new full read of every body.

---

## 7) Tags dependency

`tag:` and the tag chips need the [tag system](tag-system.md). Phases 1–2 shipped without them
and `tag:` showed "Tags are not available yet"; phase 4 (built on the merged tag system)
removed that notice. The alignment points below were all taken up by the tag spec:

- Its §7 reads tags with "the front-matter parser in `markdownStore.js`". The parser is now
  `shared/frontMatter.js`, and it does not read list items, so tags need `readTags` (§6.1).
- Its per-database tag index and this spec's metadata index (§6.3) should be one index.
- Its filter bar (§5.2 there) and `tag:` must give the same Documents for the same tags. The
  filter bar can be implemented as `tag:` parts added to a query.

---

## 8) Performance

Measured on the server with the 87 MB benchmark account (5001 Documents, native SQLite, see
`docs/agent-logs/2026/11/2026-11-08_12-30_ai-api-review-fixes-and-load.md`):

| Operation | Time |
|---|---|
| `LIKE '%term%'` over every body | 7.6 ms |
| `instr(lower(content), ?)` over every body | 65 ms |
| the API's search, ASCII terms | 18–30 ms |
| the API's search, `über` (prefilter, then fold in JS) | 87 ms |

The browser runs SQLite as WASM in a worker and has not been measured. **Phase 0** measures it
before any design is fixed: seed the same generator into a local dev account, then time
`searchDocuments` in Chrome on desktop and with CPU throttling at 4× (a mid-range phone), median
of five.

- **Budget:** a result page within 150 ms of the debounce on the throttled run, for a
  one-word ASCII query over 5000 Documents.
- **If LIKE meets it:** no index. This is the expected outcome.
- **If not:** a local FTS5 table per database, `notes_search(title, content)`. It must be
  maintained **from JS** (after save, and after sync for changed ids), never with triggers on
  `notes`: CR-SQLite applies merges with the sync bit set, and triggers are where the 2026
  incidents came from ([`crsqlite-sync.md`](../../architecture/crsqlite-sync.md), sync-bit
  section). It is not a CRR, not in `DB_SCHEMA` for sync, and can be rebuilt at any time. This
  needs its own decision before building.

Other limits:

- Each database returns at most `limit + 1` candidates, and the merge keeps `limit` rows.
- Bodies are read for the page only.
- A query is abandoned when a newer one starts. Each database query checks a version counter,
  as the sidebar search does today.

---

## 9) Security and privacy

- Every value is a bound parameter. SQL fragments come only from fixed strings chosen by the
  parsed part type. LIKE wildcards are escaped (`likeContains`).
- Snippets, highlights, paths and tag names render as text nodes, never `v-html`.
- Tag colours from a space are validated by the renderer (tag spec §9).
- Nothing leaves the device for a search.
- **Recent searches are cleared on sign-out.** Today `panino-recent-searches` stays in
  `localStorage` after sign-out, so the next person to sign in on a shared device sees the
  previous person's searches. Phase 1 fixes this whatever else ships.
- The query is capped (200 characters, 20 parts) before parsing.

---

## 10) Phases

| Phase | Contents | Size |
|---|---|---|
| Phase | Status |
|---|---|
| 0 | A first rough run is in the agent log (§13); the decision is open |
| 1–2 | Built and reviewed; merged on `feature/pending-specs` |
| 3–4 | Built on `feature/advanced-search-3-4` (§13, "Phases 3–4") |

| Phase | Contents | Size |
|---|---|---|
| 0 | Browser benchmark (§8); decide whether FTS5 is needed | S |
| 1 | Move the search and filter helpers to `shared/` (§6.1). New `searchDocuments` with words, phrases, `title:`, `in:`, `is:checklist`, `prop:`, `-`, folding for every letter, paging and the API's order. Phone page on it. The API's search on the same parser (§6.5). Recent searches cleared on sign-out | M–L |
| 2 | Desktop search panel, shortcut, chips, syntax help; the sidebar's name filter retired | M |
| 3 | Metadata index (§6.3), so `prop:` stops reading bodies in the app, and the property picker (§5.4) | M |
| 4 | `tag:` and tag chips, after the tag system's phase that reads tags | S |

`prop:` works in phase 1 by reading the page's candidates' front matter. Phase 3 makes it fast
on large accounts and adds the picker, which needs the index for its list of keys and values.

---

## 11) Tests

- **Unit, `shared/`:**
  - Query parsing: every prefix, quoting, `-`, a prefix-looking word (`Note:`), the limits, and
    malformed parts with their notices.
  - `readTags`: a list, a single string, mixed case, duplicates, a missing or unclosed block.
  - Folding: `über` / `Über` / `ÜBER`, Greek, and an ASCII term against the API's behaviour.
- **Unit, frontend:**
  - `searchDocuments` against two databases: merge order, paging cursors, Trash left out by
    default and included and labelled with `in:Trash`, `in:` naming a space, a checklist page
    that is not short, a cancelled query.
  - `findTrashFolderId`: case and spaces, two root folders named Trash (the oldest wins), and a
    nested folder named Trash (not Trash).
  - Property picker: the keys and values it offers, the part it writes for each condition
    (quoting included), and that every part it writes parses.
  - Recent searches are cleared on sign-out.
- **Parity:** the same fixture and query through the app's engine and the API's search give the
  same Documents in the same order, with and without `in:Trash`.
- **API:**
  - Every existing search test passes unchanged.
  - Each new part works through MCP and REST.
  - `in=title` combined with `in:` folders.
  - `folder_id` combined with `in:`.
  - Trash is left out by default. `in:Trash`, `include_trash` and a `folder_id` inside Trash
    each include it.
  - `prop:` on its own reports `truncated` / `scanned`.
  - Notices for malformed parts.
- **Browser, desktop 1280 px and phone 375 px:**
  - Search a word found only in a body, in a space Document and a personal one.
  - Open a result, then Esc back to the tree.
  - `in:` from a folder, `prop:status=draft`, and `tag:` once tags exist.
- **Performance:** phase 0's numbers are recorded in the agent log and rerun after phase 3.

---

## 12) Decisions (Kris, 2026-11-08)

| # | Question | Decision |
|---|---|---|
| Q1 | Should the full search replace the sidebar's name-only filter on desktop? | **Yes.** One search box in the sidebar; titles are still matched (§5.1) |
| Q2 | Should search hide a top-level `Trash` folder? | **Yes, in the app and the API alike.** One shared rule; `in:Trash` includes it, with an "In Trash" label (§4, §6.5). (Kris first chose to include it, then unified both on leaving it out) |
| Q3 | Should people filter properties by typing `prop:` or with a picker? | **Both.** The picker writes `prop:` parts (§5.4) |
| Q4 | Should the API's search accept the same parts? | **Yes, in phase 1** (§6.5) |

---

## 13) Build notes (phases 1–2, 2026-11-08)

Where the build differs from the text above, or settles something it left open:

- **The app's engine lives in `shared/documentSearch.js`**, not in `docStore`. It takes each
  database as `{ dbKey, name, labels, execute }`, so the backend's parity tests run it on
  better-sqlite3 next to the API. `docStore.searchDocuments` passes the open databases to it.
  Its merge uses its own comparator (`compareSearchRows`); `mergeDashboardRows` is unchanged.
- **`parseSearchTerms` keeps the first release's reading** (plain terms). The language is a new
  `parseSearchQuery`, which records each token's position so the chips can rewrite the query.
- **Exclusions only** (`-draft` alone) is not a search: the app shows a notice, the API answers
  400 with it. Any positive part (`in:Projects`, `prop:…`, `is:checklist`) is enough.
- **`in:`** resolves per database from the top level; several folders may share a path and all
  count. Its first name may be a space's name, or `My Notes` for the personal database (the
  sidebar's label). An `in:` that names nothing anywhere gives "No folder matches in:…". Trash
  is searched when a positive `in:` names a folder inside it, so `in:Trash/Old` works too.
- **`prop:`** with a negation (`-prop:status=done`) keeps the Documents the condition refuses.
  `word_count` counts the whole body, front matter included (the API's rule).
- **Terms with cased non-ASCII letters** (über) cannot be scored exactly by `LIKE`, so for such a
  query the app reads every candidate's metadata (no bodies), scores titles in JS and sorts; the
  ASCII path keeps SQL's `ORDER BY … LIMIT`. Both page with the same cursor.
- **Refill** reads the candidates' bodies in growing batches (the page size, then doubling, at
  most 500), by id after one scan (since phases 3–4: "One scan per database" below). Bodies
  read to confirm a batch are kept only for the rows that match, so memory stays bounded by
  the page; a check on the title alone reads no body.
- **Checklists** skip front matter by the shared `findFrontMatterBlock` rule. An empty box
  (`- [ ] ` with nothing after it) is not an item, as the earlier rule and the Preview read it.
- **Recent searches** remember typed queries (after 2 s) and opened results, not text the page
  writes itself (chips, the folder's `in:` part). Shown results are searched again after a sync
  at most once per 2 s.
- **Snippets** strip only a window of about 2400 characters around the first term found, so a
  2 MiB body costs no more than a short one (`stripInline` is not linear on hostile lines).
- **API**: `search` responses gain `notices` always, and `truncated` / `scanned` only when the
  query has a `prop:` part. A `prop:` query uses `searchByProperties` (the `scanTarget` scan,
  extended with the search's SQL filters and title score). Unreadable parts are notices; more
  than 20 parts or over 200 characters stay 400s, as before.
- **A first, rough phase 0 run** (headless Chrome, 5000 seeded Documents, 84 MB, sync off) found
  any body search at about 1 s (4 s at 4× throttling), the same as a bare
  `SELECT sum(length(content)) FROM notes`: the cost is reading pages through the WASM storage
  layer, not LIKE or the engine. Titles only took 186 ms. Raising `cache_size` on that
  connection made the next query fail with "database disk image is malformed". Numbers and
  method: `docs/agent-logs/2026/11/2026-11-08_18-30_advanced-search-phases-1-2.md`. The phase 0
  decision (§8) is still to be made on the dev stack.

### Phases 3–4 (2026-11-08)

- **The index decides, per database.** When a query has `tag:` or a front matter `prop:`, the
  engine asks each database for its metadata index (`database.index()`, which
  `docStore.searchDocuments` wires to `documentIndexStore.ensure`, `metadataEntries` and
  `idsWithTags`). `metadataRestrictions` turns those parts into id lists bound as
  `notes.id IN (SELECT value FROM json_each(?))` (or `NOT IN`), and the SQL prefilter and the JS
  check for those parts are dropped, so no body is read for them. A database whose index cannot
  be built falls back to reading the first 16 KB of the candidates, which gives the same
  Documents (a test compares both ways on 13 queries).
- **Documents without front matter** are not in the index's entries. A condition they pass
  (`owner missing`, `status != draft`, `-prop:status=draft`) becomes an exclusion of the indexed
  Documents that fail it; any other condition a list of those that pass.
- **Built-ins stay off the index:** `created_on` and `modified_on` are checked on the row,
  `word_count` still reads the body (it is not in the index).
- **`tag:`** uses `canonicalTagName` (the tag system's rule: case and spacing ignored, at most 50
  characters; a longer name is a notice). Several `tag:` parts must all hold, as the sidebar's
  filter bar requires every chosen tag; a test checks both give the same Documents. Trash is left
  out unless `in:Trash`.
- **The API's `tag:`** goes through `searchByProperties` (the `scanTarget` path) with `readTags`
  on the 16 KB head, a `tags` key prefilter for a positive tag, and the same cap, `truncated` and
  `scanned` as `prop:`. `-tag:` reads every Document (`scanned: all`). The "Tags are not
  available yet" notice is gone (the parser keeps a `tags: false` option).
- **Tag chips on results** reuse `DocumentTagChips` (up to three, `+N`, the database's colours);
  with `selectable` a click emits `select` instead of filtering the sidebar, and the result adds
  `tag:<name>` (once). The chips sit below the result link, not inside it, so no button is nested
  in a link.
- **The property picker** (§5.4): a "Property…" chip on both screens. Keys from every open
  database's index (grouped ignoring case, counts added up, most used first), then the
  built-ins; `tags` is left out (tags have `tag:`), and so is a front matter key named like a
  built-in. Ten conditions in words map to `parseFilter`'s operators. Value suggestions are a
  `<datalist>` of the values seen; the value is a date field for `created_on`, `modified_on`
  and keys whose values all read as ISO dates, a number field for `word_count`, and hidden for
  "is set" / "is not set". The part is written in the plainest form the parser reads back as the
  same condition (`prop:status=draft`, `prop:status="in progress"`, `prop:"due date"<="…"`,
  `prop:"owner missing"`); a value with a double quote is refused. Desktop: a popover under the
  chip (focus moves in, Tab stays inside, Esc closes it alone and focus returns to the chip).
  Phone: a bottom sheet. Text the picker writes is not remembered as a recent search.
- **One scan per database** (the coordinator's phase 0 run found `lorem is:checklist` at 16.7 s:
  every refill re-ran the full scan). A query with checks in JS now runs one pass for every
  candidate's metadata in order (capped at 5000, with a notice when that cut a page short), then
  reads the bodies the checks need in batches by id; only confirmed bodies are kept. The
  checklist prefilter looks for a box (`[ ]`, `[x]`) rather than any bracket, in the app and the
  API. `lorem is:checklist` now costs 1.10× `lorem` (1.07× at 4× throttling).
- **Measured** (headless Chrome, 5000 seeded Documents, sync off, median of 5): the index's first
  build 1.1 s; `prop:status=draft` 191 ms (2193 ms reading heads in phase 1); `tag:alpha` (about
  330 Documents) 80 ms; `tag:report` (every Document with front matter, about 1650) 378 ms; the
  cost grows with the number of ids, each a row read through the WASM storage. Conditions that
  Documents without front matter pass (`prop:"owner missing"` 885 ms) and any body search
  (`lorem -tag:report` 1018 ms) still read every page, as in phase 0's run. API on the 87 MB
  account: `tag:report` 47 ms, `tag:alpha` 45 ms, `lorem tag:report` 46 ms, `lorem -tag:report`
  81 ms. Details: the agent log.
