# AI agents add-on — expanding the v1 API and MCP tools — Spec

- Status: implemented on `feature/ai-api-expansion`, not yet released
- Last updated: 2026-11-07
- Extends: [`ai-integration.md`](../active/ai-integration.md) (MCP, OAuth) and
  [`llm-api.md`](../active/llm-api.md) (keys, v1 REST)
- Owner: Kris

## 1) Summary

The first release lets an agent find, read, replace, append to and trash Documents, and create
folders. That is not enough for real work:

- An agent cannot make a small edit without resending the whole body.
- It cannot read part of a long Document.
- It cannot see revision history, images, templates or global variables.
- It cannot organise folders, or restore anything it trashed.

This spec adds these, behind the same switch, keys, OAuth grants, scopes and rules.

## 2) Decisions (Kris, 2026-11-07)

| # | Question | Decision |
|---|---|---|
| E1 | Restore a Document to an earlier revision | **Yes**, write scope. A `pre-restore` revision is saved first, so it is undoable. Refused in a live session; honours `expected_updated_at` |
| E2 | Images | **Read, upload, delete unused.** Upload uses the app's limits (1 MB, type allow-list, quota). Delete is refused while any Document in the database references the image |
| E3 | Folders | **Rename, move, trash, restore.** Trash moves into the database's Trash folder. Nothing is ever deleted permanently |
| E4 | Templates, variables, PDF | **Read and use** templates (create a Document from one), **read** global variables, **export** a Document as PDF. No writing templates or variables |
| E5 | Document properties | **Query them.** Built-in properties are word count, created on and by, and modified on and by. Front matter `key: value` lines are properties too. Agents can read, list, filter on, set and remove front matter properties |

Unchanged from the first release: no permanent deletes of Documents or folders, no space
lifecycle, no sync, no settings or styles writes.

## 3) Conventions every area follows

- **One implementation per rule.** Operations live in `*Service.js` files as plain functions
  taking `ctx` (`{ userId, agent, clients }`). They throw `ApiError(status, code, message)`. The
  shared rules are in `serviceCore.js`:
  - which databases an agent reaches, through `resolveOne`, `resolveMany` and `locateDocument`;
  - `writableDb` (a healthy connection) for every write;
  - `assertNoLiveSession`, `assertExpected` and `assertBodySize`;
  - `snapshotBefore` and `snapshotAfter` for revision attribution;
  - `announce` to poke devices and run add-on hooks after a write.
- **Adapters** live in `api/<area>.js`, which exports `tools`, `nextSteps`, `routes(router)` and
  `paths`. They are listed in `api/index.js`.
- **MCP tools:**
  - `snake_case` names, verb first.
  - Portable input schemas: only `string`, `integer` and `boolean` properties, no arrays or
    objects, a description on everything. `tests/unit/mcpTools.test.js` enforces this.
  - Read tools are `access: 'read'` with `READ` annotations. Writes are `access: 'write'`;
    `destructiveHint` is true only for writes that replace or remove something.
  - Results are a text block written for a model, plus `structuredContent` with the v1 field
    names. Binary results (images, PDF) add MCP content blocks through `content`.
  - Every new error code gets a `nextSteps` sentence telling the model what to do.
- **REST:**
  - camelCase JSON, under the same `/addons/ai/v1` router, API keys only.
  - Every path is described in `paths`. A test checks that every described path is answered.
- **Writes:**
  - Always on `writableDb`.
  - Edits to a body go through `snapshotBefore` and `snapshotAfter`, so revision history names
    the key or app.
  - Space Documents in a live session are refused (`409 DOCUMENT_IN_LIVE_SESSION`).
  - `expectedUpdatedAt` is optional and honoured.
  - Every write ends with `announce`.
- **Space reach:** a resource in a space the agent cannot reach is indistinguishable from a
  missing one.
- **Limits:**
  - Every list is paged or capped. Text results stay below about 100 KB.
  - Binary results stay within the app's own limits: images 1 MB, PDF as `/render-pdf` allows.

## 4) Areas

### 4.1 Documents (`api/documents.js`, `documentService.js`)

- `get_document`:
  - Gains metadata: `createdAt`, `pinned`, `wordCount`, `characterCount`, `lineCount`,
    `revisionCount`, `imageIds` (images the body references), and `webUrl` (the web-app link
    `<FRONTEND_URL>/#/doc/<id>`, when configured).
  - Can read part of the body: by `start_line`/`end_line` (1-based, inclusive), or by
    `section` (a heading's text: the heading and everything up to the next heading of the same
    or higher level).
  - `include_content: false` returns metadata only.
