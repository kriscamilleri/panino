# Markdown & Directory Import

**Status:** Draft  
**Created:** 2026-04-18  

---

## 1) Problem Statement

Panino's import pipeline only accepts JSON — either Panino's own v2 format or StackEdit's format. The `ImportModal` hard-codes `accept=".json"` on the file input and explicitly rejects non-JSON files (`file.type !== 'application/json'`). There is no way to import:

1. **A single `.md` file** as a new note.
2. **Multiple `.md` files** selected together.
3. **A directory (folder tree) of `.md` files**, preserving its hierarchy as Panino folders/notes.
4. **A ZIP archive containing `.md` files** in a folder structure (the inverse of the existing ZIP export).

This is a significant gap because:

- Users migrating from Obsidian, Logseq, Typora, iA Writer, or a plain filesystem of markdown notes have no path into Panino.
- Panino already **exports** to ZIP with full folder structure and `.md` files, but cannot re-import its own ZIP output.
- The StackEdit import is niche; raw markdown is the universal interchange format.

---

## 2) Goals

1. Allow importing **one or more `.md` files** as individual notes.
2. Allow importing **a directory tree** of `.md` files, recreating the folder hierarchy inside Panino.
3. Allow importing **a `.zip` archive** containing `.md` files (with optional folder structure), including re-importing Panino's own ZIP export.
4. Derive note **title** from the filename (minus `.md` extension) or from a YAML front-matter `title` field if present.
5. Preserve the user's existing notes — imports **add** to the current workspace, they do not replace it (unlike the current JSON import which wipes and replaces).

## Non-Goals

- No import of images embedded in markdown (linked images stay as-is; handling `![](./img.png)` relative paths or `_images/` re-upload is out of scope for v1).
- No two-way sync with the filesystem or external tools.
- No `.txt`, `.html`, or other non-markdown file import in this spec.
- No backend endpoint changes — all processing happens client-side in the browser.

---

## 2.1) Backup Feature Compatibility

The GitHub Backup feature (`backend/api-service/backup.js`) builds a full snapshot of the workspace by reading all `folders`, `notes`, and `images` rows from the user's database and committing them to a GitHub repo as `.md` files in a folder tree. Imported data must be fully compatible with this pipeline.

### How backup works (relevant detail)

1. `buildBackupSnapshot()` iterates all folders/notes, builds a file tree using `sanitizeFileSegment()` (replaces `/ \ : * ? " < > |` with `-`, truncates to 200 chars) and `dedupeFileName()` (appends ` (2)`, ` (3)`, etc. for sibling name collisions).
2. Notes become `<title>.md` files; folders become directories. Images go into `_assets/`.
3. A `README.md` is auto-generated with counts.

### Compatibility requirements

| Concern | Requirement |
|---------|-------------|
| **Folder/note names** | Imported folder names and note titles must be non-empty strings. Use the filename (minus extension) as-is — backup's own `sanitizeFileSegment` handles filesystem-unsafe characters at export time. Do **not** pre-sanitize on import (this would lose the user's intended name). |
| **Folder hierarchy** | Imported folders use standard `parent_id` relationships. Backup traverses `parent_id` chains to build paths — no special treatment needed for imported folders. |
| **UUIDs** | All imported folders and notes get fresh UUIDv4 `id` values, same as any user-created entity. Backup indexes by `id` — no collisions possible. |
| **Timestamps** | Imported entities get `created_at` and `updated_at` set to `new Date().toISOString()`. Backup reads these but only uses them for display, not for logic. |
| **Auto-backup timing** | Imported notes/folders are immediately visible in the database. The next scheduled or manual backup will include them with no additional work. |
| **Large imports** | A user importing 5,000 notes will cause the next backup snapshot to be larger. Backup already handles this (GitHub tree API supports 100k entries). No special limits needed beyond the general import size guard (see §6). |
| **Sync after import** | Since markdown imports write directly to the local WASM SQLite DB, CR-SQLite's change tracking picks them up automatically. The next sync push sends them to the server, where they'll also be available for backup. No additional sync trigger needed beyond the standard `docStore.loadInitialData()` refresh. |

---

## 3) Current State Analysis

### Export (what exists)

| Format | Supported | Notes |
|--------|-----------|-------|
| Panino JSON (v2) | **Export** ✅ | Full data: folders, notes, images (base64), settings, globals |
| StackEdit JSON | **Export** ✅ | Folders + notes in StackEdit's format |
| ZIP (Markdown) | **Export** ✅ | `.md` files in folder tree + `_images/` + `_panino_metadata.json` |

