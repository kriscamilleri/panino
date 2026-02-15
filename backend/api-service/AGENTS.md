# Backend — Agent Reference

> Layer-specific reference for agents working on the backend API service.
> Always read the root `agents.md` first for project-wide rules, architecture, database schema, and security guidelines.

---

## Module Map

All code lives under `backend/api-service/`. The entry point is `index.js`, which exports a `createApp()` factory (used directly by tests).

| File | Responsibility | Auth |
|------|---------------|------|
| `index.js` | Express app factory, HTTP server, WebSocket server, route mounting | — |
| `auth.js` | `POST /login`, `POST /refresh`, `GET /me`, `POST /me/password`, `authenticateToken` middleware | Mixed |
| `signup.js` | `POST /signup` with Turnstile CAPTCHA verification | Public |
| `passwordReset.js` | `POST /forgot-password`, `POST /reset-password` | Public |
| `sync.js` | `POST /sync` — bidirectional CR-SQLite change set exchange | Authenticated |
| `image.js` | `POST /images` (upload), `GET /images/:id` (serve) | Authenticated |
| `pdf.js` | `POST /render-pdf` — Puppeteer HTML→PDF with queued processing | Authenticated |
| `db.js` | `getUserDb(userId)`, `getAuthDb()`, `initDb()`, DB connection caching, CR-SQLite extension loading | — |
| `mailer.js` | Nodemailer transport, `sendPasswordResetEmail()` | — |

---

## Route Mounting Order (in `index.js`)

1. Public routes: `signupRoutes`, `passwordResetRoutes`
2. Mixed routes: `authRoutes` (login is public, /me and /refresh need auth)
3. `authenticateToken` middleware (all routes after this require auth)
4. Authenticated routes: `syncRoutes`, `imageRoutes`, `pdfRoutes`

---

## Authentication Pattern

- JWT token with `{ user_id, sub, name, email }` payload, 7-day expiry.
- Frontend stores token in `localStorage` as `jwt_token`.
- Backend extracts from `Authorization: Bearer <token>` header, with fallback to `?token=<jwt>` query param (for `<img>` tags).
- `authenticateToken` middleware sets `req.user = { user_id }`.
- **Never trust `req.body.userId`** — always use `req.user.user_id` from the middleware.

---

## Database Architecture

Two database types:
1. **Auth DB** (`data/_users.db`) — single shared DB for `users` and `password_resets` tables. Access via `getAuthDb()`.
2. **Per-user DBs** (`data/{userId}.db`) — one DB per user with synced content tables. Access via `getUserDb(userId)`.

Connection caching: `dbConnections` Map keyed by userId (or `'_auth'`). All connections get WAL mode and normal synchronous pragma.

CR-SQLite extension is loaded per-connection. Path resolved via `CRSQLITE_EXT_PATH` env var or auto-discovery under `node_modules/@vlcn.io/crsqlite/`.

---

## WebSocket Protocol

- Client connects with `?token=<jwt>&siteId=<hex>` query params.
- Server verifies JWT, associates `{ userId, siteId }` with the connection.
- After receiving sync changes, server sends `{ type: 'sync' }` to all same-user connections **except** the sender.
- WebSocket server and clients Map are attached to every request via middleware (`req.wss`, `req.clients`).

---

## PDF Generation

- Single Puppeteer browser instance reused across requests.
- Requests queued and processed sequentially to limit memory.
- Images pre-embedded as data URIs (both internal DB images and external URLs).
- SSRF protection: DNS lookup + private IP check before fetching external images.
- Page numbers resolved via draft PDF render + pdf-lib page count.
- HTML sanitized with DOMPurify before rendering.
- Print style defaults loaded from `poc/print-defaults.json` with bundled fallbacks.

---

## Code Conventions

- Express Router for each feature module, exported as named const (e.g., `export const authRoutes = express.Router()`).
- Route handlers use `try/catch` with `res.status(500).json({ error: '...' })` for error responses.
- `getUserDb(userId)` for per-user DB access; `getAuthDb()` for auth DB. Both cache connections.
- Password hashing: `bcryptjs` with 10 salt rounds.
- JSON body limit: `50mb` (for sync payloads with large content).
- Image upload limit: `10MB` via multer.
- UUID filenames for stored images (never use original filename for storage path).
- `CORP: cross-origin` header on all responses (middleware in `index.js`) for frontend COEP compliance.

---

## Testing

### Framework & config

- **Vitest** with `globals: true` (no need to import `describe`/`it`/`expect`).
- **supertest** for HTTP integration tests.
- Setup file: `tests/setup.js` — sets `JWT_SECRET` and `NODE_ENV=test`, calls `closeAllConnections()` after each test.
- Config: `vitest.config.js` with `testTimeout: 10000`, v8 coverage provider.

### Running tests

```bash
# From backend/api-service directory
npm test              # vitest run (single pass)
npm run test:watch    # vitest (watch mode)
npm run test:coverage # vitest with v8 coverage

# Via Docker
docker build -f Dockerfile.test -t panino-test .
docker run --rm panino-test
```

### Directory structure

```
tests/
├── setup.js              # Global setup (env vars, cleanup)
├── testHelpers.js        # createTestApp(), getTestToken(), setupTestUser(), cleanupTestUser()
├── fixtures/
│   ├── users.js          # Predefined test users (alice, bob) with pre-hashed passwords
│   └── changes.js        # Sample CRDT change objects for sync tests
├── unit/
│   ├── auth.test.js      # authenticateToken middleware unit tests
│   ├── db.test.js        # Database utility tests
│   └── sync.test.js      # Sync helper function tests
└── integration/
    ├── auth.test.js       # POST /login, token validation end-to-end
    ├── image.test.js      # Image upload and retrieval
    ├── me.test.js         # GET /me, POST /me/password
    ├── passwordReset.test.js
    ├── pdf.test.js        # PDF generation
    ├── sync.test.js       # Sync endpoint integration
    └── websocket.test.js  # WebSocket connection and poke tests
```

### Test helper API

```javascript
import { createTestApp, getTestToken, setupTestUser, cleanupTestUser, generateSiteId } from '../testHelpers.js';

// Create app instance (uses createApp() factory from index.js)
const { app, server } = createTestApp();

// Create a test user in auth DB, returns { userId, email, password }
const testUser = await setupTestUser('test@example.com', 'password123');

// Generate a JWT for the test user
const token = getTestToken(testUser.userId);

// Clean up after test (removes from auth DB + deletes user DB files)
cleanupTestUser(testUser.userId);

// Generate a 32-char hex site_id
const siteId = generateSiteId('a');
```

### Writing new tests

- **Unit tests** go in `tests/unit/` — test exported functions in isolation with mocked deps.
- **Integration tests** go in `tests/integration/` — test HTTP endpoints via supertest against the real app.
- Use `beforeAll` to create app, `beforeEach` to set up test data, `afterEach` to clean up, `afterAll` to close server.
- Mock pattern: use `vi.fn()` for Express `req`/`res`/`next`.
- Always test: happy path, invalid input, authentication enforcement, edge cases.
- Close server in `afterAll` with: `return new Promise(resolve => server.close(resolve))`.
