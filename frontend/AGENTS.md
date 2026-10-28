# Frontend — Agent Reference

> Layer-specific reference for agents working on the frontend Vue 3 SPA.
> Always read the root `AGENTS.md` first for project-wide rules, architecture, database schema, and security guidelines.

---

## Entry Points

- `main.js` — Creates Vue app, Pinia, Router. Registers service worker. Overrides `window.alert` to use toast system.
- `router.js` — Hash-based routing (`createWebHashHistory()`). Global navigation guard handles auth redirects and DB initialization gate.
- `AppShell.vue` — Minimal shell: `<router-view>` + `ToastContainer` + `PwaInstallPrompt`.

---

## Route Protection Flow

1. `router.beforeEach` calls `authStore.checkAuth()`.
2. Unauthenticated users redirected to `/login` (except public routes: login, signup, loading, terms, forgot-password, reset-password).
3. Authenticated users whose local DB isn't initialized redirect to `/loading`.

---

## Pinia Stores (all Composition API)

Every store uses `defineStore('name', () => { ... })` setup-style pattern.

| Store | Purpose | Key dependencies |
|-------|---------|-----------------|
| `syncStore` | Core DB engine, sync protocol, WebSocket, online/offline tracking | — (root) |
| `authStore` | JWT auth, login/logout/signup, token refresh scheduling | syncStore |
| `structureStore` | Document/folder tree, selection, CRUD operations | syncStore, authStore |
| `docStore` | **Facade** — re-exports from structureStore + markdownStore, orchestrates coordinated operations | structureStore, markdownStore, syncStore, importExportStore |
| `markdownStore` | Preview/print renderers built on the shared `@panino/content-merge/markdown-render` (MarkdownIt setup, front matter, variable substitution live in `shared/`), preview/print style management | syncStore, authStore, globalVariablesStore |
| `draftStore` | Ephemeral in-memory draft content (keystroke-speed, not persisted to DB) | — (independent) |
| `editorStore` | Bridge/proxy to Editor component's exposed methods for toolbar actions | — (independent) |
| `historyStore` | Per-document undo/redo stack (max 100 entries per document) | — (independent) |
| `uiStore` | Panel visibility (persisted to DB), menus, modals, toast notifications | syncStore |
| `globalVariablesStore` | Global template variables CRUD, normalized key lookup | syncStore, authStore, uiStore |
| `importExportStore` | JSON/ZIP/StackEdit/SQLite export, JSON/StackEdit import | syncStore, structureStore, authStore |
| `spacesStore` | Server-backed lifecycle, member/invitation management, ownership, leave/deletion, and invite acceptance | syncStore, authStore |
| `addonsStore` | The add-ons the server offers and which the user switched on (`GET /addons`, `PUT /addons/:id/enabled`); every add-on entry point renders only when `isActive(id)` | authStore |
| `odooStore` | The Odoo add-on's connection, folder, article and record pickers, links, send and Knowledge syncs (`/addons/odoo/…`); availability is `addonsStore.isActive('odoo')`. Article HTML comes from `composables/useDocumentArticle.js` (`utils/odooArticle.js`); `OdooSyncsCard` lists and adds syncs in Settings | authStore |

### Store initialization pattern

```javascript
// Always wait for DB before accessing it
watch(() => syncStore.isInitialized, async (ready) => {
  if (ready) await loadData();
}, { immediate: true });
```

Many stores also watch `authStore.user?.id` to reload on user switch.

---

## DB Access Patterns

```javascript
// Resolve a repository once from a canonical `user:<uuid>` / `space:<uuid>` key.
const repository = syncStore.repository(dbKey);

// READ — returns array of row objects
const rows = await repository.execute('SELECT * FROM notes WHERE id = ?', [id]);

// WRITE — keep application writes transactional
await repository.transaction((tx) =>
  tx.exec('UPDATE notes SET title = ? WHERE id = ?', [title, id])
);
```

- Public store operations require an explicit canonical database key; never accept a bare UUID
  or silently fall back to the personal database.
- `repository.execute()` returns `execO` row objects; `repository.exec()` performs statements.
- Use `syncStore.personalRepository()` only for deliberately personal-only settings/import/export
  adapters, not as an ambient default for document operations.
- `repository.transaction()` supplies scoped `execute`/`exec` methods and handles
  `BEGIN` / `COMMIT` / `ROLLBACK`.

---

## Data Flow: Editor → Preview → DB

```
Keystroke → draftStore.setDraft() (instant)
         → Preview reads draftStore (real-time preview)
         → debounced 500ms → docStore.updateFileContent() → DB write via syncStore
         → syncStore.db.onUpdate() → debounced 500ms → sync() to server
```

---

## Component Patterns

- **Editor.vue** — Uses OverType library for the markdown textarea. Exposes methods via `defineExpose()` for `editorStore` bridge. Handles image paste upload to `POST /images`. Intercepts Ctrl+Z/Y for custom undo/redo via `historyStore`. Three-layer update: keystroke → `draftStore` (instant) → debounced DB write.
- **Preview.vue** — Purely computed-driven. Reads from `draftStore` for instant preview. Sanitizes rendered HTML via DOMPurify. Applies front-matter variable substitution. No watchers or methods — reactive rendering only.
- **`@` alias** — Vite resolves `@/` to `frontend/src/`.

---

## Phone Layout (below 768 px)

Phones and desktop render different component trees; they share stores, the Editor and the
Preview. Spec: `docs/specs/shipped/mobile-ui/` (design spec plus `implementation-spec.md`).

