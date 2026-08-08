# DX-09 — Backend Type Checking via `checkJs` + JSDoc

> Add a TypeScript type-checking gate to the backend without converting a single file to
> `.ts`, without a build step, and without touching the deploy path.
> Status: proposed
> Created: 2026-08-08
> Last updated: 2026-08-08
> Priority: P1 — the two files behind both 2026 production incidents (`sync.js`, `db.js`) have no static checking beyond ESLint
> Depends on: none. [DX-02](dx-02-ci-test-gate.md) provides the CI workflow this extends; if DX-02 has not shipped, Phase 4 creates the step in whatever workflow exists.

---

## 1) Summary

The question that produced this spec was "how big a lift is porting the backend to
TypeScript?" The answer: a full port is 3–5 days, adds a build step to a currently
build-free backend, moves `tsc` onto the critical path of a deploy that builds *on the
production server* (`deploy.sh:303`), and — because the frontend is pure JS — types only
one end of the sync contract that matters most.

This spec takes the 80% instead. TypeScript's `checkJs` mode type-checks plain `.js` files
using inference plus JSDoc annotations. The files stay `.js`. Nothing is emitted
(`noEmit`). `tsc` runs as a CI gate next to `eslint`, exactly like a linter.

**The full port is not what this spec delivers, and adopting this does not commit the
project to one.** It does, however, make one cheaper later: JSDoc annotations written now
convert mechanically to `.ts` annotations if that day comes.

Every number below was measured against the working tree at `8601c5f`, not estimated.

---

## 2) Problem & Evidence

### 2.1 The backend's only static analysis is ESLint's default ruleset

`eslint.config.mjs` is deliberately scoped to "real defects — unused imports, stray
console.log, undefined identifiers." It is explicitly *not* a type checker. Nothing in the
repo verifies that a value flowing between two functions has the shape the receiver
expects.

### 2.2 That gap sits directly on the incident-prone code

`docs/specs/dx/dx-00-overview.md` section 1 records that the Node ABI blocker hit
"at least four recorded sessions, all of them touching `sync.js` or `db.js` — the two files
responsible for both 2026 production incidents." Those same two files are the ones doing
untyped shape-juggling: `toBufferLike()` in `sync.js:23-62` accepts `Buffer | Array |
object | string`, returns `Buffer | null`, and its result flows unchecked through
`toPkValue()` and `toSqliteScalar()` into CR-SQLite change tuples.

### 2.3 The codebase has already started doing this by hand, informally

`db-repair.js` and `db.js` carry 11 JSDoc annotations between them, including
`@param {import('better-sqlite3').Database} db` at `db-repair.js:20`. Nothing checks them,
and **one of them is already wrong** — see finding F6 in section 8.

### 2.4 A full `.ts` port carries costs this approach avoids entirely

| Cost of a full port | Status under this spec |
|---|---|
| Multi-stage Dockerfile rework (`Dockerfile:59` runs `npm ci --omit=dev`, so a devDep `tsc` is absent at build time) | **Avoided** — no build step |
| `tsc` on the critical path of a server-side production build (`deploy.sh:303`) | **Avoided** — CI-only gate |
| Source maps required to keep runbook stack traces readable | **Avoided** — the shipped file is the authored file |
| 79 `.prepare()` call sites needing row generics | Deferred; opt-in per file |
| Types only one end of the frontend↔backend sync contract | Unchanged — still true, still a reason to be sceptical of a full port |

---

## 3) Goals

1. `npm run typecheck` exists, runs in under ~10s, and passes on a clean tree.
2. CI fails on a type error, in the same job that runs lint and tests.
3. Zero change to `Dockerfile`, `Dockerfile.test`, `deploy.sh`, `docker-compose.yml`, or
   `vitest.config.js`.
4. Zero runtime behavior change. No `.js` file changes what it does.
5. The strictness level is a dial the project can turn up later, with the cost of each
   notch already measured (section 5).

## 4) Non-Goals

- **No `.ts` files.** Not one, other than a single ambient `types.d.ts`.
- **No build step, no bundler, no emit.**
- **No frontend changes.** The frontend stays pure JS; DX-09 is backend-only.
- **No `font-service`.** 35 lines, unmaintained, already ESLint-ignored.
- **Not full `strict`.** Section 5 explains why `noImplicitAny` is deferred.
- **No refactoring to satisfy the checker.** If a fix is not a type annotation, it is
  either a suppression with a comment or a separate PR. See section 7, R2.

---

## 5) Key decisions, with measured justification

An agent picking this up should not re-litigate these. Each was measured.

### 5.1 Strictness tier — adopt "loose + `strictNullChecks`", not full `strict`

Error counts across the backend source (`*.js` + `scripts/`, excluding `vendor/`, `tests/`,
`test-pdf.js`), measured with `tsc --noEmit`:

| Tier | Errors | Verdict |
|---|---|---|
| A — `strict: false` | 55 | |
| A + ambient `types.d.ts` | **21** | **Phase 1 target** |
| B — A + `strictNullChecks` + `types.d.ts` | **27** | **Phase 3 target** |
| C — `strict` minus `noImplicitAny` | 87 | later |
| D — full `strict` | 337 | not now |

Full `strict` costs 337 errors, of which **195 are TS7006 and 26 are TS7031** — implicit
`any` on function parameters, overwhelmingly Express `(req, res)` handler signatures. That
is 66% of the total cost, it is annotation busywork, and it is the *lowest*-signal tier.
`noImplicitAny` is where a `checkJs` adoption goes to die. Defer it.

The remaining tiers are cheap and high-signal: TS2339 (property does not exist, 61) and
TS18046 (`unknown` in catch, 27) are the ones that describe real shape mismatches.

### 5.2 One ambient `types.d.ts` does most of the work

34 of the 55 loose-tier errors are the Express request augmentations this codebase
performs at runtime: `req.user` (set by `authenticateToken`, `auth.js:32`), `req.wss` and
`req.clients` (`index.js:77-78`), and `req.fileValidationError` (`image.js`). A 13-line
declaration file removes all 34: **55 → 21, measured.**

### 5.3 Declare `req.user` as **required**, not optional

Measured under `strictNullChecks`:

| Declaration | Errors |
|---|---|
| `user?: { user_id: string }` | 49 |
| `user: { user_id: string }` | **27** |

The 22-error difference is every `req.user.user_id` site demanding `?.` or `!`. Declaring
it required is technically a lie on public routes — but it is the lie the codebase is
already built on, and `backend/api-service/AGENTS.md` documents the invariant that makes it
safe: route mounting order in `index.js:87-100` puts `authenticateToken` before every
router that reads `req.user`.

**This is load-bearing.** Put the rationale in a comment in `types.d.ts`, pointing at the
mounting order. If someone ever mounts an authenticated router above line 95, the type
system will not catch it.

### 5.4 Include `tests/` from Phase 2 — it is cheap

Adding all 4,856 lines of `tests/` at the loose tier costs **19 additional errors**
(21 → 40). That is far less than the source, because tests are mostly literal fixtures.
No reason to leave the test suite unchecked.

### 5.5 `@types` majors must be pinned below `@latest`

Four runtime deps are a major behind their `@types` package, and one has no matching major
at all. Installing `@latest` produces silently wrong types. **These exact ranges were
verified to resolve:**

| Package | Runtime version | Wrong (`@latest`) | **Correct range** | Resolves to |
|---|---|---|---|---|
| `@types/express` | 4.19 | 5.0.6 | `^4` | 4.17.25 |
| `@types/uuid` | 9.0.1 | 11.0.0 | `^9` | 9.0.8 |
| `@types/bcryptjs` | 2.4.3 | 3.0.0 (a stub) | `^2` | 2.4.6 |
| `@types/multer` | 1.4.5 | 2.2.0 | `^1` | 1.4.13 |
| `@types/nodemailer` | 6.10.1 | 8.0.1 | `^6` | 6.x |
| `@types/jsdom` | 24.1.3 | 30.0.0 | `^21` ⚠ | 21.x |

⚠ **`@types/jsdom` has no v24.** Published majors are 2, 11, 12, 16, 20, 21, 27, 28, 30.
`^21` is the closest below the runtime version. `jsdom` is used in exactly one place —
`new JSDOM('')` at `pdf.js:37` — so the drift is immaterial.

Five deps ship their own types and need no `@types` package: `pdf-lib`, `puppeteer`,
`dompurify`, `node-fetch`, `@vlcn.io/crsqlite`.

### 5.6 `moduleResolution: NodeNext` works with zero import rewrites

The backend is already pure ESM (`"type": "module"`) and **every first-party relative
import already carries a `.js` extension** (`index.js:12-20`). `NodeNext` requires exactly
that. This is normally the most invasive part of a TS adoption; here it is free. Do not
change a single import statement.

---

## 6) Implementation

### Phase 1 — Toolchain and the ambient declaration (~1 hr)

**1.1** Add devDependencies to `backend/api-service/package.json`. Use these ranges
verbatim — see 5.5:

```
typescript@^5  @types/node@^20  @types/express@^4  @types/cors@^2
@types/bcryptjs@^2  @types/better-sqlite3@^9  @types/jsonwebtoken@^9
@types/multer@^1  @types/ws@^8  @types/uuid@^9  @types/nodemailer@^6
@types/jsdom@^21  @types/supertest@^7
```