### Import (what exists)

| Format | Supported | Notes |
|--------|-----------|-------|
| Panino JSON (v2) | **Import** ✅ | Wipes existing data, replaces with import |
| StackEdit JSON | **Import** ✅ | Wipes existing data, replaces with import |
| Single `.md` file | ❌ | Rejected by `file.type` check |
| Multiple `.md` files | ❌ | File input is `single`, not `multiple` |
| Directory of `.md` files | ❌ | No `webkitdirectory` support |
| ZIP of `.md` files | ❌ | No ZIP import at all |

### Code locations

| File | Role |
|------|------|
| `frontend/src/components/ImportModal.vue` | UI — file picker, drag/drop, paste, format toggle |
| `frontend/src/store/importExportStore.js` | Logic — `importData()`, `importStackEditData()` |
| `frontend/src/store/docStore.js` | Facade — exposes `importData`, `importStackEditData` |
| `frontend/src/utils/exportUtils.js` | Helpers — image URL remapping, base64 conversion |

---

## 4) Design

### 4.1 Import Modes

The import modal will be extended with three new capabilities:

| Mode | Input | Mechanism |
|------|-------|-----------|
| **Markdown files** | One or more `.md` files | `<input type="file" accept=".md,.markdown" multiple>` |
| **Markdown directory** | A folder from the filesystem | `<input type="file" webkitdirectory>` |
| **ZIP archive** | A `.zip` file containing `.md` files | `<input type="file" accept=".zip">`, parsed with `JSZip` |

### 4.2 Import Modal UI Redesign

The current modal is JSON-centric (paste textarea, single file picker). Replace with a **format selector** approach:

```
┌─────────────────────────────────────────────┐
│  Import Data                            [X] │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  📄 Markdown Files (.md)            │    │
│  │  Import one or more markdown files  │    │
│  │  as individual notes.               │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  📁 Markdown Folder                 │    │
│  │  Import a directory of .md files,   │    │
│  │  preserving folder structure.       │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  📦 ZIP Archive (.zip)              │    │
│  │  Import a .zip containing markdown  │    │
│  │  files and folders.                 │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  { } Panino / StackEdit JSON        │    │
│  │  Import a Panino or StackEdit JSON  │    │
│  │  backup file. ⚠ Replaces all data.  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│                               [Cancel]      │
└─────────────────────────────────────────────┘
```

Clicking a card either opens the appropriate file picker or expands to show the JSON paste area (for JSON mode).

### 4.3 Markdown File Processing

For each `.md` file:

1. **Read** the file as UTF-8 text via `FileReader.readAsText()`.
2. **Extract title**: 
   - If the file content starts with YAML front matter (`---\n...\n---`), parse it and use the `title` field if present.
   - Otherwise, use the filename without the `.md`/`.markdown` extension.
3. **Generate** a new UUID for the note's `id`.
4. **Set** `user_id` from `authStore.user.id`.
5. **Set** `folder_id` based on the import target (root or a destination folder — see §4.5).
6. **Set** `created_at` and `updated_at` to `new Date().toISOString()`.
7. **Insert** into the `notes` table via `syncStore.db.value.exec()`.

### 4.4 Directory Import Processing

When the user selects a folder via `<input webkitdirectory>`:

1. The browser provides a `FileList` where each `File` has a `webkitRelativePath` property (e.g., `my-notes/journal/2026-04-18.md`).
2. **Filter** to only `.md` and `.markdown` files. Silently skip all other files.
3. **Build a folder tree** from the relative paths:
   - Parse each `webkitRelativePath` into path segments.
   - Collect unique directory paths (e.g., `my-notes`, `my-notes/journal`).
   - Create Panino `folders` rows for each directory, maintaining `parent_id` relationships.
   - The top-level directory name from the upload becomes a root-level folder in Panino.
4. **Create notes** for each `.md` file, assigning `folder_id` to the corresponding Panino folder.
5. All inserts happen in a single transaction.

**Path resolution algorithm:**

```
Input files:
  vault/note-a.md
  vault/daily/2026-04-18.md
  vault/daily/2026-04-17.md
  vault/projects/panino/todo.md

Result:
  Folder: "vault"                     (parent_id: null → root)
  Folder: "daily"                     (parent_id: vault.id)
  Folder: "projects"                  (parent_id: vault.id)
  Folder: "panino"                    (parent_id: projects.id)
  Note:   "note-a"       in vault
  Note:   "2026-04-18"   in vault/daily
  Note:   "2026-04-17"   in vault/daily
  Note:   "todo"          in vault/projects/panino
```

