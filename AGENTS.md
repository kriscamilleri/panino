# Panino — Agent Handbook

> Canonical reference for all AI coding agents working in this repository.
> Read this file in full before starting any task.
> For layer-specific details, also read `backend/api-service/agents.md` or `frontend/agents.md` as needed.

---

## Table of Contents

1. [Agent Workflow & Progress Logging](#1-agent-workflow--progress-logging)
2. [Project Overview](#2-project-overview)
3. [Architecture](#3-architecture)
4. [Development Environment](#4-development-environment)
5. [Database & Sync](#5-database--sync)
6. [Code Conventions](#6-code-conventions)
7. [Security Guidelines](#7-security-guidelines)
8. [Deployment & Infrastructure](#8-deployment--infrastructure)
9. [File-Level Cheat Sheet](#9-file-level-cheat-sheet)

---

## 1) Agent Workflow & Progress Logging

### Mandatory progress log

Every agent session **must** create or append to a timestamped markdown log file:

```
docs/agent-logs/YYYY-MM-DD_HH-MM_<short-slug>.md
```

Example: `docs/agent-logs/2026-02-15_09-30_add-image-resize.md`

The file should contain:

```markdown
# <Task title>

**Agent:** <agent identifier or session id>
**Started:** YYYY-MM-DD HH:MM
**Status:** in-progress | completed | blocked

## Objective
One-sentence summary of what was requested.

## Progress
- [ ] Step 1 description
- [x] Step 2 description (completed)
- ...

## Changes Made
- `path/to/file.js` — what changed and why

## Tests
- Ran `npm test` in `backend/api-service` — all passed
- MCP validation: console clean, flow verified at 1280px and 375px

## Open Items / Notes
Anything unfinished, blocked, or worth flagging for the next agent.
```

Update **Status** and **Progress** as you go. If you are picking up work started by another agent, read their log first and continue in the same file (append a new section with your timestamp) or create a new log referencing theirs.

### Distribute work across agents

- Prefer **delegating independent sub-tasks to sub-agents** (using `runSubagent` or equivalent) rather than doing everything sequentially.
- Good candidates for delegation: research/context gathering, writing tests for code you've already written, validating frontend flows via MCP, running lint/type checks.
- When delegating, give the sub-agent a clear, self-contained prompt with all context it needs — do not assume it can see your conversation.
- After a sub-agent completes, incorporate its results and verify before marking the task done.

### General workflow rules

- **Every feature must include tests.** Treat a feature as incomplete until tests are added or updated.
- **Validate all frontend changes with Chrome DevTools MCP.** Verify user flow, console errors, network requests, and responsive viewports before marking done.
- **Keep scope small.** Implement only what the task asks for; avoid unrelated refactors.
- **Always leave a verifiable trail.** Record tests run, MCP checks performed, and anything that could not be verified locally.

---

## 2) Project Overview

Panino is a **local-first markdown note-taking PWA** with optional cloud sync.

- Notes live in a client-side SQLite database (WebAssembly) and work fully offline.
- Optional multi-device sync uses CR-SQLite's conflict-free replication protocol.
- Markdown editing with live preview, custom preview/print styles, image uploads, PDF export, front-matter metadata variables, and file/folder organization.
- Licensed under AGPL-3.0.

---

## 3) Architecture

### Three-tier design

```
┌────────────────────────────────────┐
│  Frontend (Vue 3 SPA)             │  :5173 (dev)
│  Local SQLite via WASM            │
│  @vlcn.io/crsqlite-wasm           │
└──────────────┬─────────────────────┘
               │ REST + WebSocket
┌──────────────▼─────────────────────┐
│  Backend API (Node/Express)        │  :8000
│  Per-user SQLite via native        │
│  @vlcn.io/crsqlite + better-sqlite3│
│  Puppeteer (PDF generation)        │
└──────────────┬─────────────────────┘
               │
┌──────────────▼─────────────────────┐
│  Nginx (prod only)                 │
│  Reverse proxy + SSL termination   │
│  /api → backend :8000              │
└────────────────────────────────────┘
```

### Key technology stack

| Layer | Technologies |
|-------|-------------|
| Frontend | Vue 3, Vite 5, Pinia, Tailwind CSS 3, Vue Router (hash history), MarkdownIt, OverType editor, Lucide icons, @vlcn.io/crsqlite-wasm |
| Backend | Node.js 20+, Express 4, better-sqlite3, @vlcn.io/crsqlite (native), ws, jsonwebtoken, bcryptjs, Puppeteer, multer, nodemailer, DOMPurify, pdf-lib |
| Infra | Docker Compose, Nginx, Let's Encrypt, MailHog (dev) |

### Critical concept: CR-SQLite sync

- Frontend uses `@vlcn.io/crsqlite-wasm` for local database with CRDT capabilities.
- Backend uses `@vlcn.io/crsqlite` (native) for per-user databases stored in `backend/api-service/data/`.
- Each client has a unique `site_id` (hex string, 16 bytes) stored in `localStorage` as `crsqlite_site_id`.
- Sync protocol exchanges change sets via the `crsql_changes` virtual table, tracked by `db_version` clock.
- WebSocket "pokes" (message `{ type: 'sync' }`) notify other devices when one client pushes changes.
- **Key pattern**: Backend excludes sender's `site_id` when broadcasting sync notifications to prevent echo.

---

## 4) Development Environment

### Running locally

```bash
# Full stack with Docker (frontend :5173, backend :8000, MailHog :8025)
docker compose -f docker-compose.dev.yml up --build

# Frontend only (faster iteration — backend must be running separately)
cd frontend && npm install && npm run dev
```

VS Code tasks are pre-configured:
- **Docker Compose Up** — runs `docker compose -f docker-compose.dev.yml up --build`
- **Docker Compose Down** — stops all services

### Environment files required

1. **Root `/.env`** — `JWT_SECRET`, `TURNSTILE_SECRET_KEY`, `SMTP_*`, `FRONTEND_URL`, `DOMAIN`, `EMAIL`
2. **`/frontend/.env`** — `VITE_API_SERVICE_URL`, `VITE_TURNSTILE_SITE_KEY`

In development, `JWT_SECRET` defaults to `'super-secret-for-dev'` and Turnstile verification is skipped when no key is configured.

### WASM headers

Vite dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` — required for `SharedArrayBuffer` used by CR-SQLite WASM. The backend sets `Cross-Origin-Resource-Policy: cross-origin` on all responses to comply.

### LLM context generation

```bash
npm run llm      # Full codebase
npm run llmfe    # Frontend only
npm run llmbe    # Backend only
```

---

## 5) Database & Sync

### Schema (both frontend and backend)

Tables synced via CR-SQLite CRR:

```sql
users    (id TEXT PK, name, email, created_at)
folders  (id TEXT PK, user_id, name, parent_id, created_at)
notes    (id TEXT PK, user_id, folder_id, title, content, created_at, updated_at)
images   (id TEXT PK, user_id, filename, mime_type, path, created_at)
settings (id TEXT PK, value TEXT)         -- JSON-stringified values
globals  (key TEXT PK, id, value, created_at, updated_at, display_key)
```

**When modifying schema:** Update `DB_SCHEMA` in `syncStore.js` (frontend) **AND** `BASE_SCHEMA` in `backend/api-service/db.js`. If adding a new CRR table, also add it to `CRR_TABLES` array in `db.js`.

### Auth DB schema (backend only, `_users.db`)

```sql
users           (id TEXT PK, name, email, password_hash, created_at)
password_resets (token_hash TEXT PK, user_id, expires_at)
```

### Settings table conventions

The `settings` table stores key-value pairs where `value` is a JSON string:
- `previewStyles` — on-screen preview style map
- `printStyles` — PDF/print style map
- `uiSettings` — panel visibility, editor preferences

### Sync endpoint contract

```
POST /sync
Body: { since: <number>, siteId: <hex_string>, changes: [...] }
Response: { changes: [...], clock: <number> }
```

Each change object: `{ table, pk, cid, val, col_version, db_version, site_id, cl, seq }`

- `pk` is a JSON array string: `'["uuid-value"]'`
- `site_id` is a 32-char hex string (16 bytes)
- `val` is a JSON-encoded scalar

### Type conversion helpers (in `sync.js`)

- `toBufferLike(v)` — converts hex strings, arrays, UUID strings, base64, object-with-numeric-keys to Buffer.
- `toSiteIdBlob(v)` — converts to site_id Buffer, padded/truncated to 16 bytes.
- `toSqliteScalar(v)` — normalizes value for SQLite binding.

---

## 6) Code Conventions

### General

- **ES Modules** throughout (`"type": "module"` in all package.json files).
- **No TypeScript** — plain JavaScript with JSDoc where helpful.
- **Node 20+** required (`"engines": { "node": ">=20" }` in backend package.json).
- **UUIDs** for all entity IDs — generated with `uuid` v4.
- **ISO 8601** for all timestamps (`new Date().toISOString()`).

### API URL pattern

```javascript
const API_URL = import.meta.env.VITE_API_SERVICE_URL || '';
// In production, empty string means relative URLs → /api/... via Nginx proxy
// In development, full URL like http://localhost:8000
```

Backend routes do NOT have an `/api` prefix; Nginx strips it in production.

> See `backend/api-service/agents.md` for backend-specific conventions and `frontend/agents.md` for frontend-specific conventions.

---

## 7) Security Guidelines

### Enforced patterns

- **HTML sanitization**: All user-generated HTML is sanitized with DOMPurify before rendering (Preview) or PDF generation.
- **SSRF protection**: PDF service performs DNS lookup + private IP check before fetching external image URLs.
- **Path traversal protection**: Image GET handler validates that resolved path stays within `UPLOADS_DIR`.
- **CORS**: Backend uses `cors()` middleware (permissive in dev).
- **CSRF via CAPTCHA**: Signup protected with Cloudflare Turnstile.
- **Password reset tokens**: Stored as SHA-256 hashes, expire after 1 hour, deleted after use.
- **Email enumeration prevention**: Forgot-password always returns success regardless of whether email exists.
- **External links**: Preview renderer adds `target="_blank" rel="noopener noreferrer"` to all external links.

### What to watch for

- Never construct SQL with string concatenation — always use parameterized queries.
- Never expose raw error messages or stack traces to clients in production.
- Never store plaintext passwords.
- Never trust `req.body.userId` for authorization — always use `req.user.user_id` from JWT middleware.
- Image uploads: validate file type/size, generate UUID filenames (never use original filename for storage path).

---

## 8) Deployment & Infrastructure

### Docker Compose files

- `docker-compose.dev.yml` — Development: hot-reload volumes, MailHog for email, no SSL.
- `docker-compose.yml` — Production: named volumes for persistence, no frontend service (served by Nginx from built files).

### Production deployment

`deploy.sh` handles:
1. Load env vars from `.env`
2. Build frontend with Vite
3. Configure Nginx (reverse proxy, SSL via Let's Encrypt or self-signed)
4. Start Docker Compose services

### Docker volumes (production)

- `api-data` → `/app/data` — SQLite database files (auth DB + per-user DBs)
- `uploads-data` → `/app/uploads` — User-uploaded image files

### Nginx routing

- `/` → serves built frontend static files
- `/api/*` → strips `/api` prefix, proxies to backend `:8000`
- WebSocket upgrade handled for `/api/` paths

### Backend Dockerfile notes

- Based on `node:20-bookworm-slim` (not Alpine) — needed for Puppeteer's Chromium dependencies.
- Installs native build tools for `@vlcn.io/crsqlite` compilation.
- `CRSQLITE_EXT_PATH` env var set explicitly.
- `npm rebuild @vlcn.io/crsqlite --build-from-source` in Docker build.
- `patch-crsqlite.sh` runs as postinstall script.

---

## 9) File-Level Cheat Sheet

### When adding or modifying...

| Task | Files to check / update |
|------|------------------------|
| Authentication | `backend/api-service/auth.js`, `frontend/src/store/authStore.js` |
| Sync logic | `backend/api-service/sync.js`, `frontend/src/store/syncStore.js` |
| Database schema | `frontend/src/store/syncStore.js` (`DB_SCHEMA`), `backend/api-service/db.js` (`BASE_SCHEMA` + `CRR_TABLES`) |
| UI components | `frontend/src/components/`, `tailwind.config.js` |
| Routing (frontend) | `frontend/src/router.js`, add component under `frontend/src/pages/` or `frontend/src/components/` |
| Routing (backend) | Create module like `auth.js`, export router, mount in `index.js` |
| Styles (preview/print) | `frontend/src/store/markdownStore.js`, `poc/print-defaults.json` |
| Global variables | `frontend/src/store/globalVariablesStore.js`, `backend/api-service/db.js` (ensure `globals` in `CRR_TABLES`) |
| Image handling | `backend/api-service/image.js`, `frontend/src/components/Editor.vue` (paste upload), `backend/api-service/pdf.js` (embedding) |
| PDF generation | `backend/api-service/pdf.js` |
| Import/Export | `frontend/src/store/importExportStore.js` |
| Email | `backend/api-service/mailer.js` |
| Tests | `backend/api-service/tests/unit/` or `tests/integration/`, use helpers from `tests/testHelpers.js` |
| Environment config | Root `.env`, `frontend/.env`, `docker-compose.dev.yml`, `docker-compose.yml` |
| Docker / deployment | `backend/api-service/Dockerfile`, `frontend/Dockerfile.dev`, `docker-compose*.yml`, `deploy.sh`, `nginx.conf.template` |