`@types/node@^20` matches `.nvmrc` (Node 20) and `engines.node: ">=20 <21"`. Do not use
`@types/node@^24` even if the host runs Node 24 — CI and Docker are Node 20.

**1.2** Create `backend/api-service/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "strict": false
  },
  "include": ["*.js", "types.d.ts", "scripts/**/*.js", "scripts/**/*.mjs"],
  "exclude": ["node_modules", "vendor", "data", "uploads", "tests", "test-pdf.js"]
}
```

`vendor/` must stay excluded — it holds the 33,251-line `paged.polyfill.js`, already
ignored by `eslint.config.mjs:44` and `.llmignore`. `test-pdf.js` is a 67-line scratch
script; excluded now, deleted in a later cleanup if it is truly dead.

**1.3** Create `backend/api-service/types.d.ts`. This is the only non-`.js` source file the
spec adds:

```ts
import type { WebSocketServer, WebSocket } from 'ws';

declare global {
  namespace Express {
    interface Request {
      // Declared required, not optional, deliberately — see DX-09 §5.3.
      // authenticateToken (auth.js:32) sets this, and index.js:87-100 mounts it ahead of
      // every router that reads it. Mounting an authenticated router above that line
      // breaks the invariant, and the type system will NOT catch it.
      user: { user_id: string };
      wss?: WebSocketServer;
      clients?: Map<WebSocket, { userId: string; siteId: string }>;
      fileValidationError?: string;
    }
  }
}

export {};
```

**1.4** Add to `backend/api-service/package.json` scripts:
`"typecheck": "tsc --noEmit"`.

**1.5** Add to the root `package.json` scripts, alongside the existing `lint`:
`"typecheck": "npm run typecheck --prefix backend/api-service"`.

**Exit criterion:** `npm run typecheck` reports **21 errors**. If the count differs
materially, the config drifted from this spec — reconcile before continuing.

### Phase 2 — Clear the 21, add `tests/` (~2–3 hrs)

Fix the 21 remaining loose-tier errors. All are annotation work; section 8 catalogues every
one with its category and a suggested fix. **None require a behavior change.**

Then move `tests` out of `exclude` and into `include`, and clear the ~19 errors that
surfaces (5.4).

**Exit criterion:** `npm run typecheck` is clean with `tests/` in scope.

### Phase 3 — Turn on `strictNullChecks` (~2–3 hrs)

Set `"strictNullChecks": true` (keep `"strict": false`). Expect **27 errors**. This is the
tier that pays: it is what catches the `null`-shaped defects, of which the repo has a
recent example in `eedd7e6 fix: null-safe search to prevent crash on items with null names`.

**Exit criterion:** clean at `strictNullChecks`.

### Phase 4 — CI gate (~30 min)

Add a `typecheck` step to `.github/workflows/test.yml`, in the same job as lint. It needs
only `npm ci` and Node from `.nvmrc` — no Docker, unlike the backend test job in
`scripts/test-backend.sh`, because nothing native is loaded.

Because `test.yml` is already `workflow_call`-ed by `deploy.yml`, a type error blocks
deploys with no change to `deploy.yml`.

**Exit criterion:** a PR with a deliberate type error goes red.

### Phase 5 — Document (~20 min)

- `backend/api-service/AGENTS.md`: note that the backend is type-checked, that
  `npm run typecheck` must pass, and that `types.d.ts` is where request augmentations are
  declared.
- `AGENTS.md` root: add `typecheck` next to `lint` and `test` in the verification commands.

### Deliberately deferred

`noImplicitAny` (+250 errors, §5.1) and per-row `better-sqlite3` generics for the 79
`.prepare()` sites. If the latter is ever taken up, generate the row types from
`BASE_SCHEMA` in `db.js:17-120` rather than hand-writing them.

---

## 7) Risks

**R1 — `skipLibCheck: true` hides errors inside `@types` packages.** Accepted deliberately;
without it, mismatched community types in the dependency tree produce noise unrelated to
this codebase. The pinning discipline in 5.5 is what actually protects correctness here.

**R2 — Scope creep into refactoring.** The checker will surface code that is ugly but
working. `sync.js:30` is the canonical example (F7 in section 8): TypeScript rejects
`(a, b) => a - b` on `string` keys, but JS coerces numeric strings, so it is correct at
runtime and the sort is redundant anyway. **Fix it as an annotation or a minimal, obviously
safe edit; do not restructure `sync.js` under cover of this spec.** Sync changes carry
production incident history and belong in their own PR with their own review.

**R3 — A false sense of coverage.** `checkJs` on unannotated JS infers a great deal, but an
un-annotated function parameter is `any` under this tier, and `any` checks nothing. This
gate raises the floor; it does not make the backend type-safe. Do not let it justify
lighter review on `sync.js`.