### 4.5 ZIP Import Processing

1. Parse the ZIP with `JSZip` (already a dependency).
2. Iterate all entries in the ZIP.
3. **Detect Panino export**: If `_panino_metadata.json` exists at the root, treat it as a Panino ZIP re-import:
   - Read `_panino_metadata.json` for settings/globals metadata.
   - Import settings and globals from the metadata (optional — prompt user).
   - Skip the `_images/` directory (out of scope for v1).
   - Import all `.md` files with their folder structure (same logic as directory import).
4. **Generic ZIP**: If no `_panino_metadata.json`, treat every `.md`/`.markdown` file as a note, preserving folder structure from ZIP paths.
5. Same folder-tree building algorithm as §4.4, but operating on ZIP entry paths instead of `webkitRelativePath`.

### 4.6 Additive vs. Destructive Import

**Critical behavioral difference from current JSON import:**

| Mode | Behavior |
|------|----------|
| JSON / StackEdit import (existing) | **Destructive** — deletes all existing notes/folders, then inserts. This is the existing behavior and remains unchanged. |
| Markdown / Directory / ZIP import (new) | **Additive** — inserts new notes/folders alongside existing data. Never deletes. |

This is the natural expectation: dragging a folder of markdown files into a note app should add them, not wipe existing notes.

### 4.6.1 Conflict Resolution — Folders

If a folder with the **same name** already exists at the same level (same `parent_id`), the import must **not** silently merge into the existing folder or create an indistinguishable duplicate. Instead:

1. **Query existing folders** at the target parent level before inserting.
2. If a name collision is detected, append a disambiguating suffix: `<name> (import 1)`, `<name> (import 2)`, etc.
3. The suffix counter increments until a unique name is found at that level.
4. This ensures the user can clearly identify the newly imported folder vs. the pre-existing one and manually merge/reorganize if desired.

**Algorithm:**

```javascript
async function deduplicateFolderName(name, parentId, syncStore) {
    const existing = await syncStore.execute(
        'SELECT name FROM folders WHERE parent_id IS ? AND name = ?',
        [parentId, name]
    );
    if (!existing || existing.length === 0) return name;

    let counter = 1;
    let candidate;
    do {
        candidate = `${name} (import ${counter})`;
        counter++;
        const check = await syncStore.execute(
            'SELECT name FROM folders WHERE parent_id IS ? AND name = ?',
            [parentId, candidate]
        );
        if (!check || check.length === 0) break;
    } while (counter < 1000); // safety cap
    return candidate;
}
```

### 4.6.2 Conflict Resolution — Notes

Notes with the same title in the same folder are **allowed** by the data model (unique by UUID, not title). However, to keep behavior consistent and user-friendly:

1. If a note with the **exact same title** exists in the target folder, append `(import 1)` to the imported note's title.
2. Same incrementing logic as folders.
3. This gives the user a clear signal that imported content is new and distinct.

**Why not silently allow duplicates?** Because the GitHub Backup feature uses `dedupeFileName()` to handle title collisions at export time — it would rename them to `Note (2).md`, `Note (3).md`. While technically safe, having the disambiguation happen at import time is more transparent: the user sees the actual title they'll work with, not a surprise rename in their backup repo.

### 4.7 Front-Matter Parsing

Support a minimal YAML front-matter block for title extraction:

```markdown
---
title: My Note Title
---

# Content starts here
```

Rules:
- Front matter must be the very first thing in the file (byte 0).
- Delimited by `---` on its own line.
- Only the `title` field is used. All other fields are ignored.
- The front matter block is **not stripped** from the note content — it's preserved as-is so the user's existing front-matter variables continue to work with Panino's global variables / front-matter feature.
- If no front matter or no `title` field, fall back to filename-based title.

Implementation: Use a simple regex rather than a full YAML parser to avoid adding a dependency.

```javascript
function extractTitleFromFrontMatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;
    const titleMatch = match[1].match(/^title:\s*(.+)$/m);
    return titleMatch ? titleMatch[1].trim().replace(/^['"]|['"]$/g, '') : null;
}
```

---

## 5) SDLC Delivery Plan

This section defines the full software development lifecycle from user journey through to pull request. The developer outside the prompt is responsible for the final merge.

### 5.0 User Journey

Before any code, validate the end-to-end user stories this feature serves:

