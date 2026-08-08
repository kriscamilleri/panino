# Panino — Agent Handbook

> Read this file before starting any task, then the layer file for the area you are working
> in. Deeper reference material is linked from §5 — read it when the task touches that area,
> not upfront.

For backend details read [`backend/api-service/AGENTS.md`](backend/api-service/AGENTS.md).
For frontend details read [`frontend/AGENTS.md`](frontend/AGENTS.md).

---

## 1) Workflow and progress logging

Write a log for investigations, production incidents, features spanning multiple files or
layers, anything with a test result worth recording, and anything you could not finish.
Do not write one for a single-property style change, copy edit, or obvious one-line fix.

Use `docs/agent-logs/YYYY/MM/YYYY-MM-DD_HH-MM_<short-slug>.md`. Commit the log with the
work. Redact production IPs, real user UUIDs, and credential values with `<PROD_IP>` and
`user-A` aliases; see [`docs/agent-logs/README.md`](docs/agent-logs/README.md). Promote durable
findings to [`docs/architecture/`](docs/architecture/) in the same change.

Substantive log template: `# <Task title>`, agent/start/status fields, `## Objective`,
`## Progress`, `## Changes Made`, `## Tests`, and `## Open Items / Notes`; use the full
example in [`docs/agent-logs/README.md`](docs/agent-logs/README.md).

Delegate independent work only when the current tool supports it. Do not invent a delegation
call; work sequentially when no delegation surface exists. Verify delegated results yourself.

Every feature includes tests. Frontend changes require browser validation when a dev stack is
available. Leave a verifiable trail of commands, browser checks, and blockers.

---

## 2) Project overview

Panino is a local-first Vue 3 markdown-note PWA with optional CR-SQLite cloud sync.

```text
Frontend (Vue SPA + SQLite WASM) :5173
              │ REST + WebSocket
Backend (Express + per-user SQLite) :8000
              │
Production Nginx (static files, /api, /ws)
```

Stack: Vue 3, Vite, Pinia, Tailwind, MarkdownIt, OverType, Lucide, CR-SQLite WASM;
Node 20, Express, better-sqlite3, native CR-SQLite, Puppeteer, DOMPurify, pdf-lib.

---

## 3) Development environment

```bash
# Full dev stack
docker compose -f docker-compose.dev.yml up --build

# Environment and test verification
npm run doctor
npm run test:fe
npm run test:be
npm test
```

Backend tests run in the Node 20 Docker image because native SQLite bindings must match
production. `npm run test:be:host` is for Node 20 only. `.nvmrc` pins the intended major.

Root `.env` supplies backend settings; `frontend/.env` supplies Vite settings. Vite and the
backend configure the cross-origin headers required by CR-SQLite WASM.

### Directories not to read

| Path | Why |
|---|---|
| `backend/api-service/data/`, `backend/api-service/uploads/` | Real user data |
| `backend/api-service/vendor/` | Large generated/vendor bundles |
| `frontend/dist/`, `combined_content.txt` | Generated output |
| `docs/agent-logs/archive/` | Superseded narrative; use architecture docs |

---

## 4) Code and security rules

- Use ES modules, plain JavaScript, UUIDs, and ISO 8601 timestamps.
- Use parameterized SQL. Never interpolate user input into queries.
- Schema changes go in both frontend `DB_SCHEMA` and backend `BASE_SCHEMA`; new CRR tables
  also go in backend `CRR_TABLES`.
- Sanitize user HTML before preview/PDF rendering.
- Keep SSRF DNS/private-IP checks for external PDF images.
- Keep image paths within the upload root and generate UUID storage names.
- Never trust `req.body.userId`; authorize from `req.user.user_id`.
- Never expose raw production errors, stack traces, passwords, JWTs, or reset tokens.
- Passwords are hashed; reset tokens are hashed, expiring, and single-use.
- External preview links use `target="_blank" rel="noopener noreferrer"`.

### Production access

Credentialed production SSH access, when needed for incident response, remains machine-local
in `.claude/settings.local.json` and is not shared in committed settings. Load the
`prod-server-debug` skill first and default to read-only inspection. Any write, repair, or
restart requires explicit approval in the current conversation, a timestamped backup first,
and an agent log.

---

## 5) Where to find deeper detail

Read these only when working in the relevant area:

| Topic | File |
|---|---|
| CR-SQLite internals, sync-bit semantics, clock tables | [`docs/architecture/crsqlite-sync.md`](docs/architecture/crsqlite-sync.md) |
| Database schema and `/sync` wire contract | [`docs/architecture/data-model.md`](docs/architecture/data-model.md) |
| Auth, JWT, and WebSocket handshake | [`docs/architecture/auth-and-jwt.md`](docs/architecture/auth-and-jwt.md) |
| PDF pipeline and SSRF protections | [`docs/architecture/pdf-pipeline.md`](docs/architecture/pdf-pipeline.md) |
| Deployment, Nginx, and Docker volumes | [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md) |
| Sync incident response | [`docs/runbooks/sync-incident-response.md`](docs/runbooks/sync-incident-response.md) |
| Production debugging | [`.github/skills/prod-server-debug/SKILL.md`](.github/skills/prod-server-debug/SKILL.md) |
| Full feature SDLC | [`.github/skills/feature-development/SKILL.md`](.github/skills/feature-development/SKILL.md) |

---

## 6) File-level routing

| Task | Start here |
|---|---|
| Authentication | `backend/api-service/auth.js`, `frontend/src/store/authStore.js` |
| Sync | `backend/api-service/sync.js`, `frontend/src/store/syncStore.js` |
| Database schema | `backend/api-service/db.js`, `frontend/src/store/syncStore.js` |
| UI components | `frontend/src/components/`, `frontend/tailwind.config.js` |
| Frontend routing | `frontend/src/router.js`, `frontend/src/pages/` |
| Backend routes | `backend/api-service/index.js` and the route module |
| Styles | `frontend/src/store/markdownStore.js`, `poc/print-defaults.json` |
| Global variables | `frontend/src/store/globalVariablesStore.js` |
| Images | `backend/api-service/image.js`, `frontend/src/components/Editor.vue` |
| PDF | `backend/api-service/pdf.js` |
| Import/export | `frontend/src/store/importExportStore.js` |
| Tests | `frontend/tests/unit/`, `backend/api-service/tests/` |
| Deployment | `docker-compose*.yml`, `deploy.sh`, `nginx.conf.template` |
