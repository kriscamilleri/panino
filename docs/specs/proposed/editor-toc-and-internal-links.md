# Table of Contents and Internal Links — Spec

> Insert a table of contents into a Document and refresh it when the headings change, and link
> to a heading in the same Document, to another Document, or to a heading in another Document.
> Everything is stored as ordinary Markdown, so the Preview, the PDF, the phone, sync, shared
> spaces, backups and other Markdown tools all read it without a new storage format.
> Status: proposed
> Created: 2026-11-07
> Last updated: 2026-11-07 — Kris answered Q1–Q6
> Requested by: Kris ("Insertable table of contents, which can be refreshed, similar to the Odoo
> add-on; internal links to the same and other Documents")

---

## 1) Summary

**Table of contents.** **Table of contents** (desktop editor toolbar, phone Document menu)
inserts a numbered, nested list of links to the Document's headings, between two marker comments, the
same way the Odoo add-on stores a sales order block. The list is a stored snapshot. When the
headings change, Panino shows that the table is out of date and offers **Refresh**, which
rewrites only the text between the markers. It is never rewritten automatically.

**Internal links.** Links are standard Markdown links:

| Target | Stored as |
|---|---|
| A heading in this Document | `[Budget](#budget)` (GitHub-compatible slug) |
| Another Document | `[Project plan](panino:doc/6f1c…-uuid)` |
| A heading in another Document | `[Budget](panino:doc/6f1c…-uuid#budget)` |

People write them by typing `[[` (a picker opens), with **Ctrl/Cmd+K**, with the toolbar
**Link** button, or with the phone **Link** key. Clicking a link in the Preview scrolls to the
heading, or opens the other Document in the app (Back returns). A link whose target is gone, or
in a database the reader cannot open, is styled as broken and does not navigate. In a PDF,
links within the Document jump to the heading, and links to other Documents open that Document
in the Panino web app. The address is built from the configured `FRONTEND_URL`, and the reader
must sign in and have access (§6.8).

Both features depend on one new piece of shared rendering: **heading ids**. Today no heading has
an id (`shared/markdownRender.js:72-74`).

### Decisions (Kris, 2026-11-07)

| # | Question | Decision | Where |
|---|---|---|---|
| Q1 | Stored snapshot (the Odoo sales order block pattern) or Odoo Knowledge's live table of contents | **The sales order block pattern**: a stored snapshot between markers, manual Refresh, stale notice | §4.1 |
| Q2 | Default heading levels | **Adaptive**: H2–H3, or H1–H2 when the Document has several H1s; written into the marker on Insert | §4.3 |
| Q3 | Default list style and title | **Numbered** (nested ordered lists) by default, with Bullets as an option; title "Contents" | §4.2, §4.3, §4.6 |
| Q4 | Links to other Documents in a PDF | **Links to the Panino web app**, built on the API from `FRONTEND_URL` and never from a request's Host. The reader signs in and needs access | §6.3, §6.8, §9 |
| Q5 | Hand-written `#/…` app links in Documents | **Inert** | §6.3, §9 |
| Q6 | ZIP export/import link rewriting | **In v1** (Phase 5) | §6.7 |

---

## 2) Problem

- Long Documents (proposals, handbooks, specs) have no navigation. People write a contents
  list by hand, and it goes stale.
- There is no way to refer from one Document to another except by pasting the browser address,
  which embeds the host and the database key and goes to the wrong place for anyone else.
- **Fragment links are broken today.** The app uses hash routing (`frontend/src/router.js:25`).
  A link written as `[Budget](#budget)` renders as `<a href="#budget">` with no target id
  anywhere (no heading has an id). Clicking it in the Preview passes `#budget` to vue-router as
  a route, and no route matches. Nothing intercepts the click: `Preview.vue:253-262` only
  handles task checkboxes.
- Any `#/…` link in a Document also navigates the app today. That includes a link to the AI
  agents add-on's OAuth consent page, `#/addons/ai/authorize?...`, which can be put in a shared
  space Document (see §9).

---

## 3) Goals

1. Insert a table of contents in one action on desktop and phone, and refresh it in one action.
2. Show when a table of contents is out of date. Never rewrite text the person did not ask to
   rewrite.
3. Link to headings and Documents by id, so renaming or moving a Document within its database
   does not break the link.
4. Make links quick to write: `[[` and Ctrl/Cmd+K open the same picker, which searches every
   database the person can open.
5. Follow links in the app: the Preview (click or tap), the editor (Cmd/Ctrl+click, or OverType's
   link tooltip), with browser history.
6. Keep output sensible elsewhere. The Markdown is plain CommonMark. A table of contents works
   on GitHub as it is. In a PDF, links within the Document jump to the heading, and links to
   other Documents open them in the web app for readers who have access.
7. Add no new XSS or navigation vector, and close the existing `#/…` navigation hole.
8. No schema change and no new API route.

## Non-goals (v1)

- A live table of contents that updates as you type (§4.1, decided by Kris).
- Page numbers in a table of contents. Chromium does not support `target-counter()`.
- Numbering the headings in the body (1.2.3), or outline numbering such as 1.1 in the table.
  Each nested level counts from 1 (§4.3, open question N2).
- `[[Wiki links]]` as a stored syntax, or links by title.
- Links to folders, spaces or images. Transclusion or embedding of another Document.
- A backlinks panel ("Linked from"), a link graph, or a warning on delete. These are follow-ups
  (§15). The format is designed so they can be added without a migration.
- Rewriting links when a Document is transferred between databases (§7.1), and updating link
  text when a target is renamed.
- A floating outline or navigator panel. It is useful and would use the same outline utility,
  but it is a separate feature.
- Changes to the Odoo, GitHub or AI agents add-ons. Their follow-ups are in §15.

---

## 4) Table of contents

### 4.1 Decisions

| Question | Options considered | Decision | Why |
|---|---|---|---|
| Stored or rendered live | (a) a `[TOC]` placeholder expanded at render time; (b) a stored snapshot between markers; (c) a snapshot that the Preview and PDF ignore, rendering live instead | **(b) Stored snapshot** (Kris, 2026-11-07) | This is the Odoo sales order block pattern Kris pointed to (`docs/specs/active/odoo-sales-order-blocks.md` §2). The Markdown is the output, so GitHub, Obsidian, exports, Knowledge and the AI agents API all see a real list. (a) leaves a literal `[TOC]` everywhere the renderer is not Panino's. (c) makes the Markdown and the Preview disagree. |
| Refresh | automatic on every edit; on save; manual with a stale notice | **Manual, with a stale notice** in the Preview, on the toolbar button, in the phone menu and in PDF export (Kris, 2026-11-07) | Automatic rewrites add undo entries and revisions the person did not make. When two offline devices both rewrite the same region, the sync merge conflicts. When two people in a live session both refresh, the Yjs merge can duplicate inserted lines (§8). A stale notice gives the same correctness and keeps the person in control. |
| Delimiting | `<!-- toc -->`…`<!-- tocstop -->` (markdown-toc convention); `[[_TOC_]]` (GitLab); namespaced comments | **`<!-- panino:toc {json} -->` … `<!-- /panino:toc -->`** | This matches the add-on convention `<!-- odoo:sale.order {json} -->`. The namespace avoids capturing another tool's markers in imported Markdown. Comments render as nothing in every Markdown renderer, and DOMPurify drops them, so the settings never reach HTML. |
| Ownership | Panino owns the text between the markers | Same rule as Odoo blocks: edits inside are lost on the next Refresh | A simple rule that people can learn. |
| List style | bullets; numbered | **Numbered by default**, Bullets as an option (Kris, 2026-11-07) | Numbers make a contents list easy to refer to ("see 3"). Nested ordered lists are plain CommonMark, so they render the same everywhere (§4.3, §4.6). |

### 4.2 Block format

```markdown
<!-- panino:toc {"v":1,"min":2,"max":3} -->
**Contents**

1. [Introduction](#introduction)
   1. [Background](#background)
   2. [Scope](#scope)
2. [Budget](#budget)
   1. [Q&A](#qa)
<!-- /panino:toc -->
```

- **Opening marker**: `<!-- panino:toc <json> -->` alone on a line at column 0. JSON fields:
  - `v`: format version, `1`.
  - `min`, `max`: heading levels, `1 ≤ min ≤ max ≤ 6`.
  - `numbered`: absent or `true` writes ordered lists (the default); `false` writes bullet lists.
  - `title`: the label above the list. Absent means `"Contents"`; `""` means no label. At most
    80 characters.

  Insert always writes `v`, `min` and `max`, and writes the others only when they differ from
  the default. `<` and `>` in the JSON are written as `\u003c` and `\u003e`, as Odoo does, so
  the comment can never close early. A bare `<!-- panino:toc -->` (written by hand) is valid and
  uses the defaults (§4.3).
- **Closing marker**: `<!-- /panino:toc -->` alone on a line.
- **Body**: the optional title as a bold paragraph, then the list. The title is a paragraph, not
  a heading, so the table never lists itself and does not appear in PDF bookmarks.
- A Document with no matching headings gets `*No headings yet.*` as its body, so the block stays
  visible and can be refreshed.
- **Damaged blocks** are listed and never rewritten, as in Odoo (`saleOrderBlock.js:109`). A
  block is damaged when its JSON does not parse or fails validation, or when its closing marker
  is missing (an unclosed block ends where the next opening marker starts). Refresh says
  "The table of contents can't be refreshed: its end marker is missing" and points to it.
- Markers inside fenced or indented code, or indented under a list or quote, are not blocks.
  This is stricter than the Odoo finder, which is line-based and does not skip fences
  (`saleOrderBlock.js:109-138`). The generic helper fixes it for both (§4.8).

### 4.3 What goes in the list

- **Source of headings**: the MarkdownIt token stream of the Document after front matter is
  removed and `{{ variables }}` are applied. This is the same text the Preview renders. Regular
  expressions are not used, so the following are handled correctly:
  - fenced code (```` ``` ```` and `~~~`) and indented code are ignored;
  - setext headings (`Title` / `===`) count;
  - front matter is ignored;
  - raw HTML headings (`<h2>`) are not listed and get no id.
- **Levels**: the defaults are adaptive and are written into the marker when the table is
  inserted, so Refresh gives the same result later:
  - `min` is 2 when the Document has at most one level-1 heading (the common "title, then
    sections" shape), and 1 otherwise;
  - `max` is `min + 1`, capped at 6. With the default `min` of 2 that gives H2–H3.

  Decided by Kris, 2026-11-07.
- **Nesting**: headings inside a blockquote, list or table cell get ids but are not listed. A
  level that is skipped (H2 → H4) nests one step deeper than its parent, never more, so the
  list stays valid Markdown.
- **Opt-out**: a heading whose line ends with `<!-- omit from toc -->` is skipped. This is the
  VS Code "Markdown All in One" convention, so Documents that already use it behave.
- **Labels**: the heading's plain text (inline code keeps its text, images their alt text,
  links their text, inline HTML dropped). It is taken before MarkdownIt's typographer
  replacements, so `--` stays `--` (§5.1). Labels are escaped so they can only be text: `\`,
  `[`, `]`, `*`, `_`, `` ` ``, `~`, `|` and `<` are escaped, and `&` is escaped before
  something that would read as an entity. The first `{` of `{{` becomes `&#123;` so a heading
  cannot inject a variable. The core helper generalises Odoo's `escapeCell`
  (`saleOrderBlock.js:158`).
- **Variables**: a heading such as `# {{ title }}` is listed with the substituted text. If the
  value changes, the table becomes stale. A heading containing `GLOBAL_DATE` or `GLOBAL_TIME`
  goes stale every day or minute; this is accepted and documented in the options dialog's help
  line.
- **Links**: `(#slug)` with the slug rules in §5.1. Duplicate headings get `-1`, `-2` in
  Document order, so both entries point to the right section.
- **Numbering** (the default, `numbered` absent or `true`): ordered lists at every level.
  - Numbers are written out in sequence (`1.`, `2.`, `3.` …) and restart at 1 under each
    parent. Writing `1.` for every item would also render correctly, but the raw Markdown would
    be harder to read.
  - A child list is indented by exactly the width of its parent's marker: 3 spaces under `1. `,
    4 under `10. `. CommonMark needs that indent for the child to belong to the parent item. A
    fixed 3-space indent would push the children of item 10 out of the list, so the builder
    computes the indent per parent, and a test covers more than nine items at a level.
  - Lists start at 1, so no `start` attribute is needed. GitHub, VS Code, Obsidian, pandoc and
    markdown-it all render the same nested decimal lists.
- **Bullets** (`numbered: false`): `-` items, indented two spaces per level.
- Outline numbering such as 1.2.1 is a non-goal (open question N2).

### 4.4 Insert, refresh and options

All edits go through `editorStore.transformText(fn)` with pure functions, like the phone key row
and Odoo blocks. Each edit is one undo step and saves, syncs and travels through a live session
like any other edit. Generation is synchronous, so the function reads the current text,
re-finds the blocks and rewrites them in one step. This avoids the stale-block race that Odoo's
`replaceBlock` guards against (`saleOrderBlock.js:331`), because no network call sits between
reading and writing.

| Action | Rule |
|---|---|
| **Insert** | **Desktop**: after the line the caret is on, as its own paragraph (Odoo's `insertBlock`, `saleOrderBlock.js:308`). **Phone**, or a desktop editor that has never had focus: after the leading H1 if the body starts with one, otherwise at the top of the body. A caret inside front matter, a code fence or another marker block moves to just after it. With one table already present, Insert is replaced by Refresh. |
| **Refresh** | Rewrites every closed, valid table in the Document; text outside them is byte-identical. When nothing changed, the toast says "Table of contents is up to date" and no edit is recorded. |
| **Options…** | A small form: levels from/to (H1–H6), list style (Numbered, the default, or Bullets), Title (with "No title"). Apply rewrites the marker and refreshes. The same form `TocOptionsForm.vue` is used in a desktop `BaseModal` and in a phone sheet `?sheet=toc`. |
| **Remove** | Deletes the block with its markers (one undo step). |
| **Stale** | `isTocStale(text)`, debounced at 300 ms. It compares each block's body with what Refresh would write, ignoring trailing whitespace. |

Insert and Refresh go through `editingBlocked()` (`Editor.vue:925`), like every toolbar edit.
They are off with no Document selected.

### 4.5 Where it appears

**Desktop**: in `SubMenuBar.vue`'s editor group, beside Link and Page Break.

- A `ListTree` icon button "Table of contents" opens a menu with Insert or Refresh, Options…
  and Remove. (Lucide 0.395 has no `table-of-contents` icon.)
- While a table is stale the button carries a small dot and the title "Table of contents (out
  of date)".
- Test ids: `submenu-editor-toc`, `submenu-editor-toc-insert`, `-refresh`, `-options`,
  `-remove`.
- **No default keyboard shortcut.** The obvious chords are taken: Ctrl+Shift+O opens Chrome's
  bookmarks, Ctrl+Alt+T opens a terminal on GNOME, and Ctrl+Shift+T reopens a tab. The menu is
  reachable from the keyboard like the rest of the toolbar.

**Phone**: in `phone/DocumentMenuSheet.vue`.

- A "Table of contents" row (`phone-menu-toc`) reads "Insert table of contents", or "Refresh
  table of contents" with a secondary line "Out of date" when stale.
- A second row "Contents options" (`phone-menu-toc-options`) opens `?sheet=toc`.

**Preview, both layouts.**

- While any table is stale, a slim bar above the rendered content reads "The table of contents
  is out of date" with a **Refresh** button (`preview-toc-stale`, `preview-toc-refresh`). It is
  outside the sanitized HTML, so it needs no DOM injection.
- It is hidden when the Preview shows a `source` (capture drafts, style samples).

**PDF export**: `PrintStylesPage` and `phone/ExportSheet.vue` show the same notice with
**Refresh**, and do not block export.

### 4.6 Rendering

- A core MarkdownIt rule replaces the two marker `html_block` tokens with fixed HTML:
  `<nav class="pn-toc" aria-label="Table of contents">` and `</nav>`. Both are built from
  constants; nothing from the marker JSON reaches HTML. DOMPurify's default configuration keeps
  `nav` and `aria-label`.
- The list renders with the Document's own list styles (named styles style `ul`/`ol`/`li`
  inline). Custom CSS may target `.pn-toc`. The PDF print CSS adds
  `.pn-toc { break-inside: avoid-page }` for tables shorter than a page.
- **Nested numbering in the Preview and PDF.**
  - The default style puts `list-style-type: decimal; margin: 0 0 1rem 1.5rem` inline on every
    `ol` (`shared/styleDefaults.js:15`), and similar values on `ul`. Each nested list would
    therefore get a 1rem gap under it.
  - The Preview's scoped stylesheet and the fixed base stylesheet `pdf.js` puts in every PDF
    page both add
    `.pn-toc :is(ol, ul) :is(ol, ul) { margin-top: 0 !important; margin-bottom: 0 !important; }`.
    A stylesheet `!important` beats a non-important inline style, and the rule touches nothing
    outside a table of contents.
  - Every level shows decimal numbers (1., 2.), as browsers and other tools draw nested `ol`.
    If a named style changes `list-style-type` for `ol`, the table follows it.
- In the PDF, `#slug` links become internal links (§6.3). In other tools the comments vanish and
  the list remains.

### 4.7 Elsewhere

- **Card and search snippets** (`utils/markdownSnippet.js`) skip everything between the TOC
  markers. Otherwise every card of a Document with a table would start with "Contents
  Introduction Background…". Inline HTML is already stripped (`markdownSnippet.js:28`), but the
  list items would not be.
- **Templates and Duplicate** copy the block. It refreshes against the new Document.
- **Revision history** shows a Refresh as an ordinary change.

### 4.8 Relation to the Odoo add-on

| | Odoo sales order block | Core table of contents |
|---|---|---|
| Storage | Markdown between `<!-- odoo:sale.order {json} -->` and `<!-- /odoo:sale.order -->` | Same shape, `panino:toc` |
| Refresh | Manual, per block or all | Manual, all tables in the Document |
| Ownership | Panino owns the inside | Same |
| Source | Odoo API (async, needs a connection) | The Document's own headings (sync, offline) |
| Damaged/unclosed | Listed, never rewritten | Same |

**Reused as is**: the conventions (namespaced marker with versioned JSON, `\u003c`/`\u003e`
escaping, the insert-after-caret-line rule, editing through `transformText`, never rewriting a
damaged block) and the user-facing wording ("Refresh", "Refresh all").

**Generalised into core**: a new pure module, `shared/markerBlocks.js`, with:

- `findMarkerBlocks(text, name)`: fence-aware, returns `{ start, end, raw, json, closed }`;
- `insertMarkerBlock(state, markdown, { position })`;
- `replaceMarkerBlocks(state, name, render)`;
- `escapeInlineText(text)`.

The TOC uses it from day one.

**The Odoo code does not move to core.** It is about sales orders, its refresh needs the Odoo
API, and core must never import an add-on (`docs/specs/active/addon-folders.md` §3, goal 1, and §2 "Dependency direction").
Add-ons may import core, so `addons/odoo/utils/saleOrderBlock.js` can later swap its own
`findBlocks`/`insertBlock`/`replaceBlock`/`escapeCell` for the shared helpers. That gives it the
fence-awareness fix. It is a separate, optional change in the add-on (§15, F4). Nothing in this
spec requires it.

---

## 5) Heading ids

### 5.1 Slugs

The rules are GitHub-compatible, so a table or link written in Panino works on GitHub and the
reverse:

1. Take the heading's text before typographer replacements. A core rule runs after `inline` and
   before `replacements`/`smartquotes`. Variables are already applied.
2. Lower-case it (Unicode-aware).
3. Remove every character that is not a letter, mark, number, space, `-` or `_` (Unicode
   classes `\p{L}\p{M}\p{N}`).
4. Replace each space with `-`. Spaces are not collapsed, matching GitHub.
5. An empty result becomes `section`. Cap at 200 characters.
6. Duplicates take `-1`, `-2`, … in Document order, counted over **all** headings, whether
   listed or not.

Implemented in-house (about 20 lines, `shared/documentOutline.js`), not as a dependency.
Tests include github-slugger's own fixtures.

### 5.2 Ids in HTML

Headings render with `id="pn-<slug>"`. The prefix is required:

- **DOMPurify removes clobbering ids.** With its default `SANITIZE_DOM`, an `id` whose value is a
  property of `document` or a form is removed. A heading "Images", "Forms", "Links", "Title",
  "Body", "Cookie" or "Domain" would silently lose its id in both the Preview and the PDF
  sanitizer (`pdf.js:739`).
- The Preview lives inside the app's DOM, so an unprefixed id could collide with an app element
  id (for example `markdown-custom-styles`, `markdownStore.js:117`).

In-Document links keep the GitHub form `#slug` in Markdown. The renderer rewrites the href to
`#pn-<slug>` when the slug belongs to a heading in the Document, and adds `data-pn-heading`. Any
other fragment (for example one aimed at a raw-HTML `<a id>`) is left alone.

The shared fixture `shared/tests/fixtures/document.html` changes: its headings gain ids. Both
the shared and the backend `sharedRender.test.js` compare against it and are updated together.
Odoo Knowledge's sanitizer drops `id` (`addons/odoo/knowledge.js:34`) and leaves it out of the
body signature, so no Knowledge sync is marked changed by this.

---

## 6) Internal links

### 6.1 Syntax decision

| Option | Stored | Works after rename/move | Elsewhere (GitHub, Knowledge, exports) | Verdict |
|---|---|---|---|---|
| `[[Title]]` | title | No: rename breaks it; titles are not unique across folders and spaces | Literal brackets; needs a parser plugin in every renderer | Rejected as storage; kept as the **typing trigger** |
| `[[uuid\|label]]` | id | Yes | Unreadable literal text | Rejected |
| `[x](#/doc/<uuid>)` | id | Yes | A dead fragment; passes Knowledge's sanitizer as a broken link; ties content to hash routing, so a move to HTML5 history would break every stored link | Rejected |
| `[x](https://host/#/doc/<uuid>?dbKey=…)` | id, host, database | Yes | Clickable but needs a login; embeds dev/prod host and the author's `user:<uuid>` | Rejected; recognised **on paste** and converted (§6.4) |
| **`[x](panino:doc/<uuid>#slug)`** | id (+ slug) | Yes, within the database | A standard Markdown link. Any sanitizer that does not know the scheme drops the href and keeps the text: DOMPurify's default `ALLOWED_URI_REGEXP`, Knowledge's (`knowledge.js` `ALLOWED_URI_REGEXP`), GitHub's | **Recommended** |

Reasons: it is plain CommonMark link syntax; it is independent of host and router; it fails
safe outside Panino; it is easy to find with `LIKE '%panino:doc/<id>%'` for backlinks and
export rewriting; and the scheme leaves room for `panino:folder/…` later. Unknown kinds render
as broken links.

**Grammar**, case-insensitive on the UUID:
`panino:doc/<uuid v4 form>` optionally followed by `#<slug>`. The slug is percent-decoded (markdown-it
percent-encodes non-ASCII through `normalizeLink`) and must match the §5.1 alphabet. Anything
else beginning `panino:` is a broken link.

### 6.2 What is stored, and how it resolves

- **Only the Document id**, never the database key. UUIDs are unique across databases, and a
  `user:<uuid>` key in a space Document would show members the author's account id.
- **Resolution** happens on the reader's device, against the databases open there
  (`syncStore.databases`):
  - the Document's own database first, then personal, then spaces;
  - one parameterized `SELECT id, title, folder_id FROM notes WHERE id IN (?, …)` per database,
    in chunks of at most 500 ids.

  The result `{ dbKey, title, folderPath, spaceName }` is cached per id. The cache is cleared
  when the structure changes (`markContentChanged`), when a database opens or closes, and after
  a sync pull. New store function: `docStore.resolveDocuments(ids)`.
- **Rename and move within a database**: the link keeps working. Its label is the author's words
  and is not changed; the tooltip shows the current title and location.
- **Hard delete**: in the app, Delete removes the row (`structureStore.js:255`). The link
  becomes broken.
- **Trash**: the AI agents add-on's `move_document_to_trash` moves a Document into a top-level
  folder named "Trash" (`addons/ai/documentService.js:496`, on the current branch). To core that
  is an ordinary folder, so the link resolves and the tooltip shows "Trash" as its location.
  Core does not special-case an add-on's folder name.
- **Cross-database transfer**: a copy or move between personal and a space creates a new id
  (`spaceTransfer.js:644`). Links to the original then point at the source, which is gone after
  a move. This is documented as broken in v1 (§7.1); follow-up F5 rewrites them.
- **Not reachable by the reader**: a link in a space Document to a Document in the author's
  personal database, or in a space the reader is not in, does not resolve on the reader's
  device. The reader cannot tell "deleted" from "not shared with you", and must not be able to.
  So there is one state, with the tooltip "Not found, or not shared with you".

### 6.3 Rendering per output

A new MarkdownIt plugin, `shared/documentLinks.js`, is installed by `createDocumentRenderer({
documentLinks })`.

| Output | `documentLinks` | Same-Document `#slug` | `panino:doc/<id>[#slug]` |
|---|---|---|---|
| Preview | `'app'` | `<a href="#pn-slug" data-pn-heading="slug">` | `<a href="#/doc/<id>?heading=slug" class="pn-doc-link" data-pn-doc="<id>" data-pn-heading="slug">` |
| The person's own PDF export (`PrintStylesPage`, phone `ExportSheet`) | `'pdf'` | Same as Preview. Chromium turns same-document anchors into internal PDF links (verified by test, §12) | `<a class="pn-doc-link" data-pn-doc="<id>" data-pn-heading="slug">label</a>` **with no href**, only for ids that resolved for the author at export time, otherwise the `<span>` below. The API adds the web-app href (§6.8) |
| Default: the Odoo send (`useDocumentPdfRequest`, `useDocumentArticle`), Knowledge sync and sync PDFs, anything else | `'text'` | Same | `<span class="pn-doc-link">label</span>` |
| Invalid `panino:` link | any | n/a | `<span class="pn-link-broken">label</span>` |

The default is `'text'`. A caller gets web-app links in a PDF only if it asks twice:

1. it renders with `'pdf'`, which only the two export screens do, through
   `getPrintMarkdownIt(styles, { documentLinks: 'pdf' })`; and
2. the request goes through `POST /render-pdf`, the only API path that adds hrefs (§6.8).

The plugin builds hrefs only from a validated UUID and slug, and never copies the author's
string.
The styled renderer's external-link rule (`styledRenderer.js:135-145`, `target="_blank"` for
`http…`) does not see these hrefs (they start with `#`), and keeps its behaviour for external
links.