| # | Persona | Journey | Acceptance Criteria |
|---|---------|---------|---------------------|
| U1 | New user migrating from Obsidian | Opens Panino → Tools → Import → selects "Markdown Folder" → picks their Obsidian vault directory → sees folders/notes recreated → edits a note to confirm content | All `.md` files imported; folder hierarchy matches source; titles derived from filenames or front matter; existing Panino data untouched |
| U2 | User importing a few notes | Tools → Import → "Markdown Files" → selects 3 `.md` files → notes appear at root | 3 notes created with correct titles and content |
| U3 | User re-importing a Panino ZIP export | Tools → Import → "ZIP Archive" → selects `panino-export.zip` → folder structure restored, settings/globals optionally restored | Notes/folders match original export; `_panino_metadata.json` detected and offered |
| U4 | User importing a generic ZIP of markdown | Same as U3 but a ZIP without `_panino_metadata.json` → all `.md` files imported with folder structure | Structure preserved; non-`.md` files skipped silently |
| U5 | User imports into workspace that has existing data | Existing notes untouched; imported folders with conflicting names get `(import N)` suffix | No data loss; clear disambiguation |
| U6 | User triggers GitHub Backup after import | Tools → GitHub Backup → "Back Up Now" → backup includes all imported notes | Backup snapshot contains imported notes/folders as `.md` files in the correct tree |

### 5.1 Feature Branch

