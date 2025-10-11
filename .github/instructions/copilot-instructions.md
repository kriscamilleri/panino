# Panino - AI Coding Agent Instructions

## Project Overview
Panino is a **local-first markdown note-taking app** with optional cloud sync. Notes are stored in a client-side SQLite database (via WebAssembly) and can optionally sync across devices using CR-SQLite's conflict-free replication protocol.

## Architecture

### Three-Tier Design
1. **Frontend** (`/frontend`): Vue 3 SPA with local SQLite (WASM) storage
2. **Backend API** (`/backend/api-service`): Node.js/Express handling auth, sync, images, PDF generation
3. **WebSocket Layer**: Real-time sync notifications between clients

### Critical Concept: CR-SQLite Sync
- Frontend uses `@vlcn.io/crsqlite-wasm` for local database with CRDT capabilities
- Backend uses `@vlcn.io/crsqlite` (native) for per-user databases
- Each client has a unique `site_id` (stored in localStorage as `crsqlite_site_id`)
- Sync protocol exchanges change sets (`crsql_changes` table) tracked by `db_version` clock
- WebSocket "pokes" notify other devices when one client pushes changes
- **Key pattern**: Backend excludes sender's `site_id` when broadcasting sync notifications to prevent echo

## State Management (Pinia Stores)

All stores use Pinia composition API pattern. Key stores in `/frontend/src/store/`:

- **`syncStore.js`**: Core database & sync engine. Initialize DB before other operations
- **`authStore.js`**: JWT authentication, token in localStorage as `jwt_token`
- **`structureStore.js`**: File/folder tree, selected items
- **`docStore.js`**: Orchestrates other stores, use for coordinated operations
- **`markdownStore.js`**: Preview/print CSS styles (stored in DB `settings` table)
- **`uiStore.js`**: UI state with DB persistence via debounced saves
- **`draftStore.js`**: Auto-saves draft content to localStorage every 500ms
- **`editorStore.js`**: Editor focus and selection state
- **`importExportStore.js`**: Export formats (JSON, ZIP, StackEdit, SQLite)

### Store Initialization Pattern
```javascript
// Always check syncStore.isInitialized before DB operations
watch(() => syncStore.isInitialized, async (ready) => {
  if (ready) await loadData();
}, { immediate: true });
```

## Database Schema

Tables (all CRDTs via `crsql_as_crr()`):
- `users`: id, name, email, created_at
- `folders`: id, user_id, name, parent_id, created_at
- `notes`: id, user_id, folder_id, title, content, created_at, updated_at
- `images`: id, user_id, filename, mime_type, path, created_at
- `settings`: id (key), value (JSON string)

**Pattern**: Use `syncStore.execute(sql, params)` for all queries. Backend uses `getUserDb(userId)` to get per-user DB instance.

## Development Workflows

### Local Development
```bash
# Full stack with Docker (frontend on :5173, backend on :8000, mailhog on :8025)
docker compose -f docker-compose.dev.yml up --build

# Frontend only (faster iteration)
cd frontend && npm install && npm run dev

# Backend runs in Docker; frontend connects to localhost:8000
```

### Testing Pattern
```bash
npm test          # Run tests from root (delegates to tests/ folder)
npm run coverage  # Coverage report
```

### Code Generation for LLMs
Root `package.json` has scripts to generate combined file context:
```bash
npm run llm      # Full codebase
npm run llmfe    # Frontend only
npm run llmbe    # Backend only
```

## Key Conventions

### Authentication Flow
1. Login → JWT token → localStorage as `jwt_token`
2. Token includes `user_id` in payload
3. Backend middleware `authenticateToken()` extracts from `Authorization: Bearer <token>` header
4. Fallback: `?token=<jwt>` query param for `<img>` tags (see `image.js`)

### Image Upload Pattern
- POST `/images` with multipart form data
- Returns `{ id, url }` where url is `/images/:id`
- Files stored in `backend/api-service/uploads/` (persisted via Docker volume)
- Security: Path traversal check in `image.js` GET handler

### Sync Endpoint Pattern
Backend `/sync` POST:
```javascript
{
  since: <number>,      // Client's last db_version
  siteId: <hex_string>, // Client's site_id
  changes: [...]        // Local changes since last sync
}
// Returns: { changes: [...], clock: <number> }
```

### Error Handling
- Use `uiStore.addToast(message, type)` for user notifications
- Toast types: 'success', 'error', 'info', 'warning'
- Native `alert()` is overridden to use toast system

## Environment Variables

### Backend (`.env` in root)
- `JWT_SECRET`: Token signing key (generate with `openssl rand -hex 32`)
- `TURNSTILE_SECRET_KEY`: Cloudflare CAPTCHA server key
- `SMTP_*`: Email settings for password reset (mailer.js)
- `FRONTEND_URL`: For CORS and email links

### Frontend (`/frontend/.env`)
- `VITE_API_SERVICE_URL`: Backend URL (empty in prod, uses relative `/api`)
- `VITE_TURNSTILE_SITE_KEY`: Cloudflare CAPTCHA site key

## Deployment
- `deploy.sh`: Production deployment script (sets up Nginx, Let's Encrypt SSL)
- Uses `docker-compose.yml` (production) vs `docker-compose.dev.yml` (development)
- Frontend build proxied via Nginx with `/api` rewrite to backend

## Common Patterns to Follow

1. **Debouncing**: Used extensively (sync, draft saves, settings). See implementations in stores.
2. **Router**: Vue Router with hash history (`createWebHashHistory()`) for static deployment
3. **Markdown Rendering**: MarkdownIt with task list plugin (`markdownStore.js`)
4. **WASM Headers**: Vite config sets COOP/COEP headers for SharedArrayBuffer (required by CR-SQLite)
5. **Type Coercion**: Sync code has extensive Buffer/hex/blob conversions - see `toBufferLike()` helpers in `sync.js`

## Files to Check When...
- **Adding auth**: `backend/api-service/auth.js`, `frontend/src/store/authStore.js`
- **Modifying sync**: `backend/api-service/sync.js`, `frontend/src/store/syncStore.js`
- **UI changes**: Components in `/frontend/src/components/`, Tailwind in `tailwind.config.js`
- **Database schema**: Update `DB_SCHEMA` in `syncStore.js` AND `BASE_SCHEMA` in `backend/api-service/db.js`
- **Adding routes**: `backend/api-service/index.js` (mount routes), `frontend/src/router.js`