- `get_document_outline` (read): headings with level, text, slug and line number.
- `edit_document` (write):
  - Exact `old_text` → `new_text`. `old_text` must match exactly once unless `replace_all`.
  - Errors: `EDIT_NO_MATCH` and `EDIT_AMBIGUOUS` (with the match count).
- `insert_into_document` (write):
  - Inserts `content` at `position`: `start`, `end`, `before_heading`, `after_heading` or
    `end_of_section`, with `heading` for the heading positions.
  - Errors: `HEADING_NOT_FOUND` and `HEADING_AMBIGUOUS`.
- `search_documents`:
  - Several words, all of which must match (a quoted phrase stays one term).
  - `in` (`all` | `title` | `content`), `folder_id` (subfolders included), `updated_after`, and
    `offset` paging.
  - Each result has `matchCount` and up to three snippets with line numbers.
- `list_documents`: `sort` (`updated` | `created` | `title`), `pinned_only`, `updated_after`;
  summaries include `createdAt` and `pinned`.
- REST: `GET documents/{id}/outline`, `POST documents/{id}/edit`, `POST documents/{id}/insert`,
  plus the new query parameters.

### 4.2 Folders and Trash (`api/folders.js`, `folderService.js`)

- `get_folder` (read): path, parent, subfolders, Documents (titles only), and counts.
- `rename_folder`, `move_folder` (write):
  - A move into the folder itself or its own descendant is refused (`FOLDER_CYCLE`).
  - The Trash folder cannot be renamed, moved or trashed (`TRASH_FOLDER_PROTECTED`).
- `move_folder_to_trash` (write): moves the folder, with everything in it, under Trash.
- `list_trash` (read): what is in Trash, top level first.
- `restore_from_trash` (write):
  - Takes a Document or folder id.
  - It goes back where it was, if that place is known, still exists and is not in Trash.
    Otherwise it goes to the top level, or to `folder_id` when given.
  - The previous location is recorded in a server-only content table when the API trashes
    something. Items the app trashed have no record and go to the top level.
- REST: `GET folders/{id}`, `PATCH folders/{id}` (`name`, `parentId`), `DELETE folders/{id}`,
  `GET trash`, `POST trash/{id}/restore`.

### 4.3 Templates, variables and PDF (`api/library.js`, `libraryService.js`)

- `list_templates`, `get_template` (read).
- `create_document_from_template` (write): the same title pattern and body as the app's "New
  from template", into the template's default folder unless `folder_id` is given.
- `list_variables` (read): global variables (`{{name}}` placeholders) and their values.
- `export_pdf` (read):
  - Renders a Document the way the app's Export does: its print style, the shared renderer, and
    `/render-pdf`.
  - REST: `GET documents/{id}/pdf` returns `application/pdf`.
  - MCP: an embedded resource (`application/pdf`, base64), within a size cap.
- The PDF request builder the Odoo add-on already uses moves into core, so both use it. Add-ons
  may not import each other.

### 4.4 Revisions (`api/revisions.js`, `revisionService.js`)

- `list_revisions` (read): newest first, paged; type, time, title, and who (user, `api`/`app`
  with label, sync, collab, system).
- `get_revision` (read): one revision's body.
- `compare_revisions` (read): a unified line diff of a revision against the current body or
  another revision, capped.
- `save_revision` (write): a manual checkpoint of the current body, attributed to the key or app.
- `restore_revision` (write):
  - Saves a `pre-restore` revision first.
  - Refused in a live session; honours `expected_updated_at`.
  - Attributed to the key or app.
  - The restore logic is shared with the app's restore route.
- REST: `GET documents/{id}/revisions`, `GET documents/{id}/revisions/{revisionId}`,
  `GET documents/{id}/revisions/{revisionId}/diff`, `POST documents/{id}/revisions`,
  `POST documents/{id}/revisions/{revisionId}/restore`.

### 4.5 Images (`api/images.js`, `imageService.js`)

- `list_images` (read): per database, paged; filename, type, size, created, how many Documents use
  it, and the Markdown to embed it.
- `get_image` (read):
  - MCP image content (base64) plus metadata.
  - REST: `GET images/{id}` returns the bytes with the app's safe headers. SVG is sent with the
    same sandbox headers as the app.