**Before any development begins:**

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feature/markdown-directory-import
```

All work happens on this branch. The branch must be kept up to date with `main` throughout development:

```bash
# Periodically during development:
git fetch origin
git merge origin/main
# Resolve conflicts if any, preserving both sides unless direct overlap
```

### 5.2 Implementation Phases

Development follows these phases **in order**. Each phase must be complete (code + tests passing) before moving to the next.

#### Phase 1: Pure utility functions (no UI, no store dependencies)

**New file:** `frontend/src/utils/importUtils.js`

Implement and export:
- `sanitizePathSegments(relativePath)` — path traversal protection (§8.2 T2)
- `extractTitleFromFrontMatter(content)` — front-matter title extraction (§4.7)
- `buildFolderTree(entries)` — given `[{ relativePath, content }]`, returns `{ folders, notes }` tree
- `deduplicateName(name, existingNames)` — `(import N)` suffix logic
- `IMPORT_LIMITS` — constants for size/count caps (§8.2 T3)

**Why first:** These are pure functions with zero dependencies. Easy to write, easy to test, and they de-risk the rest of the implementation.

#### Phase 2: Store layer — import functions

**File:** `frontend/src/store/importExportStore.js`

Add:
- `importMarkdownFiles(files, targetFolderId)`
- `importMarkdownDirectory(files)`
- `importZipArchive(file)`

These call the Phase 1 utilities and interact with `syncStore` for database writes.

**File:** `frontend/src/store/docStore.js` — expose the three new functions.

#### Phase 3: UI — ImportModal redesign

**File:** `frontend/src/components/ImportModal.vue`

Redesign per §4.2. Wire up file pickers, drag-and-drop, confirmation summary, progress indicator.

#### Phase 4: Integration verification

- Docker compose up full stack
- Import a directory of `.md` files via the UI
- Verify notes appear in sidebar, content renders in preview
- Trigger sync, verify notes appear on server
- Trigger GitHub Backup, verify imported notes appear in the backup repo
- Test at 375px and 1280px viewports

### 5.3 Testing Strategy

#### Unit Tests

**File:** `frontend/tests/unit/importUtils.test.js` (new)

| Test Suite | Cases |
|------------|-------|
| `sanitizePathSegments` | strips `..` / `.` / empty; strips drive letters; strips leading slashes; handles Windows backslashes; strips control chars; truncates to 500 chars; normalizes Unicode NFC |
| `extractTitleFromFrontMatter` | valid front matter; no front matter; empty title; quoted title; front matter not at byte 0; content >4KB (only scans head); malformed delimiters |
| `buildFolderTree` | flat files (no dirs); single-level dir; deeply nested dirs; mixed files and dirs; hidden files skipped; `__MACOSX` skipped; empty input |
| `deduplicateName` | no conflict → unchanged; one conflict → `(import 1)`; multiple conflicts → increments; edge: 999 conflicts |
| Security-specific | XSS payloads in content (verified at render, not import); ZIP path `../../etc/passwd` → segments stripped (S10); null bytes stripped (S2); prototype pollution key names (`__proto__`, `constructor`) as folder names → treated as normal strings |

**File:** `frontend/tests/unit/markdownImport.test.js` (new)

| Test Suite | Cases |
|------------|-------|
| `importMarkdownFiles` | single file; multiple files; target folder; root (null); front-matter title used; filename title fallback; empty file → empty content, "Untitled" title; duplicate title → `(import 1)` suffix |
| `importMarkdownDirectory` | mock FileList with `webkitRelativePath`; folder hierarchy created correctly; non-`.md` files skipped; conflict resolution on folder names |
| `importZipArchive` | generic ZIP with `.md` files; Panino ZIP with `_panino_metadata.json`; ZIP exceeding file count limit → error; ZIP exceeding total size limit → error; per-file size cap → file skipped with warning; entry with path traversal → stripped |

#### Integration Tests

**File:** `frontend/tests/integration/markdownImport.test.js` (new)

These tests use a real (in-memory) WASM SQLite instance or a test-double that simulates it:

| Test | Scope |
|------|-------|
| Import 10 `.md` files → query `notes` table → 10 rows with correct titles and content | Store ↔ DB |
| Import directory → query `folders` + `notes` → correct hierarchy | Store ↔ DB |
| Import into workspace with existing data → existing notes untouched, imported notes added | Additive behavior |
| Import folder with name collision → new folder has `(import 1)` suffix | Conflict resolution ↔ DB |
| Import ZIP → query `folders` + `notes` → correct structure | Store ↔ JSZip ↔ DB |
| Import followed by `exportDataAsZip()` → re-import the exported ZIP → same note count | Round-trip |

#### E2E Tests (manual, via Chrome DevTools MCP)

These are performed using the Chrome DevTools MCP tool against the Docker dev stack:

| Test | Steps | Verify |
|------|-------|--------|
| **Markdown file import** | Open Import modal → click "Markdown Files" → select 2 `.md` files → confirm | Notes appear in sidebar; content correct in preview; no console errors |
| **Directory import** | Open Import modal → click "Markdown Folder" → select a test directory → confirm summary → import | Folders/notes match directory; sidebar tree correct |
| **ZIP import** | Export as ZIP → Import modal → "ZIP Archive" → select the export → confirm | Notes restored; folder structure intact |
| **Conflict handling** | Create a folder "journal" → import a directory also named "journal" → verify sidebar | Two folders: "journal" and "journal (import 1)" |
| **Backup after import** | Import 5 notes → trigger GitHub Backup → inspect backup status | Backup succeeds; commit includes imported notes |
| **Responsive check** | Repeat import flow at 375px viewport | Modal usable; no overflow; buttons reachable |
| **Large import** | Import a ZIP with 500 files → watch progress | Progress indicator shown; no browser freeze; toast on completion |

### 5.4 Security Review Checklist

Before the PR is created, the implementing agent must verify each item:

- [ ] **S1:** `sanitizePathSegments` strips `..`, `.`, empty segments, drive letters, leading slashes — covered by unit test
- [ ] **S2:** Null bytes and control chars stripped from all folder names and note titles — covered by unit test
- [ ] **S3:** Unicode NFC normalization applied — covered by unit test
- [ ] **S4:** Import limits enforced (10k files, 500 MB total, 50 MB per file, 1k dirs) — covered by unit test
- [ ] **S5:** Front-matter regex only scans first 4 KB — covered by unit test
- [ ] **S6:** Every SQL `INSERT` uses parameterized queries — verified by grep: no string concatenation with user input in SQL
- [ ] **S7:** ZIP iteration uses `zip.forEach()` or `Object.keys()`, never `for...in` — verified by code inspection
- [ ] **S8:** Folder names and note titles truncated to 500 chars — covered by unit test
- [ ] **S9:** XSS payloads in imported content stripped by DOMPurify at render time — covered by unit test
- [ ] **S10:** Path traversal in ZIP entries stripped — covered by unit test
- [ ] **No new dependencies** with known CVEs introduced
- [ ] **No secrets, tokens, or credentials** in committed code

### 5.5 Code Review Checklist

Before the PR is created, verify:

- [ ] All new functions have JSDoc comments explaining purpose, parameters, and return values
- [ ] No `console.log` left in production code (only `console.warn` for non-critical skip warnings)
- [ ] Error messages are user-friendly (no raw stack traces exposed to UI)
- [ ] All imports are used; no dead code
- [ ] Transaction handling: every `BEGIN TRANSACTION` has matching `COMMIT` and `ROLLBACK` in catch
- [ ] Existing tests still pass: `cd frontend && npm test`
- [ ] New tests pass: `cd frontend && npm test -- --run importUtils markdownImport`
- [ ] Lint clean: no ESLint errors
- [ ] Import modal visually correct at 1280px and 375px (verified via MCP)
- [ ] Feature works in Docker dev stack end-to-end (not just unit tests)
- [ ] Agent log created in `docs/agent-logs/` with all changes documented

### 5.6 Patching & Iteration

After the initial implementation passes all tests and reviews:

1. **Run the full existing test suite** — ensure no regressions in export, sync, or backup.
2. **Fix any failing tests** before proceeding.
3. **Address any security findings** from §5.4 that weren't caught during implementation.
4. **Performance check:** Import a 1,000-file directory. If the UI freezes for >2 seconds, add batching with `requestAnimationFrame` between chunks.
5. **Final diff review:** `git diff main..HEAD --stat` — ensure no unintended file changes.

### 5.7 Pull Request

When all of the above is complete:

```bash
git fetch origin
git merge origin/main          # Final sync with main
# Resolve any conflicts
git push origin feature/markdown-directory-import
```

Create a PR with:
- **Title:** `feat: markdown & directory import`
- **Description:** Link to this spec (`docs/specs/markdown-import.md`), summary of changes, test results
- **Labels:** `feature`, `frontend`
- **Checklist:** Copy of §5.4 and §5.5 checklists with checked boxes
- **Screenshots:** Import modal at 1280px and 375px

**The PR is never merged by the agent.** The developer reviews and merges at their discretion.

---

## 6) Edge Cases & Decisions

| Scenario | Decision |
|----------|----------|
| File with no `.md` extension in directory/ZIP | Skip silently — only process `.md` and `.markdown` files |
| Empty `.md` file | Create note with empty content, title from filename |
| Filename is just `.md` | Title becomes "Untitled" |
| Duplicate folder names at same level | Append `(import N)` suffix to the new folder — never merge into existing or create an indistinguishable duplicate (see §4.6.1) |
| Duplicate note titles in same folder | Append `(import N)` suffix to the imported note's title (see §4.6.2) |
| Very large import (1000+ files) | Batch inserts in chunks of 100 within the transaction to avoid long UI freezes. Use `requestAnimationFrame` or `setTimeout(0)` between batches to keep UI responsive. Show progress bar. |
| ZIP with nested ZIPs | Ignore nested ZIPs — only process top-level `.md` files |
| ZIP with `_panino_metadata.json` | Treat as Panino re-import; offer to restore settings/globals |
| Front matter with `title:` that is empty | Fall back to filename |
| Windows-style paths in ZIP (`\` separators) | Normalize to `/` before processing |
| Hidden files (`.filename.md`) or `__MACOSX/` | Skip files/directories starting with `.` or `__` |
| `webkitdirectory` not supported (Firefox/Safari gaps) | Show a tooltip explaining browser support; suggest ZIP import as fallback |

---

## 7) Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| `<input webkitdirectory>` | ✅ | ✅ (since 50) | ✅ (since 11.1) | ✅ |
| `webkitRelativePath` | ✅ | ✅ | ✅ | ✅ |
| `<input multiple>` | ✅ | ✅ | ✅ | ✅ |
| `JSZip` | ✅ | ✅ | ✅ | ✅ |
| Drag-and-drop directories | ✅ (via `DataTransferItem.webkitGetAsEntry()`) | ⚠ Partial | ⚠ Partial | ✅ |

For drag-and-drop directory support, use the `webkitGetAsEntry()` / `DataTransferItem` API to recursively read directory entries. Fall back to flat file list if not available.

---

## 8) Security Review

This section is a deep analysis of every attack surface introduced by the markdown import feature.

### 8.1 Threat Model

The import feature accepts **untrusted files from the user's filesystem** (or from a ZIP archive that could have been downloaded from anywhere). All processing happens client-side in the browser. The imported content is written to the local SQLite WASM database and eventually synced to the server.

**Attacker capabilities:** An attacker who can convince a user to import a malicious `.md` file, directory, or ZIP archive.

### 8.2 Threat Analysis

#### T1: Stored XSS via Markdown Content

**Risk: LOW (already mitigated)**

Imported `.md` file content is stored as-is in the `notes.content` column. When rendered for preview, Panino passes all markdown through `MarkdownIt` and then **DOMPurify** before injecting into the DOM. This is the same pipeline used for user-typed content.

**Requirement:** No change. The existing sanitization pipeline covers imported content identically. Do NOT add any "pre-sanitization" step at import time — the raw markdown must be preserved for editing. Sanitization happens at render time.

**Verify:** Unit test that imports a `.md` file containing `<script>alert(1)</script>` and `<img onerror=alert(1) src=x>`, then confirms these are stripped at render time.

#### T2: Path Traversal via Filenames

**Risk: MEDIUM → mitigated by design**

A ZIP archive or `webkitRelativePath` could contain path traversal sequences:
- `../../../etc/passwd`
- `..\..\Windows\System32\config`
- Absolute paths: `/etc/shadow`, `C:\Windows\...`

Since we are NOT writing to the filesystem (we're inserting rows into SQLite), traditional path traversal is impossible. However, the **folder names** and **note titles** derived from paths must be sanitized:

**Requirements:**
1. **Strip path traversal components:** Remove `..` segments entirely. Split the path on `/` and `\`, discard any segment that is `..`, `.`, or empty.
2. **No absolute paths:** Strip leading `/`, `\`, and drive letters (`C:\`) before processing.
3. **Folder/note names:** After path splitting, each segment becomes a folder name or note title. No further filesystem-level sanitization is needed (these are just strings in SQLite), but reject or replace control characters (`\x00`–`\x1F`) to prevent SQLite or UI rendering issues.
4. **Length limits:** Truncate individual folder names and note titles to 500 characters. This is generous for usability but prevents degenerate inputs.

```javascript
function sanitizePathSegments(relativePath) {
    return relativePath
        .replace(/^[a-zA-Z]:/, '')       // strip drive letter
        .split(/[\/\\]/)                // split on / or \
        .filter(seg => seg && seg !== '.' && seg !== '..')
        .map(seg => seg.replace(/[\x00-\x1f]/g, '').slice(0, 500));
}
```

#### T3: Zip Bomb / Resource Exhaustion

**Risk: MEDIUM**

A malicious ZIP could contain:
- **Zip bomb:** Small archive that decompresses to terabytes (e.g., 42.zip).
- **Excessive file count:** Millions of tiny files to exhaust memory.
- **Extremely large individual files:** A single `.md` file that is 2 GB.

**Requirements:**
1. **File count cap:** Abort import if the ZIP contains more than **10,000** entries (files + directories). Show error: "This archive contains too many files. Maximum is 10,000."
2. **Total decompressed size cap:** Track cumulative decompressed bytes. Abort if total exceeds **500 MB**. JSZip reads entries lazily, so check `file.async('uint8array')` size as each file is read.
3. **Per-file size cap:** Skip any individual file larger than **50 MB** with a warning. Markdown notes should not be this large.
4. **Directory count cap:** Limit to **1,000** unique directories. Beyond this, abort with an error.

```javascript
const LIMITS = {
    MAX_FILES: 10_000,
    MAX_TOTAL_BYTES: 500 * 1024 * 1024,  // 500 MB
    MAX_FILE_BYTES: 50 * 1024 * 1024,     // 50 MB per file
    MAX_DIRECTORIES: 1_000,
};
```

These same limits apply to directory imports (count the files in the `FileList`).

#### T4: Filename-Based Exploits

**Risk: LOW**

Filenames from ZIP entries or `webkitRelativePath` could contain:
- Null bytes (`file\x00.md`) — could truncate strings in some contexts.
- Unicode normalization attacks (e.g., two visually identical folder names using different Unicode representations).
- Extremely long filenames designed to overflow buffers.

**Requirements:**
1. Strip null bytes from all filenames/paths.
2. Normalize Unicode using `String.prototype.normalize('NFC')` before using as folder name or note title. This prevents two folders appearing identical but having different `name` values.
3. Length truncation already handled in T2 (500 char cap).

#### T5: Malicious Front-Matter Parsing

**Risk: LOW**

The front-matter extraction uses a simple regex, not a full YAML parser. This is actually **safer** than using a YAML parser, because YAML parsers have historically been vulnerable to:
- Deserialization attacks (e.g., Python's `yaml.load` executing arbitrary code).
- Billion laughs / entity expansion DoS.

Our regex (`/^---\r?\n([\s\S]*?)\r?\n---/`) is safe:
- The `*?` is non-greedy, so it stops at the first `---` delimiter.
- It only extracts a string value, never executes or deserializes.
- The extracted title is used only as a string in a parameterized SQL `INSERT`.

**Requirement:** No change. The regex approach is correct for our use case. Do NOT switch to a full YAML parser.

**One edge:** If front matter is extremely large (megabytes of text between `---` delimiters), the regex could cause backtracking. **Mitigation:** Only attempt front-matter extraction on the first 4 KB of the file content, not the entire string.

```javascript
function extractTitleFromFrontMatter(content) {
    // Only scan the first 4KB to prevent regex DoS on large files
    const head = content.slice(0, 4096);
    const match = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;
    const titleMatch = match[1].match(/^title:\s*(.+)$/m);
    return titleMatch ? titleMatch[1].trim().replace(/^['"]|['"]$/g, '') : null;
}
```

#### T6: SQL Injection via Imported Content

**Risk: NONE (mitigated by architecture)**

All database writes use **parameterized queries** via `syncStore.db.value.exec(sql, [params])`. The imported title, content, folder name, etc. are always bound as parameters, never concatenated into SQL strings.

**Requirement:** Maintain this pattern. Never construct SQL via template literals or concatenation with imported values. Code review must verify every `INSERT` uses parameter binding.

#### T7: Prototype Pollution via ZIP Metadata

**Risk: LOW**

JSZip parses ZIP metadata into JavaScript objects. If a ZIP entry has a filename like `__proto__` or `constructor`, iterating over the parsed entries with `for...in` could cause prototype pollution.

**Requirements:**
1. Use `Object.keys()` or `zip.forEach()` (which JSZip provides) to iterate entries, never `for...in`.
2. When building the folder tree map, use `Map` objects (already planned) rather than plain objects. `Map` is immune to prototype pollution.

#### T8: Sync Amplification / Server-Side Impact

**Risk: LOW-MEDIUM**

Importing 5,000 notes into the local WASM database creates 5,000 CRR change entries. On the next sync push, all 5,000 are sent to the server in a single `POST /sync` request.

**Considerations:**
- The sync endpoint already handles bulk changes (it processes the `changes` array in a transaction).
- The backend's per-user SQLite database will grow. This is expected and within normal operating parameters.
- The server does NOT have import-specific rate limiting, but the sync endpoint inherently throttles via request size.

**Requirement:** After a large import, trigger sync with a brief toast: "Syncing 5,000 imported notes..." so the user knows a large upload is in progress. Do not attempt to batch/throttle the sync differently — the existing sync protocol handles this.

#### T9: Content Injection into Backup Repository

**Risk: LOW**

Imported note content will appear in the GitHub backup repo as `.md` files. A malicious note could contain:
- GitHub Actions workflow syntax (only dangerous if placed in `.github/workflows/`, which backup doesn't do).
- Misleading content in the `README.md` (backup auto-generates this, not from note content).

The backup feature uses `sanitizeFileSegment()` on filenames, preventing path traversal in the GitHub tree. Note content is committed as blob content, not as paths.

**Requirement:** No change. The backup pipeline's existing sanitization is sufficient.

### 8.3 Security Requirements Summary

| ID | Requirement | Priority |
|----|-------------|----------|
| S1 | Strip `..`, `.`, empty segments, drive letters, and leading slashes from all imported paths | **Must** |
| S2 | Strip null bytes and control characters from folder names and note titles | **Must** |
| S3 | Normalize Unicode (NFC) on folder names and note titles | **Should** |
| S4 | Cap: 10,000 files, 500 MB total decompressed, 50 MB per file, 1,000 directories | **Must** |
| S5 | Front-matter regex operates on first 4 KB only | **Should** |
| S6 | All SQL inserts use parameterized queries (verify in code review) | **Must** |
| S7 | Use `Map` or `Object.keys()` for ZIP entry iteration, never `for...in` | **Must** |
| S8 | Truncate folder names and note titles to 500 characters | **Should** |
| S9 | Unit test: import file with `<script>`, `onerror`, `javascript:` — verify DOMPurify strips at render | **Must** |
| S10 | Unit test: import ZIP with `../../etc/passwd` path — verify traversal is stripped | **Must** |

---

## 9) Open Questions

1. **Should we strip front matter from imported content?** Current decision is no (preserve it), but some users may expect it to be consumed and removed. Could be a toggle.
2. **Should we offer a "target folder" picker** for markdown file imports, or always import into root? A folder picker adds UX complexity but is more useful.
3. **Should the JSON import mode also become additive?** Currently it's destructive (wipes all data). Making it additive would be a separate spec/discussion since it changes existing behavior.
4. **Should we handle relative image paths** (`![](./images/photo.png)`) by looking for those files in the ZIP/directory and uploading them? This was explicitly non-goal for v1 but is the natural next step.
5. **Max import size?** Currently proposed at 500 MB / 10,000 files (see §8.2 T3). Should this be configurable or are these hard limits?
6. **Should the `(import N)` suffix be localizable?** For now, hardcode English. Revisit if i18n becomes a priority.
