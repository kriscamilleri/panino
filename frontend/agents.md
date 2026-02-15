# Frontend — Agent Reference

> Layer-specific reference for agents working on the frontend Vue 3 SPA.
> Always read the root `agents.md` first for project-wide rules, architecture, database schema, and security guidelines.

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
| `structureStore` | File/folder tree, selection, CRUD operations | syncStore, authStore |
| `docStore` | **Facade** — re-exports from structureStore + markdownStore, orchestrates coordinated operations | structureStore, markdownStore, syncStore, importExportStore |
| `markdownStore` | MarkdownIt rendering, preview/print style management, front-matter parsing, variable substitution | syncStore, authStore, globalVariablesStore |
| `draftStore` | Ephemeral in-memory draft content (keystroke-speed, not persisted to DB) | — (independent) |
| `editorStore` | Bridge/proxy to Editor component's exposed methods for toolbar actions | — (independent) |
| `historyStore` | Per-file undo/redo stack (max 100 entries per file) | — (independent) |
| `uiStore` | Panel visibility (persisted to DB), menus, modals, toast notifications | syncStore |
| `globalVariablesStore` | Global template variables CRUD, normalized key lookup | syncStore, authStore, uiStore |
| `importExportStore` | JSON/ZIP/StackEdit/SQLite export, JSON/StackEdit import | syncStore, structureStore, authStore |

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
// READ — returns array of row objects
const rows = await syncStore.execute('SELECT * FROM notes WHERE id = ?', [id]);

// WRITE — no return value
syncStore.db.value.exec('INSERT INTO notes (id, title) VALUES (?, ?)', [id, title]);
```

- `syncStore.execute()` → reads (returns `execO` — array of objects).
- `syncStore.db.value.exec()` → writes (no return value).
- Wrap multi-statement writes in `BEGIN` / `COMMIT` / `ROLLBACK`.

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

## Toast System

```javascript
import { useUiStore } from '@/store/uiStore';
const ui = useUiStore();
ui.addToast('Message', 'success');  // types: 'success', 'error', 'info', 'warning'
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
- `markdownStore.applyMetadataVariables()` performs substitution before rendering.

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
- **`@/`** path alias resolves to `frontend/src/`.
- **No TypeScript** — plain JavaScript throughout.