- `upload_image` (write):
  - MCP: base64 `data`, `filename` and `mime_type`. REST: multipart, or JSON with base64.
  - Same limits and checks as the app's upload. The storing logic is shared with it.
  - Returns the Markdown to embed it.
- `delete_image` (write, destructive):
  - Refused while any Document in the database references it (`IMAGE_IN_USE`, with the
    Documents).
  - Removes the row and the file, as the app's delete does.
- REST: `GET images`, `GET images/{id}`, `GET images/{id}/usage`, `POST images`,
  `DELETE images/{id}`.

### 4.6 Properties (`api/properties.js`, `propertyService.js`, `propertyText.js`, `authorship.js`)

- **Built-in properties:**
  - title, folder, word count (the app's rule: runs of non-space characters), created on, created
    by, modified on, modified by, pinned.
  - There are no author columns, so authors come from revision history. Created by is the oldest
    revision's author; modified by is the newest attributed revision's.
  - They are worded as the app's history words them.
  - In the personal database the owner stands in when history is silent (`inferred: true`).
- **Front matter properties:** the `key: value` lines read by `shared/frontMatter.js`, values
  unquoted.
- `get_document_properties` (read), `GET documents/{id}/properties`:
  - Returns `builtIn`, `properties` and `order`.
  - `get_document` also gains `createdBy`, `modifiedBy` and `properties`.
- `list_document_properties` (read), `GET properties`: keys in use, with Document counts and
  common values, plus the built-in keys.
- `query_documents_by_property` (read), `GET properties/query?filter=`:
  - **Filter syntax:**
    - conditions joined by `AND`, at most five, quotes respected;
    - `<key> <op> <value>`, with `=`, `!=`, `~` (contains), `^=` (starts with), `>`, `<`, `>=`,
      `<=`;
    - `<key> exists` and `<key> missing`.
  - **Comparison:**
    - case is ignored;
    - numbers compare as numbers and ISO dates as text;
    - author `=` accepts the person's name or the key's or app's name.
  - **Built-in names:** `word_count`, `created_on`, `modified_on`, `created_by` and `modified_by`
    take precedence over a front matter key with the same name.
  - **Paging and limits:**
    - `offset` paging.
    - It reads up to 5000 of the most recently updated Documents per database, and `truncated`
      says when it hit that.
    - It reads only the first 16 KB of a body unless the filter needs the word count.
  - **Errors:** `INVALID_FILTER` (400).
- `set_document_property` (write), `PUT documents/{id}/properties/{key}`, and
  `remove_document_property`, `DELETE documents/{id}/properties/{key}`:
  - They edit the front matter block with the shared writer.
  - They follow every write rule of an edit, including attributed revisions.
  - Removing the last property removes the block. A no-op is not written.

### 4.7 What the build added or changed

- **Trash:**
  - `TRASH_NAME_RESERVED`: a second top-level folder named Trash would change which folder is
    Trash.
  - `update_document` keeps `ai_trash_origins` right when it moves a Document into or out of Trash.
- **Templates and PDF:**
  - `inputs` on `create_document_from_template` (JSON text for `{{input:Label}}`) and
    `unfilledInputs` in the result.
  - `page_size` on `export_pdf`.
  - `{{input:…}}` values are now inserted literally in the app too (`$&` no longer expands).
- **Images:**
  - Upload Markdown carries the API path prefix (`/api/images/<id>` in production), as the editor
    writes it.
  - The API checks that uploaded bytes match the declared type.
- **Revisions:** `restore_revision` and `save_revision` are both refused in a live session.
- **Documents:**
  - Search with several words now needs all of them, anywhere, rather than the phrase.
  - Without a range, `get_document` still returns the whole body (up to 2 MiB), for compatibility.

## 5) Security

- Same authentication, switch, rate limits, scopes and space reach as the first release.
- No new route accepts a session JWT, and no existing app route accepts a key.
- Uploads use the app's MIME and extension allow-list, size limit, quota and UUID storage names.
  Image paths stay inside the upload root.
- SVG served to agents keeps the sandbox headers.
- PDF export uses the existing sanitizer and the SSRF protections for external images.
- Errors are closed codes with fixed messages.
- Document text, template text and variable values are user data, never instructions. The
  server instructions say so.

## 6) Testing

Each area has integration tests on REST and MCP:
- read-only refusals;
- space reach;
- live sessions for writes;
- revision attribution for body changes;
- the new error codes.

The portable-schema test covers every new tool.
