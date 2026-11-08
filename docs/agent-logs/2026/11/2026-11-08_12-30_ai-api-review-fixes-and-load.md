# AI agents add-on: review fixes and load work on the v1 API expansion

- Agent: Claude Code (Opus 5.5); the review itself by a Fable 5.1 subagent
- Start: 2026-11-08, 12:30
- Status: Done on `feature/ai-api-expansion`; not pushed, not merged

## Objective

An independent review of `feature/ai-api-expansion` against `develop` found:
- **High:** a regular expression in the outline code that could block the server.
- **Medium:** a `missing`/`!=` filter inconsistency, and memory use of `word_count` queries.
- **Low:** nine smaller issues.

Kris asked to fix all of them ("let's do this right") and to spend extra time on the
performance findings, to keep load low. Spec section:
[`ai-api-expansion.md` §4.8](../../../specs/proposed/ai-api-expansion.md).

## Progress

1. **Checked the review.** Findings #1 and #5 were confirmed by running them; the rest by reading
   the code.
2. **Measured instead of guessing:**
   - Wrote `addons/ai/tests/perf/load.perf.test.js`. It is opt-in and builds an 87 MB account
     from a seeded generator: 5001 Documents, 50000 revisions, 300 images and 20 templates.
   - It times every read through REST.
   - Ran it on the unfixed branch for a baseline.
3. **Swept every regular expression the branch adds.** Several more were super-linear besides
   the reviewed one:
   - ATX headings; the image, link, tag, code and underscore strips in heading text;
   - the blank-line trim and append's `/\s+$/`;
   - the shared front matter key patterns (92 ms for one 16 KB line);
   - the shared template-variable patterns (4.5 s for a 240 KB template).

   Each was rewritten as a linear hand-written parser or made linear. Each is tested on 2 MiB
   hostile input. Where exact compatibility mattered, each is compared with the old expression
   on 20000 random strings.
4. **SQLite probe** on 83 MB:
   - `LIKE '%term%'` takes 7.6 ms against 65 ms for `instr(lower(content), ?)`, with the same
     ASCII folding.
   - `substr(content, 1, N)` costs in proportion to N.
   - Iterating all bodies into JS costs 18 ms.

   These numbers set the search and scan designs.
5. **Implemented the fixes** and reran the benchmark. Then went further:
   - authorship by index seeks (171 → 72 ms);
   - a `LIKE` shape prefilter for non-ASCII search terms;
   - a per-account cap on API PDF exports.

## Changes Made

- **Review findings:**
  1. **High, outline regex:** the fence pattern is linear and runs after the blank-line check.
     The other heading patterns were rewritten (`parseAtxHeading`, `stripBracketed`,
     `stripTags`, `stripCodeSpans`, `stripDelimited`).
  2. **`missing` / `!=`:** these conditions consider every Document. The response field
     `scanned` says what was read.
  3. **Memory:** property scans order ids in SQL and stream rows. Word counts read one body at a
     time, only for Documents still matching. `countWords` builds no array.
  4. **Leading `---` rule** (shared parser, so it applies to the app too):
     - A block is front matter only if closed, with at least one key and only YAML-shaped lines.
     - This fixes an app bug: a Document opening with `---` and no second `---` had an empty
       Preview and PDF.
     - `documentText.frontMatterEnd` now uses the shared `findFrontMatterBlock`.
  5. **`create_folder`** refuses a top-level Trash name.
  6. **Image reads** call `requireAgentScope(ctx, 'read')`.
  7. **Mixed line endings:** `insertContent` keeps each line's ending.
  8. **Dates** compare at the precision both sides give; a date alone is that whole day (UTC).
  9. **Templates count as image use** (core `getImageUsage`): for the API, the app's delete,
     bulk delete and daily prune. The image manager's warning lists templates.
  10. **Upload filenames:** multipart uploads repair UTF-8 names, as the app does. The upload
      check resolves the space the same way as the upload.
  11. **Search case:** search ignores the case of non-ASCII letters (`panino_folded_contains`).
  12. **Wording:**
      - `edit_document` says when nothing changed (`changed: false` in REST).
      - Truncation notes say what was scanned.
      - The new `REPLACING` annotation (destructive, idempotent) covers `update_document`,
        `rename_folder`, `set_document_property` and `remove_document_property`.