**App-route links** (`#/…` written by hand, other than the plugin's own output) are rendered
inert as `pn-link-broken` with the title "Links to Panino screens aren't supported" (Kris,
2026-11-07). See §9 for what this does and does not prevent.

### 6.4 Writing links

The picker is one component, `LinkPicker.vue`. The data comes from
`docStore.searchDocuments({ scope: 'titles' })` (`docStore.js:246`), which already searches
every database with folder paths and space names, plus `getDocumentOutline(id, dbKey)` for
headings.

| Trigger | Where | Behaviour |
|---|---|---|
| Type `[[` | desktop editor | A popover at the caret, positioned with a mirror-element caret measurement; it falls back to the editor's top edge. Typing filters, ↑/↓ move, Enter/Tab choose, Esc closes and leaves the typed text. On choosing, `[[query` is replaced by the link. |
| `[[#` | desktop editor | Lists this Document's headings and writes `[Heading](#slug)`. |
| Choose a Document, then type `#` | picker | Lists that Document's headings and writes `[Heading](panino:doc/<id>#slug)`. |
| **Ctrl/Cmd+K** | desktop editor | Opens the picker in "link" mode. Selected text becomes the label and the first query. The field also accepts a web address: Enter writes `[label](https://…)`. This replaces OverType's built-in Ctrl/Cmd+K, which inserts `[sel](url)` (§6.5). |
| Toolbar **Link** (`submenu-editor-link`) | desktop | Opens the same picker instead of inserting `[Link text](url)` (`Editor.vue:1310`). |
| **Link** key (`markdownKeys.js:160`) | phone key row | Opens `?sheet=link`, `phone/LinkSheet.vue`: the same picker as a full-height sheet pinned to the visual viewport, with an autofocused search. Choosing inserts at the caret through `transformText` and closes the sheet. |
| Type `[[` | phone editor | Opens the same sheet with the query box focused. |
| Paste a Panino address | both | Pasting `<this origin>/#/doc/<uuid>[?…]` converts it to `[<current title>](panino:doc/<uuid>)`. The title is looked up locally; if the Document is not found, the address is pasted unchanged. This goes in the existing paste handler. |

Picker rows show title, location ("Acme space · Proposals / 2026") and update time. Results are
ordered: this Document's database first, then recently updated, at most 20.

**Choosing a target in a different database from the current Document** shows an inline note
before insertion, for example "Members of Acme may not be able to open this Document". The
label (the target's current title, escaped with `escapeInlineText`) is visible to the author
before it is written.

### 6.5 Following links

**Preview** (`Preview.vue`, both layouts). One delegated click handler on `contentRef`; the
existing task-checkbox branch stays.

- **Same-Document heading** (`data-pn-heading` without `data-pn-doc`, or a bare `#…` href):
  `preventDefault`, then scroll the Preview's nearest scrolling ancestor so the heading's top
  sits 16 px below the container's top edge, then focus the heading (`tabindex="-1"`, added
  after render) for screen readers. No history entry, and the route is untouched. A fragment
  that matches no element inside `contentRef` (checked after render) gets `pn-link-broken`.
- **Other Document** (`data-pn-doc`): `preventDefault`.
  - If it resolves, `await editorStore.flushPendingSave()`, then
    `router.push({ name: 'doc', params: { fileId }, query: { dbKey, heading } })`. This is the
    same route every other "open Document" uses (`TreeItem.vue:441`,
    `DocumentDashboard.vue:383`, `PhoneFolderView.vue:419`), so Back returns.
  - If it does not resolve, show the toast "This Document isn't available. It may have been
    deleted, or it isn't shared with you." and do not navigate.
  - A link to the Document itself acts as a same-Document heading link.
- **Modified clicks** (Ctrl/Cmd/middle) on a resolved Document link are left to the browser, so
  `#/doc/<id>?heading=…` opens in a new tab.
- **External links**: unchanged (`target="_blank" rel="noopener noreferrer"`).
- **Inert contexts**: with the `source` prop (capture drafts, Styles samples) every internal link
  is inert, so a capture is never left by accident.

**Decoration after render.** A watcher on `renderedHtml` resolves the `data-pn-doc` ids and sets
the following through DOM APIs, never HTML strings:

- `title`: the current title and location, or "Not found, or not shared with you";
- `pn-link-broken` for unresolved links.

This is the same post-sanitize DOM pass as `enableTaskCheckboxes` (`Preview.vue:241`). The
computed HTML stays pure and synchronous. At most 500 unique ids are decorated per render.

**Arriving at a heading.** `HomePage.applyRouteSelection` (`HomePage.vue:87-101`) changes in two
ways:

1. Without a `dbKey` query it looks the id up across open databases instead of assuming
   personal (today `HomePage.vue:88-90` falls back to the personal database). This makes
   new-tab, hand-typed and PDF `#/doc/<id>` addresses work for space Documents too. The full
   deep-link rules are in §6.8.
2. When `route.query.heading` is set, `ContentArea` (desktop) or `PhoneEditor` (phone, opened in
   Preview mode) scrolls to `#pn-<heading>` once, after the first render of that Document.
   - If the heading is missing, the Document opens at the top with the toast
     "Heading not found".
   - If the Preview is hidden on desktop, the editor caret moves to the heading's source line,
     from token `map` plus the front-matter offset.

**Editor.**

- **Cmd+click** (macOS) or **Ctrl+click** (others) on a link in the editor follows it:
  - internal links as above;
  - same-Document headings move the caret to the heading line and scroll the Preview;
  - external links open in a new tab.

  It is Cmd on macOS because Ctrl+click there is a secondary click. A pure
  `linkAt(text, offset)` finds the link under the caret after the click.
- **OverType's link tooltip** shows when the caret is inside a link and calls
  `window.open(url, '_blank')` on click (`overtype/src/link-tooltip.js:101-105`). For
  `panino:` or `#…` that opens an unknown scheme or a broken route in a new tab. It is patched in
  `useOverTypePatches.js` to call Panino's follow handler for internal links, and keeps
  `window.open` for `http(s)`/`mailto`.
- **Ctrl/Cmd+K.** OverType's `ShortcutsManager` handles Ctrl/Cmd+K itself
  (`overtype/src/shortcuts.js:45`). It runs before the `onKeydown` option, and the option is
  not called once a shortcut has handled the key (`overtype/src/overtype.js:596-601`). So
  Panino's `handleKeydown` (`Editor.vue:452`) never sees the key. `useOverTypePatches.js` wraps
  `ShortcutsManager.prototype.handleKeydown` so that `k` returns unhandled, and Panino's
  handler opens the picker. Bold, italic and list shortcuts are unchanged. OverType is pinned at
  1.2.7. A test fails if an upgrade moves the shortcut.

### 6.6 Shared spaces

- **A link from a space Document to the author's personal Document**:
  - the author is warned when inserting it (§6.4);
  - for the author it resolves normally;
  - other members see a broken-styled label with "Not found, or not shared with you", cannot
    navigate. Their own PDF export prints it as plain text, because it does not resolve for
    them (§6.8). A PDF Alice exports carries a web-app link, and it shows other members the
    "isn't available" screen.
  - Members learn only what the author wrote: the label and an opaque UUID that grants nothing.
- **A link between two spaces**: it resolves for members of both and is broken for everyone
  else.
- **Leaving or losing a space**: the space's local database is removed
  (`docs/architecture/data-model.md`, "Browser database registry"), so links into it become
  broken on that device on the next resolution pass.
- **A space not yet synced on this device**: links into it are broken until it opens, then
  resolve without a reload, because resolution re-runs when a database opens.

### 6.7 Export and import

| Path | Behaviour |
|---|---|
| **ZIP export** (`importExportStore.js:864`) | Rewrites `panino:doc/<id>[#slug]` to a relative path to the exported `.md`, for example `../Proposals/Project%20plan.md#budget`, using the same `getPath` names. Obsidian, VS Code and GitHub then follow it. A target outside the export is left as `panino:` (dead elsewhere, still working when re-imported into the same account). `_panino_metadata.json` gains `notes: [{ id, path }]`. |
| **ZIP and folder import** | After notes are created with new ids (`importExportStore.js:530`): relative `.md` links that resolve to an imported file become `panino:doc/<newId>`, and `panino:doc/<oldId>` links found in `_panino_metadata.json` are remapped. Any other `.md` link is left as it is. This also turns links in an imported Obsidian or VS Code folder into Panino links. |
| **JSON export / import** | Export keeps ids. Import remaps `panino:doc/<oldId>` → `<newId>` for Documents in the same file. Others are left alone (they may still resolve). |
| **StackEdit export** | Unchanged (`panino:` links stay; StackEdit drops them). |
| **Per-Document PDF** | §6.3, §6.8. |
| **Odoo send/sync, GitHub backup, AI agents API** | Unchanged in v1. Knowledge's sanitizer drops the unknown-scheme href and keeps the text. Follow-ups in §15. |

### 6.8 Links to other Documents in a PDF (Kris, 2026-11-07)

**What the link is.**

- `<FRONTEND_URL>/#/doc/<uuid>`, plus `?heading=<slug>` when it targets a heading. For example
  `https://panino.sh/#/doc/6f1c…?heading=budget`.
- Nothing else goes in: no `dbKey`, no user or space id, no token.
- So the PDF reveals the app's host, the target's UUID and the label the author wrote. The UUID
  grants nothing without a session that can already read the Document.

**Where it is built.** On the API, never in the browser, and never from a request's `Host`,
`Origin` or `X-Forwarded-*` headers.

- **Origin helper.** A new core helper, `backend/api-service/publicUrls.js`, has
  `appBaseUrl()`. It reads `FRONTEND_URL`, trimmed and without a trailing slash, with the same
  rule as the AI agents add-on's copy (`addons/ai/config.js:29-34`):
  - in development it falls back to `http://localhost:5173`;
  - in production it is `null` when unset;
  - a value that is not an absolute `http:`/`https:` URL counts as unset.

  Core cannot import the add-on's copy; the add-on may switch to the core one later.
- **Route.** The `POST /render-pdf` handler (`pdf.js:548-553`) passes
  `{ appLinks: appBaseUrl() }` to `renderPdf`. Inside `sanitizeDocumentHtml`, an
  `afterSanitizeAttributes` hook handles every `<a>` that carries `data-pn-doc`. It uses the
  same per-call pattern as `currentCssBudget` (`pdf.js:69`, `:737-746`):
  - with `appLinks` set, a valid UUID in `data-pn-doc`, and a valid slug in `data-pn-heading`
    when present, it sets `href` to the URL above, built with `new URL()` and
    `encodeURIComponent`, and replaces any href the element had;
  - otherwise it removes `href`, so the label prints as text;
  - in every case it removes `data-pn-*` from the output.
- **Every other caller of `renderPdf`** does not pass `appLinks`:
  - the Odoo send to Documents and chatter (`addons/odoo/routes.js:606`, `:694`);
  - Knowledge sync PDFs (`addons/odoo/sync.js:420`, through `syncScheduler.js:253`).

  So a `data-pn-doc` element in those requests prints as text, even one from a `'pdf'` render
  or hand-written raw HTML. The guarantee that the Odoo paths never emit app links holds at two
  layers: their client renders `'text'` (`useDocumentPdfRequest` keeps the default; it is used
  only by the Odoo send modal), and the API adds hrefs only on `/render-pdf`. Tests cover both
  layers (§12). Opting an Odoo path in would be an explicit change to its `renderPdf` call (open
  question N1).

**Which links.**

- Only links that resolved for the author at export time. The export screens
  `await docStore.resolveDocuments(ids)` before rendering and pass the resolvable ids in the
  render env; the others render as text. A link that is broken for the author would be broken
  for every reader.
- A heading link within the same Document, including `panino:doc/<own id>#slug`, stays an
  internal PDF link.

**When the origin is not configured** (production without `FRONTEND_URL`):

- Document links print as plain text, and the PDF still renders.
- The API logs one warning at startup, next to the add-on warnings (`index.js:118`): "FRONTEND_URL
  is not set; links to other Documents in PDFs print as plain text."
- Nothing about it reaches the client.

**Opening the link.** The reader opens it in a browser.

- **Not signed in**: the router guard sends them to sign-in with `redirect` (`router.js:164-176`).
  After sign-in and loading they return to the link with its `heading` query
  (`LoginForm.vue:25-31`, `LoadingPage.vue:60-63`). Both accept only paths starting with `/`.
- **Signed in**: the deep-link route below.

The link grants nothing. The reader sees only what their own account can open.

**The deep-link route** `#/doc/<id>[?heading=<slug>]` without `dbKey`:

1. `HomePage` calls `docStore.findDocumentDbKey(id)`. This is the same per-database lookup as
   link resolution: personal first, then spaces.
2. While the registry is still opening spaces, or the first sync after start is in flight, it
   waits in the normal loading state and re-checks as each database opens. It decides only once
   that first sync has finished (or failed offline), so a space Document is not reported missing
   just because it had not arrived yet.
3. **Found**: `router.replace` adds `dbKey` to the query, so a reload goes straight there. The
   Document opens and scrolls to the heading (§6.5). On a phone it opens in Preview mode.
4. **Not found**: an empty state (`doc-not-available`) reads "This Document isn't available. It
   may have been deleted, or it isn't shared with you.", with **Go to Home**.
   - The text and the timing are the same whether the id never existed, was deleted, or belongs
     to someone else.
   - The client knows only its own databases, so it cannot tell these apart, and it makes no
     server request that could.
5. A `dbKey` query that is present but unusable (not a canonical key, or not open on this
   device) is ignored and the lookup runs, instead of selecting nothing.

---

## 7) Data model and sync

- **No schema change.** Tables of contents and links are text in `notes.content`, which already
  syncs, merges (`shared/contentMerge.js`) and travels in live sessions. No backend route
  changes.
- **Backlinks** (follow-up F1) need no index to start: a `LIKE '%panino:doc/<id>%'` over each
  open database is local and cheap at Panino's sizes. If an index is ever needed, it should be a
  **client-local, derived, non-CRR** table rebuilt from content, like the existing client-local
  recovery tables. Nothing new then syncs, and `BASE_SCHEMA`/`CRR_TABLES` stay untouched. If a
  synced table were chosen instead, it must go in both frontend `DB_SCHEMA` and backend
  `BASE_SCHEMA`, and in `CRR_TABLES`; that is not recommended for data derivable from content.
- **Sync and merge**: a Refresh is an ordinary edit. If two devices edit inside the same table
  offline, the merge may conflict there. The resolution is to resolve the conflict and then
  Refresh. The same applies to any Odoo block.

### 7.1 Known break: cross-database transfer

A transfer gives the destination a new id (`spaceTransfer.js:644`). After a **move**, links to
the source id from other Documents become broken. After a **copy**, they keep pointing at the
source. v1 accepts this. Broken-link styling and a **Relink** action in the editor tooltip
(which opens the picker prefilled with the label) make it fixable. Follow-up F5 rewrites
`panino:doc/<old>` to `<new>` in the source database, which the actor can write, when a move
completes.

---

## 8) Edge cases

| Case | Behaviour |
|---|---|
| No headings | The table body is `*No headings yet.*`; stale once a heading appears |
| Heading only punctuation or emoji | Slug `section`, then deduped |
| Duplicate headings | `-1`, `-2` in order; inserting an earlier duplicate shifts the suffixes, so a hand-written `#overview-1` may retarget. Refresh fixes the table; the picker always writes current slugs |
| Heading renamed | The table is stale; links to the old slug are broken-styled |
| Headings in code fences, front matter, raw HTML | Not listed, no id |
| Headings in quotes or lists | Get ids, not listed |
| `<!-- panino:toc` inside a code fence | Not a block |
| Unclosed or invalid block | Listed as damaged; Refresh refuses with a message; Remove still works on the opening marker line |
| Two tables | Both refreshed; Insert is replaced by Refresh |
| CRLF text | Normalised to `\n` inside the rewritten block only |
| Non-ASCII slug | Percent-decoded before matching; written unencoded in Markdown |
| Typographer (`--`, quotes) | Slugs and labels from pre-typographer text (§5.1) |
| Heading with `{{ var }}` | Substituted text; stale when the value changes |
| Document over 1 MiB | Stale check debounced; outline reused from the Preview's render env, not a second parse |
| Editing held (conflict) | Insert/Refresh blocked by `editingBlocked()`; following links still works, and leaving the Document follows the existing selection behaviour |
| Live session | One collaborator's Refresh syncs to the others. Two simultaneous Refreshes can duplicate a line through the Yjs merge; the next Refresh repairs it |
| Link to self | Scrolls only |
| Link target in a space not yet loaded | Broken until it loads, then resolves |
| `[x](panino:doc/not-a-uuid)` | Broken style, no navigation |
| Capture draft and Styles sample previews | Links inert |
| Phone Preview with the keyboard closed | Scrolls the Preview container only, not `PhoneShell` |

---

## 9) Security review

| Threat | Control |
|---|---|
| XSS through heading text in the table | Labels are plain text from tokens, escaped by `escapeInlineText` (`<`, `[`, `]`, backslash, emphasis, `{{`). The rendered list then goes through markdown-it (`javascript:`/`vbscript:`/`file:`/`data:` refused by `validateLink`) and DOMPurify, as today. Tests: `# <img src=x onerror=alert(1)>`, `# [a](javascript:alert(1))`, `# {{ x }}` with hostile values, a heading containing `<!-- /panino:toc -->` |
| Early close of the marker comment | JSON `<`/`>` written as `\u003c`/`\u003e`; `title` capped and validated; a parse failure means damaged and never rewritten |
| Generated HTML | Only constants and validated pieces: the `nav` wrapper strings, `id="pn-<slug>"` (slug alphabet §5.1), `href="#pn-<slug>"`, `href="#/doc/<uuid>?heading=<slug>"`, `data-pn-doc`/`data-pn-heading` (same validated values), `class`. No author string is copied into an href. All of these pass the existing DOMPurify configurations unchanged; the Preview and PDF still sanitize everything (`Preview.vue:230`, `pdf.js:739`) |
| DOM clobbering by heading ids | The `pn-` prefix; DOMPurify `SANITIZE_DOM` stays on |
| In-app navigation from Document content | The Preview navigates only for plugin-built Document links, after resolving the id locally, through `router.push` to the `doc` route. Hand-written `#/…` links are rendered inert. This closes the current path by which a shared Document can send a member to any app screen in the same tab, including the OAuth consent page `#/addons/ai/authorize?…` (Kris, 2026-11-07). It narrows consent-page phishing but does not remove it: an absolute `https://<app>/#/addons/ai/authorize?…` link is an ordinary external link and still opens in a new tab (as it would from an email or any other tool). The consent page's own warnings and its explicit Allow remain the main defence |
| Leaking structure to space members | Links store no database key and no account id; resolution is local; unresolved has one message whatever the reason; tooltips are set with `setAttribute`, not HTML |
| SQL | Resolution and backlinks use parameterized `IN (?, …)` and `LIKE ? ESCAPE '\'` with the id passed as a parameter |
| External links | Unchanged: `target="_blank" rel="noopener noreferrer"` (`styledRenderer.js:140-143`), and Knowledge forces the same |
| PDF | No new request types; `#` anchors and link annotations make no network request; the renderer's allow-list (`pdfSanitize.js`) is untouched |
| Web-app URLs in PDFs (§6.8) | The origin comes only from `FRONTEND_URL` through `appBaseUrl()`, never from `Host`/`Origin`/`X-Forwarded-*`; it must be `http(s)`. The URL is built server-side from a validated UUID and slug with `new URL()`/`encodeURIComponent`; any client-supplied href on a `data-pn-doc` element is replaced. No `dbKey`, user id, space id or token is included. `data-pn-*` is stripped from the output. Only `POST /render-pdf` adds hrefs; Odoo sends and syncs never do. Opening the link requires sign-in, and access is the reader's own; a missing and a not-shared Document look the same |
| Imports | Link rewriting on import only touches links to Documents in the same import; paths are matched against the import's own file map, never resolved on disk |
| Resource limits | 500 ids decorated per render; picker capped at 20 results; stale check debounced; slugs capped at 200 characters |

---

## 10) Architecture

```text
shared/ (pure, used by the browser and the API)
  documentOutline.js   slugger, extractOutline(tokens), headingAnchors plugin (ids, env.outline,
                       #slug → #pn-slug)
  documentLinks.js     parseDocumentHref / formatDocumentHref, documentLinks plugin ('app'|'pdf'|'text')
  markerBlocks.js      findMarkerBlocks, insertMarkerBlock, replaceMarkerBlocks, escapeInlineText
  tableOfContents.js   parseTocConfig, buildTocMarkdown, insertToc, refreshTocs, isTocStale,
                       tocWrapper plugin (<nav>)
  markdownRender.js    createDocumentRenderer({ documentLinks = 'text' }) installs the three plugins
        │
frontend/src/
  store/markdownStore.js        Preview renderer 'app'; getPrintMarkdownIt(styles, { documentLinks })
                                defaults to 'text', the export screens pass 'pdf'
  pages/PrintStylesPage.vue, components/phone/ExportSheet.vue  resolve ids, render 'pdf'
  store/docStore.js             resolveDocuments(ids), getDocumentOutline(id, dbKey), findDocumentDbKey(id)
  composables/useDocumentLinks.js   resolution cache, follow(link), decoration
  composables/useTableOfContents.js insert/refresh/options/remove via editorStore.transformText, stale
  components/Preview.vue        click delegation, decoration, stale bar
  components/LinkPicker.vue, TocOptionsForm.vue, TocOptionsModal.vue
  components/Editor.vue         `[[` trigger, Mod+click, paste conversion, exposes caret rect
  composables/useOverTypePatches.js  Ctrl/Cmd+K and the link tooltip
  components/SubMenuBar.vue     TOC menu, Link opens picker
  components/phone/DocumentMenuSheet.vue, LinkSheet.vue (new), sheet ids `link`, `toc`
  pages/HomePage.vue, components/ContentArea.vue, components/phone/PhoneEditor.vue  heading arrival
  utils/markdownSnippet.js      skip TOC blocks
  store/importExportStore.js    link rewrite/remap
  pages/HomePage.vue            deep link without dbKey, `doc-not-available` empty state

backend/api-service/
  publicUrls.js (new)           appBaseUrl() from FRONTEND_URL
  pdf.js                        /render-pdf passes appLinks; sanitizer hook sets or strips hrefs
  index.js                      startup warning when FRONTEND_URL is unset in production
```

`shared/package.json` gains exports `./document-outline`, `./document-links`, `./marker-blocks`
and `./table-of-contents`.

**Backend changes are small**: the URL helper, one option on the `/render-pdf` call, one
sanitizer hook and one startup warning. Heading ids and `'text'` link rendering come through
the shared renderer. The Odoo add-on routes and sync, which call `renderDocumentHtml`
(`addons/odoo/routes.js:689`, `sync.js:455`) and `renderPdf` without `appLinks`, get text-only
Document links without any change to the add-on.

---

## 11) Implementation plan

Order per the `feature-development` skill. Each phase passes its tests before the next.

1. **Shared utilities (pure).**
   - Work: `documentOutline.js`, `documentLinks.js`, `markerBlocks.js`, `tableOfContents.js`;
     wire them into `createDocumentRenderer`; update the shared fixture.
   - Tests: `shared/tests/` and backend `sharedRender.test.js`.
2. **Rendering integration.**
   - Work: markdownStore modes. Preview click delegation for same-Document headings (this
     alone fixes the broken `#fragment` links), then Document links and decoration.
     `HomePage` lookup without `dbKey`, the `heading` query and the `doc-not-available` state.
     Inert `#/…` links. PDF: the `'pdf'` mode, `publicUrls.js`, the `/render-pdf` option, the
     sanitizer hook and the startup warning.
   - Tests: PDF internal-link, app-link and sanitizer tests.
3. **Store and composables.** `resolveDocuments`, `getDocumentOutline`, `findDocumentDbKey`,
   `useDocumentLinks`, `useTableOfContents`, and the stale computation.
4. **UI.**
   - Desktop: TOC menu and options modal, Preview stale bar, `LinkPicker` with `[[`, Ctrl/Cmd+K
     and the toolbar, OverType patches, Mod+click, paste conversion.
   - Phone: Document menu rows, `?sheet=toc`, `?sheet=link`, the Link key, the `[[` trigger.
   - PDF export stale notice.
5. **Export and import.** ZIP rewrite and remap, JSON remap, card snippets.

Phases 1–2 can ship alone as "headings have anchors and `#links` work". Phase 4 depends on 3.

---

## 12) Test plan

**Shared unit** (`shared/tests/documentOutline.test.js`, `documentLinks.test.js`,
`markerBlocks.test.js`, `tableOfContents.test.js`):

- Slugs against github-slugger fixtures (Unicode, punctuation, emoji, spaces, duplicates,
  empty); typographer-independence.
- Outline: code fences, `~~~`, indented code, setext, front matter, headings in quotes/lists,
  raw HTML headings, `<!-- omit from toc -->`, skipped levels.
- Ids: `pn-` prefix; `id="pn-images"` survives DOMPurify while `id="images"` would not (a
  regression test for the reason for the prefix).
- Links: valid, invalid UUID, uppercase UUID, percent-encoded slug, unknown `panino:` kind,
  `'app'`, `'pdf'` and `'text'` output (`'pdf'` emits no href, and only for ids in the render
  env), hand-written `#/settings` inert, external links still `_blank`.
- Numbering: the default writes ordered lists; children are indented by the parent marker's
  width, including under item 10 and later; rendering the built block with markdown-it gives
  properly nested `<ol>` (no item escaping its parent); `numbered: false` writes bullets; a
  bare marker is numbered.
- Blocks: find several, damaged JSON, unclosed, a marker inside a fence, CRLF; insert at the
  caret, after an H1, after front matter, not inside a fence; refresh leaves outside text
  byte-identical; refresh of an up-to-date table is a no-op; options rewrite the marker.
- Hostile headings from §9; a heading that spells the end marker.
- The stale check.

**Frontend unit/component** (`frontend/tests/unit/`):

- `previewLinks.test.js`: heading click scrolls and does not touch the router; Document click
  resolves and calls `router.push` with `dbKey`/`heading`; an unresolved link toasts and does
  not navigate; a modified click is not prevented; the `source` prop is inert; decoration sets
  `title` and the broken class.
- `useTableOfContents.test.js`: through a mocked `editorStore.transformText`.
- `linkPicker.test.js`: `[[` replacement, `[[#`, a Document then `#`, Ctrl/Cmd+K with a
  selection, the URL path, the cross-database note.
- `overTypePatches.test.js`: Ctrl+K reaches Panino; the tooltip routes internal links.
- `homePageRouteSelection.test.js`:
  - a missing `dbKey` is looked up and added with `replace`;
  - a space Document that arrives during the first sync is found, not reported missing;
  - a missing id and an id from another account show the same `doc-not-available` state;
  - an unusable `dbKey` is ignored;
  - a signed-out deep link keeps `heading` through sign-in and loading.
- `pdfExportLinks.test.js`:
  - `PrintStylesPage` and `ExportSheet` render `'pdf'` with only the resolved ids;
  - `useDocumentPdfRequest` (the Odoo send) renders `'text'`.
- `markdownSnippet.test.js`: TOC skipped.
- `importExportStore.test.js`: ZIP rewrite and remap; JSON remap.
- Existing `phoneComponents.test.js` and `subMenuBarToolsMenu.test.js`: extended for the new
  rows and test ids.

**Backend** (`npm run test:be`, Docker):

- `sharedRender.test.js` against the new fixture.
- `sanitizeDocumentHtml` keeps `pn-` ids.
- The app-link hook:
  - with `appLinks`, a valid `data-pn-doc` gets `href="<FRONTEND_URL>/#/doc/<id>?heading=<slug>"`;
  - a client-supplied href on such an element is replaced;
  - an invalid UUID or slug prints as text;
  - `data-pn-*` is stripped;
  - without `appLinks` there is no href.
- `/render-pdf`:
  - a request with `Host: evil.example` and `X-Forwarded-Host` still links to `FRONTEND_URL`;
  - with `NODE_ENV=production` and `FRONTEND_URL` unset, links print as text and the startup
    warning is logged;
  - a non-http `FRONTEND_URL` counts as unset.
- The Odoo send and sync paths (`routes.js`, `sync.js`), given HTML containing `data-pn-doc`,
  produce PDFs with no URI annotation for it.
- A PDF integration test renders a Document with a table of contents and a Document link. With
  pdf-lib it checks:
  - the table entries are link annotations with internal destinations (GoTo/Dest);
  - the Document link is a URI annotation equal to the expected `FRONTEND_URL` address;
  - no annotation contains `dbKey` or a user id.
- The Odoo `knowledge.test.js` gains a case: a `panino:` link arrives as text and heading ids
  are dropped.

**Browser** (dev stack, 1280 px and 375 px, Chromium; steps and results in the agent log):

- U1–U18 below.
- Check the console for errors after each.
- At 375 px, confirm the Link sheet stays above the keyboard and heading scroll moves only the
  Preview.

---

## 13) User journeys

| # | Persona | Journey | Acceptance criteria |
|---|---|---|---|
| U1 | Writer, desktop | Document `# Plan`, `## Intro`, `### Background`, `## Budget`; caret after the title; toolbar Table of contents → Insert | Block inserted below the title with `{"v":1,"min":2,"max":3}`; Preview shows "Contents" and a numbered nested list (1. Intro, with 1. Background under it; 2. Budget) with no extra gaps between levels; Markdown matches §4.2 |
| U2 | Writer | Click "Background" in the Preview's table | Preview scrolls to Background; the address bar and route are unchanged; the app does not go blank |
| U3 | Writer | Add `## Risks`, then Refresh from the Preview bar | The stale bar shows within a second of typing; after Refresh, Risks is listed, the bar is gone, text outside the block is unchanged, and one Undo restores the old table |
| U4 | Writer | Options → H1–H4, Bullets, no title | The marker gets `"min":1,"max":4,"numbered":false,"title":""`; the list is bulleted; switching back to Numbered restores ordered lists |
| U5 | Writer | Document with a fenced block containing `## Not a heading`, and two `## Overview` | The fenced line is not listed; the entries link `#overview` and `#overview-1` and each goes to its own section |
| U6 | Phone writer, 375 px | Document menu → Insert table of contents, then add a heading in Write mode, then Document menu → Refresh | Inserted after the leading H1; the menu reads "Out of date" before Refresh and not after |
| U7 | Writer | Type `[[#bud`, Enter | `[Budget](#budget)` written; clicking it in the Preview scrolls |
| U8 | Writer | Type `[[proj`, choose "Project plan" | `[Project plan](panino:doc/<id>)`; clicking it in the Preview opens Project plan; browser Back returns to the first Document |
| U9 | Writer | `[[Project plan` → `#` → Budget | `panino:doc/<id>#budget`; the target opens scrolled to Budget; a renamed heading opens at the top with "Heading not found" |
| U10 | Writer | Rename and move Project plan to another folder in the same database; then delete it | After the move the link still works and the tooltip shows the new title and folder; after the delete it is broken-styled and a click shows the toast without navigating |
| U11 | Space member pair | Alice links a space Document to her personal Document; Bob opens the space Document | Alice sees the "Members of … may not be able to open this" note; Bob sees a broken-styled label with "Not found, or not shared with you" and cannot navigate; Bob's own PDF export prints it as plain text; opening the link in a PDF Alice exported shows Bob the "isn't available" screen |
| U12 | Writer | Export to PDF a Document with a table and links | Clicking a table entry in the PDF viewer jumps to the page; a Document link opens `<FRONTEND_URL>/#/doc/<id>` (with `?heading=` when it targets a heading) in the browser; the link contains no `dbKey`; no marker text appears |
| U13 | Writer, desktop | Cmd/Ctrl+click a Document link in the editor; click the OverType tooltip on it; press Ctrl/Cmd+K with text selected | The first two open the Document in the app (no new tab); the third opens the picker with the selection as label |
| U14 | Writer | Paste the address bar URL of another Document | It becomes `[<title>](panino:doc/<id>)` |
| U15 | Writer | Export ZIP, open in VS Code; re-import the ZIP into a fresh account | Links are relative `.md` paths that VS Code follows; after re-import the links are `panino:doc/<newId>` and work |
| U16 | Security | A shared Document contains `[Click](#/addons/ai/authorize?client_id=x)` and a heading `# <img src=x onerror=alert(1)>` | The link is inert with the "not supported" title; the table label shows the text literally; no script runs |
| U17 | PDF reader | Signed out, open a Document link from a PDF; sign in | Sign-in, then loading, then the Document at the heading, with `dbKey` added to the address. A second account without access sees "This Document isn't available…" with Go to Home, the same as for a deleted Document |
| U18 | Writer | Table with 12 H2s, some with H3s under them; export the ZIP and open it on GitHub and in VS Code | Items 10–12 keep their children nested in the Preview, the PDF, GitHub and VS Code; numbers run 1–12 at the top level and restart at 1 under each parent |

---

## 14) Open questions for Kris

Kris answered Q1–Q6 on 2026-11-07; the answers are in the Decisions table in §1. These two
questions come from those answers. The recommendation in each row is what the spec builds if
there is no answer.

| # | Question | Recommendation |
|---|---|---|
| N1 | PDFs sent to Odoo (Documents, chatter) and the PDFs a Knowledge sync files: should Document links in them be web-app links, like a personal export? | No; keep them as plain text. Odoo readers usually have no Panino account, and these PDFs are filed in another system. Changing this later is one explicit `appLinks` option on those `renderPdf` calls (§6.8). |
| N2 | Nested numbering style: each level counts from 1 with decimal numbers, or outline numbers (1, 1.1, 1.2) drawn with CSS counters in the Preview and PDF? | Each level from 1. CSS outline numbers would show only in Panino and its PDFs, so GitHub, VS Code and other exports would number the same list differently. |

---

## 15) Follow-ups

| # | Follow-up | Notes |
|---|---|---|
| F1 | "Linked from" in the Info panel, and a warning on delete ("3 Documents link here") | A `LIKE` scan per open database; no schema (§7) |
| F2 | Outline panel (click-to-navigate heading list beside the editor) | Reuses `extractOutline` |
| F3 | PDF bookmarks | Puppeteer `page.pdf({ outline: true, tagged: true })`; verify with Puppeteer 25 and the JavaScript-off context |
| F4 | Odoo add-on adopts `shared/markerBlocks.js` for sales order blocks | Gains fence-awareness; add-on-only change, allowed by `addon-folders.md` |
| F5 | Rewrite links in the source database when a cross-database move completes | Server-side in `spaceTransfer.js`, for the actor's writable source database |
| F6 | Odoo Knowledge: keep heading ids, or map the Panino table to Knowledge's own table of contents block; map `panino:doc` links to the linked article for synced Documents (`odoo_links`) | In the Odoo add-on, calling core `parseDocumentHref` |
| F7 | GitHub backup: write relative `.md` links like the ZIP export | In the GitHub add-on, calling the core rewrite helper |
| F8 | AI agents API/MCP: describe `panino:doc/<id>` in the `get_document`/`update_document` tool descriptions, so agents follow and write links | In the AI agents add-on |
