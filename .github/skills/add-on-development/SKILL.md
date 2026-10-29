---
name: add-on-development
description: "Use when adding a new Panino add-on (an integration with an outside service, such as Odoo, GitLab or a calendar) or extending an existing one: the backend and frontend folders, the two manifests, routes behind the add-on gate, server-only tables, sync hooks, UI contribution points (toolbar and phone-menu actions, modals, Settings and space cards), tests and docs. Also covers when and how to add a new extension point to core. Use alongside feature-development for the branch, review and PR steps."
---

# Add-on Development

Add-ons are integrations with services outside Panino. The operator offers one, each user
switches it on, and it is off by default. Each add-on lives in **one folder per layer**, and
core reaches it only through the add-on registries.

- Framework (offered / enabled / connected, the gate, Settings → Add-ons):
  [`docs/specs/active/addons.md`](../../../docs/specs/active/addons.md)
- Folder layout and extension points:
  [`docs/specs/active/addon-folders.md`](../../../docs/specs/active/addon-folders.md)
- Worked example: Odoo, in `backend/api-service/addons/odoo/` and `frontend/src/addons/odoo/`
  (read both `README.md` files first)

## Scope

- A new add-on, or new features inside an existing add-on's folders
- A new extension point in core (a hook or a UI contribution point) that an add-on needs

## Non-Scope

- Core features (sync, spaces, PDF, images). These are not add-ons.
- The branch, spec review, security review and PR. Follow `feature-development` for those, and
  use this skill for the add-on-specific parts.

---

## Rules

1. **Core never imports an add-on, and add-ons never import each other.** Only
   `addons/registry.js` and `addons/index.js` (backend) and `src/addons/registry.js` (frontend)
   name add-ons. ESLint `panino/addon-boundaries` fails the build otherwise. Add-ons may import
   core modules (`../../db.js`, `@/store/syncStore`, …).
2. **Both manifests use the same `id`**: lower-case letters, digits and dashes. It is the route
   prefix (`/addons/<id>`), the `addons` table key and the frontend lookup key.
3. **Off by default, absent when off.** Never show an entry point, run a job or call the service
   for a user who has not switched the add-on on. The registry and the core components
   enforce this for routes and UI. Background jobs must check `isAddonActive(userId, id)`
   themselves.
4. **Switching off never deletes.** `onDisabled` pauses work. Removing credentials is the
   add-on's own Disconnect.
5. **Security, as in core** (`AGENTS.md` §4):
   - Authorize from `req.user.user_id`, never from the request body.
   - Use parameterized SQL.
   - Encrypt stored credentials with `secrets.js`, using the add-on's own key from the
     environment.
   - Make outbound HTTP calls through `safeFetch.js`, with a private-address policy.
   - Return closed error codes with fixed messages, never raw upstream errors.
6. **Add-on tables are server-only**: not CRRs, not in the frontend `DB_SCHEMA`, and idempotent
   (`CREATE TABLE IF NOT EXISTS`).
7. **Product language**: "Add-ons" in the UI, "Document" not "file".

---

## Step 1: Spec

Write `docs/specs/proposed/<id>-integration.md`. Cover what leaves Panino and under whose
identity, the operator variables, the tables, the routes and their error codes, and the entry
points. Also list any extension point core does not have yet (step 5). Get it approved before
building.

## Step 2: Backend, in `backend/api-service/addons/<id>/`