- **Load, beyond the findings:**
  - Search uses `LIKE` with escaping.
  - Image usage counts for a page come from one pass (`getImageUsageCounts`). The redundant
    `%/api/images/%` LIKE is gone.
  - Authorship uses index seeks.
  - Property folder scope applies before the 5000 cap. A folder query used to miss older
    Documents in the folder.
  - API PDF exports: at most two per account in the queue (`MAX_PDF_EXPORTS_PER_ACCOUNT`).
- **Files:**
  - Add-on:
    - `documentText.js`, `documentService.js`, `propertyService.js`, `propertyText.js`;
    - `authorship.js`, `imageService.js`, `folderService.js`, `libraryService.js`;
    - `api/documents.js`, `api/folders.js`, `api/images.js`, `api/library.js`,
      `api/properties.js`, `api/toolKit.js`;
    - the README.
  - Core: `image.js`.
  - Shared: `frontMatter.js`, `templateVariables.js`.
  - Frontend: `ImageManagerPage.vue`.
  - Docs: the spec (§4.5, §4.6, new §4.8) and `docs/architecture/public-api.md` (with a "Load"
    rule for future scans).

## Tests

- **Benchmark** on the 87 MB account; median of three REST calls:

  | Read | Before | After |
  |---|---|---|
  | list images, 200 | 2737 ms | 23 ms |
  | list images, 50 | 682 ms | 23 ms |
  | query `word_count >= 1000` | 612 ms, +85 MB peak | 276 ms, +0 MB |
  | query `status = draft AND word_count > 2000` | 234 ms, +37 MB | 102 ms, +0 MB |
  | query `modified_by = …` | 171 ms | 72 ms |
  | property keys / `status = draft` | 58 / 65 ms | 43 / 48 ms |
  | search, ASCII | 38–80 ms | 18–30 ms |
  | outline of a 2 MiB Document | 19 ms, +18 MB | 15 ms, +1 MB |
  | search `über` | 78 ms, 0 found (wrong) | 87 ms, 20 found |

  - The `über` search costs a comparison in JS for every Document that may match. Peak memory
    rises about 50 MB, temporarily, when nearly every Document contains the word, as in this
    data set.
- **Hostile 2 MiB input:** every case reads in under 110 ms. Before, the time grew with the
  square of the line length: 30–260 ms at 20 KB, minutes to hours at 2 MiB.
- **Suites:**
  - `./scripts/test-backend.sh`: 75 files, 1196 passed, 1 skipped (the opt-in benchmark).
  - `npm run test:fe`: 89 files, 1085 passed.
  - `shared`: 65 passed.
  - `eslint --ignore-pattern '.claude/**'` on the changed areas: clean.
- **Browser** (Chrome, dev stack; the API and Vite containers restarted):
  - A Document opening with `---`, prose, a `Note:` line and `---`:
    - Before a reload, the open page still ran the old parser and the Preview hid the prose.
    - After a reload, the Preview showed both rules, the intro and the Note line.
    - `Note exists` through the API: 0.
  - A template made in the Templates page with an uploaded image:
    - The API's usage showed `templateCount: 1`.
    - The image manager's Usage column showed 1.
    - Delete showed "Affected templates (up to 5): Letterhead (image check)". It was cancelled,
      so the image is kept.
  - No console errors.

## Open Items / Notes

- **Behaviour changes worth knowing before release:**
  - The Preview now shows an unclosed `---` block as text, not as hidden front matter.
  - Search for a non-ASCII word now finds other cases of it.
  - Three more tools are marked destructive, so some clients may ask for confirmation.
  - `owner missing` now includes Documents without front matter.
- **Not changed:**
  - Kelvin sign (U+212A) and dotted capital I (U+0130) are not folded to their ASCII lower case
    by the SQL side of search. Documented in code.
  - Front matter longer than 16 KB is not seen by property scans. `get_document_properties`
    reads the whole body.
- **Local dev data left in place:**
  - the Document "Rule at the top (check)";
  - the image `template-logo.png`;
  - the template "Letterhead (image check)";
  - all in the account `ai-expansion-check@example.test`.