**R4 — `@types` drift on dependency upgrades.** Bumping `express` to 5 without bumping
`@types/express` (or vice versa) yields confidently wrong types. Upgrade them in the same
commit, always.

**R5 — Editor/CI divergence.** VS Code will begin surfacing these errors in-editor as soon
as `tsconfig.json` lands, including in files an agent did not touch. Expect a noisier
editor between Phase 1 and Phase 3.

---

## 8) Appendix — the 21 Phase-2 errors, catalogued

Measured at the loose tier with `types.d.ts` in place. Distribution: `backup.js` 7,
`revision.js` 5, `sync.js` 3, `db.js` 2, and one each in `signup.js`, `pdf.js`,
`index.js`, `db-repair.js`.

| # | Category | Sites | Fix |
|---|---|---|---|
| F1 | `jwt.verify()` returns `string \| JwtPayload`; code reads `.user_id` / `.purpose` / `.userId` | `index.js:64`, `backup.js:704` ×2, `backup.js:707` | One narrowing helper, e.g. `assertJwtPayload()`, used at all four sites |
| F2 | Custom `Error` subclasses carrying extra props | `revision.js:396,402,414,423` (`httpStatus`); `backup.js:274,275` (`status`, `payload`) | Declare the error shapes as a JSDoc `@typedef`, or subclass `Error` properly |
| F3 | Optional destructured params inferred as required | `backup.js:738,791` (`onStage`), `revision.js:181` (`createdAt`) | Add `@param` JSDoc. **Not bugs** — `createdAt` is defaulted at `revision.js:49` |
| F4 | `db.js` constructor/shape mismatches | `db.js:740,773` | Inspect individually; `773` is a `Database` vs `DatabaseConstructor` confusion |
| F5 | Unvalidated external JSON | `signup.js:22` — `.success` read off `unknown` (Turnstile response) | Annotate the expected response shape. Worth a look on its own merits |
| F6 | **An existing JSDoc annotation is wrong** | `db-repair.js:40` — declared row type is not assignable from `unknown[]` | Correct the annotation. Direct evidence for §2.3 |
| F7 | Arithmetic on `string` (see R2) | `sync.js:30` | `Number(a) - Number(b)`. Runtime behavior is unchanged — JS already coerces |
| F8 | DOMPurify `DOMWindow` vs `WindowLike` | `pdf.js:38` | Known upstream friction between `@types/jsdom` and `dompurify`'s bundled types; a cast is acceptable |
| F9 | `req.id` read but never assigned anywhere in the codebase | `sync.js:351` | See note below |

**On F9 — worth a second look.** `sync.js:351` reads `req.id || req.get("x-request-id") ||
null` inside the `sync_crsqlite_merge_failure` incident log. Nothing in the backend ever
assigns `req.id`, so the first operand is permanently `undefined`. It degrades safely to
the header, so this is **not a live defect** — but it means `requestId` in that log line is
always `null` unless an upstream proxy sets `x-request-id`, and that is the exact structured
log `docs/runbooks/` tells an operator to grep during a sync incident. Either add the
request-id middleware the expression implies, or drop the dead operand. **Do it in a
separate PR** (R2).

### Honest note on what the baseline found

**The 21 errors contain no confirmed runtime bugs.** Each candidate was traced: F7 coerces
correctly, F3's `createdAt` is defaulted, F9 falls back safely. The current backend is, at
this tier, clean.

That is the correct expectation to set for whoever implements this, and it is an argument
*for* landing the gate cheaply rather than an argument against it: the value is preventing
the next shape mismatch in `sync.js`, not harvesting existing ones. A spec that promised a
pile of latent bugs would be overselling it.

---

## 9) Validation checklist

Paste into the PR description, per `.github/skills/feature-development/SKILL.md` Phase 8.

- [ ] `npm run typecheck` passes from the repo root and from `backend/api-service/`
- [ ] `npm run lint` still passes
- [ ] `npm run test:be` still passes (Docker path unaffected)
- [ ] `npm run test:fe` still passes
- [ ] `git diff --stat` shows **no changes** to `Dockerfile`, `Dockerfile.test`,
      `deploy.sh`, `docker-compose.yml`, `docker-compose.dev.yml`, `vitest.config.js`
- [ ] No `.js` file changed runtime behavior — every diff hunk is a comment, a JSDoc
      block, or a type-only edit
- [ ] `types.d.ts` retains the §5.3 rationale comment about mounting order
- [ ] `@types` ranges match the table in §5.5 (spot-check `@types/express` is 4.x, not 5.x)
- [ ] CI shows a `typecheck` step, and a deliberately-introduced type error turns it red
- [ ] `vendor/` is excluded — `npx tsc --noEmit --listFiles | grep vendor` returns nothing
- [ ] `backend/api-service/AGENTS.md` and root `AGENTS.md` mention `typecheck`