- `composables/useViewport.js` decides (`isPhone`, `matchMedia('(max-width: 767.98px)')`) and
  gives `visibleStyle`, which pins `PhoneShell` and sheets to `visualViewport` (top and height),
  so they end at the top of the on-screen keyboard. It also reports `keyboardOpen`, which
  `PhoneShell` turns into `.ph-keyboard-open`; that zeroes `--ph-safe-bottom`, the token every
  phone bottom edge pads with (see `docs/architecture/ui-design-system.md` §7). Use only the visual viewport: iOS updates
  `innerHeight`, `100dvh` and the visual viewport at different moments, and mixing them once
  collapsed the editor to a sliver when the keyboard opened. Docked key rows sit at the bottom
  of their screen (`position: absolute`), never at a computed keyboard offset.
- `HomePage.vue` renders `PhoneShell` with `PhoneHome` / `PhoneFolderView` / `PhoneEditor` on
  phones, and the Navbar + sidebar + `ContentArea` layout otherwise. `/search` and `/folders`
  are phone-only routes; `/settings` switches through `SettingsRoute.vue`.
- **Desktop components never render below 768 px.** Do not add `sm:`/`md:` variants or phone
  branches to Navbar, SubMenuBar, the sidebar, ContentArea or the dashboards; change
  `components/phone/` instead.
- Phone components live in `components/phone/` and style themselves with the `--ph-*` tokens
  and `.ph-*` classes in `assets/phone.css`, scoped under `.phone-ui` (the `PhoneShell` root)
  with a dark mirror. Avoid Tailwind colour classes there: `main.css` remaps them in dark mode.
- Sheets and the Drawer are `?sheet=drawer|capture|menu|move|collaborate|export` on the
  current route (`useSheetRoute`), so back closes a sheet before leaving the screen. Use
  `closeSheetAndGo()` to leave a sheet for another screen in one history step.
- `PhoneEditor` keeps the Editor mounted in Preview (`hide-text`), because the Editor owns the
  pending save, conflict state and live-session binding. Key-row keys and Preview checkboxes
  edit through `editorStore.transformText(fn)` with pure functions from `utils/markdownKeys.js`
  and `utils/markdownTasks.js`; never write the textarea directly.
- Card and search previews are plain text from `utils/markdownSnippet.js`, rendered as text
  nodes. There is no Inbox: a note in no folder shows no folder chip and is called "No folder"
  where a location has to be named (Move, capture, search results).
- Home and folders start new notes from two floating buttons (`NewNoteButtons`: note, and note
  from template); there is no bottom bar. `QuickCaptureSheet` creates the Document as soon as
  its body has text and keeps it in step (content, title, folder) through one ordered write
  queue per opening, so a slow create is never overtaken. Title: the typed one, else
  `titleFromBody` (first three words, at most 50 characters). Done, swipe-down and back keep
  the note; Discard deletes it; a note emptied before closing is deleted. "Save to" can create a
  new top-level folder.
- Home and folders sort by `uiStore.noteSort` (`modified`/`created`/`title`, `asc`/`desc`),
  chosen from the sort sheet or Settings. `getRecentDocuments` and `getFolderDocuments` take
  `{ sort }` and order in SQL from an allow-list, so the 200-row limit keeps the right notes;
  without `sort` they keep the dashboards' newest-modified query. Pinned notes stay first.

---

## Toast System

```javascript
import { useUiStore } from '@/store/uiStore';
const ui = useUiStore();
ui.addToast('Message', 'success');  // types: 'success', 'error', 'info', 'warning'
ui.addToast('Moved to Work', 'success', 5000, { action: { label: 'Undo', onSelect: undo } });
```

`window.alert` is globally overridden to route through the toast system (see `main.js`).

---

## Variable Substitution (Front-Matter)

```markdown
---
title: My Document
author: Jane
---
# {{ title }}
By {{ author }}
Today: {{ GLOBAL_DATE }}
```

- Document-level variables defined in YAML-style front-matter block (not rendered in preview/PDF).
- Global variables stored in the `globals` table, managed via `globalVariablesStore`.
- Built-in globals: `GLOBAL_DATE`, `GLOBAL_TIME`.
- `markdownStore.applyMetadataVariables()` performs substitution before rendering; it delegates to
  `applyDocumentVariables` in `shared/markdownRender.js`, the same code the API uses, and
  `shared/tests/fixtures/document.{md,html}` is the recorded rendering both sides' tests compare against.

---

## Code Conventions

- **Pinia Composition API** for all stores — `defineStore('name', () => { ... })`.
- **`markRaw()`** for non-reactive objects (WASM DB instances).
- **Debounced saves**: 500ms is the standard interval across stores (local `debounce()` helper defined inline).
- **Computed properties** for derived state; avoid storing derived values in refs.
- **`storeToRefs()`** when forwarding refs between stores (e.g., in `docStore` facade).
- **Circular dependency avoidance**: use dynamic `await import('./storeName')` when stores have circular refs (see `syncStore` importing `uiStore`).
- **Tailwind CSS** for styling; scoped `<style scoped>` blocks with `:deep()` for child component overrides.
- **Lucide Vue Next** for icons.
- Shared-space management lives at `/spaces`; invitation landing is explicit (never auto-accepts)
  and posts the raw email token in the request body before removing it from the address bar.
- **`@/`** path alias resolves to `frontend/src/`.
- **No TypeScript** — plain JavaScript throughout.