| File | Contents |
|---|---|
| `index.js` | The manifest and `registerAddon(...)`. Keep it small: it wires the add-on into core. |
| `routes.js` | `express.Router()` with paths **relative** (`'/'`, `'/things/:id'`). The registry mounts it at `/addons/<id>` behind `requireAddon(id)`, so do not add the prefix or the gate yourself. |
| `schema.js` | SQL strings: `user` (user databases only) and/or `content` (user and space databases). |
| `connection.js`, … | The add-on's own modules. Drop the id prefix from file names, since the folder says it. |
| `README.md` | What it does, a spec link, the manifest fields used, a file map. |
| `tests/unit/`, `tests/integration/` | Tests. A fake upstream server goes in `tests/` (see Odoo's `tests/fakeOdoo.js`). |

```js
// addons/<id>/index.js
import { registerAddon } from '../registry.js';
registerAddon({
  id, name, description,                // name and description show in Settings → Add-ons
  isOffered: () => …,                   // operator env flag and secrets, nothing per-user
  onEnabled(userId) {}, onDisabled(userId) {},
  routes,                               // optional
  schema: { user: '…', content: '…' },  // optional
  hooks: { afterChangesApplied(dbKey) {}, afterSyncRequest(dbKey) {} }, // optional
  configWarnings: () => [],             // optional: logged at startup, e.g. a missing key
});
```

Hooks run synchronously from `/sync` for every **offered** add-on, whatever the user's switch
says. Return quickly and defer slow work, as Odoo's `syncScheduler.js` debounces. A throwing
hook is logged and never fails the sync.

Register the add-on with one line in `backend/api-service/addons/index.js`:
`import './<id>/index.js';`

## Step 3: Frontend, in `frontend/src/addons/<id>/`

| File | Contents |
|---|---|
| `manifest.js` | Where the add-on appears (below). Icons from `lucide-vue-next`. Components only through `() => import(…)`. |
| `store.js` | The add-on's Pinia store, if it needs one. |
| `components/` | Modals take a `show` prop and emit `close`. A settings card takes `layout: 'desktop' \| 'phone'` and owns its own dialogs. |
| `utils/`, `composables/`, `tests/`, `README.md` | As needed. |

```js
export default Object.freeze({
  id,
  actions: [{ id, icon, label, menuLabel, hint, requires: ['online', 'document'], modal }],
  modals: { <modalId>: () => import('./components/…Modal.vue') },
  settingsCard: { component: () => import('./components/…SettingsCard.vue') },
  spaceCard: { component, props: ({ spaceId }) => ({ … }), whenOff: '…' },
});
```

| Point | Shows up in | Notes |
|---|---|---|
| `actions` | Desktop toolbar Tools group, phone Document menu | Core disables per `requires` and writes the "offline" / "select a document" wording; `hint` is the tooltip when available |
| `modals` | Desktop `HomePage`, phone Document menu sheet | Mounted while the add-on is on; `show` follows `ui.addonModal` |
| `settingsCard` | Under the switch in Settings, desktop and phone | |
| `spaceCard` | Spaces page, for editors | `whenOff` shows while offered but off |

Register the manifest in `frontend/src/addons/registry.js`: one import, plus one entry in
`ADDON_MANIFESTS`.

Test ids are derived by core: `submenu-tools-addon-<id>-<action>`,
`phone-menu-addon-<id>-<action>`, `settings-addon-<id>`, `space-addon-<id>` (`-hint`). Ids
inside your own components are yours; prefix them with the add-on id.

## Step 4: Outside the folders

- Operator variables in `docker-compose.yml` and `docker-compose.dev.yml`, under the add-on's own
  prefix (`<ID>_ADDON_ENABLED`, `<ID>_CREDENTIAL_ENCRYPTION_KEY`, …). A local dev instance of the
  service goes in its own `docker-compose.<id>.yml` and `scripts/`, not in the add-on folder.
  The backend folder is copied into the production image.
- A line for the add-on in `backend/api-service/AGENTS.md` and `frontend/AGENTS.md`.

## Step 5: Only if core lacks what you need

Add an extension point to core, named after the **moment in core**, not after the add-on:

- **Backend hook:** add the name to `ADDON_HOOKS` in `addons/registry.js`, call
  `runAddonHooks('<name>', …)` at that moment in core, and add it to the hook table in
  `addon-folders.md` §5.4. Not available yet: a startup hook (for jobs that must run from
  boot) and per-Document lifecycle hooks.
- **UI point:** a new manifest key, rendered by a component in
  `frontend/src/components/addons/`. It must render nothing while the add-on is off, and it is
  tested with a throwaway manifest (see `tests/unit/addonContributions.test.js`). Document it
  in `addon-folders.md` §6.2 and the frontend handbook.

A core change goes through review like any other. Keep it generic enough that a second add-on
could use it.

---

## Tests

Required for every add-on:

- **The gate on every route.** Copy the router walk in
  `backend/api-service/addons/odoo/tests/integration/addon.test.js`. It lists every route on
  the add-on's router and expects 403 `addon_disabled` until the user switches the add-on on,
  so a new route cannot slip past.
- **Offered vs not:** `GET /addons` lists the add-on only when the operator flag is set.
- **Off keeps data:** switching off leaves the add-on's tables, and `onDisabled` pauses jobs.
- **Upstream errors** map to closed codes, tested against a fake server, never the real service
  in CI.
- **Frontend:** the store, components and manifest-driven entry points. Mock
  `@/addons/registry` only in core tests; an add-on's own tests use its real files.

Backend integration tests get the add-ons through `createTestApp()`. Do **not** import add-ons
from `tests/setup.js`: that loads core modules before other test files can `vi.mock` them.

## Verify

```bash
npm run lint      # includes panino/addon-boundaries
npm run test:be   # Docker; add-on tests run from addons/<id>/tests/
npm run test:fe
cd frontend && npx vite build --outDir /tmp/…   # the add-on's components in their own chunks, not main-*.js
```

- **Removal check, once:** comment out the add-on's line in both registries. `npm run lint`,
  the core tests (`npx vitest run --dir tests` in the backend image, `npm run test:fe`) and the
  build must still pass.
- **Browser, desktop and phone:** off means no entry points anywhere. On means every entry
  point works, and a phone modal opens over the Document menu and closes with it. Switching
  off removes everything again. The dev API runs plain `node index.js`, so restart
  `panino-api-service-1` after adding backend files.
- Record it all in an agent log (`AGENTS.md` §1).
