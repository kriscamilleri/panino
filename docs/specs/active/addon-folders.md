# Add-on Folders — Spec

> Each add-on lives in one folder per layer (`backend/api-service/addons/<id>/` and
> `frontend/src/addons/<id>/`), and core code never names an add-on. Core gains a small set of
> extension points (routes, schema, hooks, UI contribution points) that add-ons plug into
> through their manifest. Builds on the add-ons framework (`../active/addons.md`); Odoo
> (`../active/odoo-integration.md`) is the add-on that moves.
> Status: active — implemented on `feature/odoo-sale-order-blocks` 2026-10-29 (§11)
> Created: 2026-10-29
> Last updated: 2026-10-29

---

## 1) Summary

The add-ons framework decides whether an add-on is offered, enabled and connected. It does not
yet give an add-on a way into the rest of the product, so core files reach out to Odoo by name:

| Layer | Core file | What it does with Odoo today |
|---|---|---|
| Backend | `index.js` | Imports and mounts `odooRoutes`; prints an Odoo config warning |
| Backend | `sync.js` | Imports `scheduleSyncRunsAfterChanges` and `triggerDailyReconcile` from `odooSyncScheduler.js` |
| Backend | `db.js` | Defines `odoo_connection`, `odoo_block_layouts` and `ODOO_LINK_SCHEMA` |
| Frontend | `HomePage.vue` | Imports and mounts `OdooSendModal`, `OdooDataBlockModal` |
| Frontend | `SubMenuBar.vue` | Two hard-coded Odoo toolbar buttons |
| Frontend | `phone/DocumentMenuSheet.vue` | Two hard-coded Odoo menu rows and their modals |
| Frontend | `SettingsPage.vue` | `#odoo` slot content, `OdooConnectionModal`, a ref into `OdooSyncsCard` |
| Frontend | `PhoneSettingsPage.vue` | `addon.id === 'odoo'` branches, `OdooConnectionModal` |
| Frontend | `SpacesPage.vue` | `OdooSyncsCard` and an Odoo-specific hint |
| Frontend | `store/uiStore.js` | `showOdooSendModal`, `showOdooDataModal` and their open/close actions |

That breaks goal 4 of the add-ons spec ("adding a second add-on means registering a manifest
and writing the add-on, not touching the Settings page, the store or the gate"). Each new Odoo
phase also adds more of these references.

This spec closes the gap: the manifest grows to declare everything core currently hard-codes,
core iterates over registered manifests, and the Odoo files move into their own folders.
Behaviour, routes, tables and the wire contract are unchanged.

## 2) Decisions (Kris, 2026-10-29)

| Question | Decision |
|---|---|
| Test ids | Derived from the manifest (`<surface>-addon-<addonId>-<actionId>`). Odoo's existing ids are renamed, not preserved (§6.2). |
| Add-on docs | Specs stay in `docs/specs/` (repo convention). Each add-on folder gets a short `README.md` pointing to its spec (§4). |
| Folder layout | One folder **per layer**: `backend/api-service/addons/<id>/` and `frontend/src/addons/<id>/`. Not a single top-level `addons/<id>/` (see §9). |
| Discovery | A static list of imports, one line per add-on. No filesystem scanning, no runtime loading. This matches the add-ons non-goal: add-ons ship with Panino. |
| Dependency direction | Add-ons may import core modules. Core never imports an add-on module, only the registry. Add-ons never import each other. Enforced by ESLint (§7). |
| Generic helpers | Stay in core even when Odoo is their only consumer today: `secrets.js`, `safeFetch.js`, the PDF low-priority lane, `shared/`, `useDocumentPdfRequest.js`. |
| Operator config | The `ODOO_*` variables stay in `docker-compose*.yml`. They are operator config, not code. |
| Behaviour | No change. Same routes (`/addons/odoo/…`), same table names, same error codes, same lazy loading. |

## 3) Goals

1. No core file (outside `addons/` folders, registries and docs) imports or names an add-on.
2. Adding an add-on means adding one folder per layer and one import line per registry.
3. Removing an add-on means deleting its folders and its import lines; the build and the test
   suite still pass.
4. The `requireAddon` gate is applied by the registry when mounting, so an add-on route cannot
   be mounted outside it.
5. An add-on that is off still costs nothing in the main frontend bundle.

### Non-goals

- A top-level `addons/<id>/` holding both layers (§9).
- A separate `package.json` or lockfile per add-on.
- Third-party add-ons, runtime discovery or loading code at runtime.
- Converting GitHub backup into an add-on.
- Any change to what Odoo does, its API or its data.

---

## 4) Layout

```text
backend/api-service/
  addons/
    registry.js            ← was addons.js (registerAddon, requireAddon, /addons routes, mounting, hooks)
    index.js               ← import './odoo/index.js'   (one line per add-on)
    odoo/
      index.js             ← the manifest + registerAddon(...)   (was the top of odoo.js)
      routes.js            ← was odoo.js, routes only
      client.js            ← was odooClient.js
      connection.js        ← was odooConnection.js, plus isOdooIntegrationEnabled()
      chatter.js, documents.js, knowledge.js, articleImages.js, links.js,
      sync.js, syncPdf.js, syncScheduler.js, saleOrderBlocks.js
      schema.js            ← the Odoo SQL moved out of db.js
      README.md
      tests/
        fakeOdoo.js
        unit/…  integration/…    (addon.test.js is the add-ons framework test as Odoo sees it)

frontend/src/
  addons/
    registry.js            ← static list of frontend manifests
    odoo/
      manifest.js          ← contributions (§6); imports components lazily only
      store.js             ← odooStore.js (store id 'odooStore' unchanged)
      components/          ← Odoo*.vue, plus OdooSettingsCard.vue (new, §6.3)
      utils/               ← odooArticle, odooConnection, odooSaleOrderBlock, odooSaleOrderLayout
      composables/         ← useDocumentArticle.js
      tests/               ← was frontend/tests/unit/odoo*.test.js
      README.md
  components/addons/       ← AddonActions.vue, AddonModalHost.vue, AddonCard.vue (core, generic)
```

File names inside an add-on folder drop the `odoo` prefix, since the folder already says it.
Files move with `git mv` so history follows them.

Each add-on folder, in both layers, has a short `README.md`: what the add-on does, a link to its
spec in `docs/specs/`, and the manifest fields and contribution points it uses. Specs
themselves stay in `docs/specs/`.

Dev tooling (`docker-compose.odoo.yml`, `scripts/odoo-dev.sh`,
`scripts/odoo-enterprise.Dockerfile`) stays where it is. Moving it under
`backend/api-service/` would copy it into the production image, and it is not app code.

---

## 5) Backend

### 5.1 Manifest

Today's manifest is `{ id, name, description, isOffered, onEnabled, onDisabled }`. It grows:

```js
registerAddon({
  id: 'odoo',
  name: 'Odoo',
  description: '…',
  isOffered: isOdooIntegrationEnabled,
  onEnabled, onDisabled,                   // unchanged

  routes: odooRoutes,                      // paths relative to /addons/odoo
  schema: {
    user: ODOO_USER_SCHEMA,                // user databases only (odoo_connection, odoo_block_layouts)
    content: ODOO_LINK_SCHEMA,             // every content database, user and space
  },
  hooks: {
    afterChangesApplied: (dbKey) => scheduleSyncRunsAfterChanges(dbKey),
    afterSyncRequest: (dbKey) => triggerDailyReconcile(dbKey),
  },
  configWarnings: () => [/* strings, logged once at startup */],
});
```

Every new field is optional, so a minimal add-on is still just the original six fields.

### 5.2 Routes

The registry mounts every add-on in one place, from `index.js`:

```js
for (const addon of listAddons()) {
  if (addon.routes) app.use(`/addons/${addon.id}`, requireAddon(addon.id), addon.routes);
}
```

Odoo route paths change from `'/addons/odoo/check'` to `'/check'`. The public URLs do not
change. The line `odooRoutes.use('/addons/odoo', requireAddon('odoo'))` goes away: the gate now
lives in the mount, so a route cannot be added without it.

The integration test in the add-ons spec that walks the router's route table and expects 403
`addon_disabled` on every route keeps working. It now walks the routes relative to the mount.

**Public routes** (added for GitHub backup, 2026-10-29). A browser coming back from the
service, such as an OAuth callback, carries no Panino token, so it cannot pass `requireAddon`.
A manifest's `publicRoutes` router is mounted by `mountAddonPublicRoutes(app)` at the same
`/addons/<id>` prefix, **before** `authenticateToken`, behind the offered check only (404 when
not offered). Each public route must prove who the caller is itself (GitHub's: the signed,
expiring OAuth `state`) and then check `isAddonEnabled(userId, id)`. Requests for the private
routes pass through the public router unmatched and still meet sign-in and the gate.

### 5.3 Schema

`db.js` cannot import the registry, because the registry imports `db.js`. Instead `db.js`
exports a small hook, and the registry calls it:

```js
// db.js
const addonSchemas = new Map();   // by add-on id, so registering twice does not run the SQL twice
export function registerAddonSchema(addonId, { user = '', content = '' }) { … }

// in initializeContentDb, after BASE_SCHEMA and the kind-specific schema:
for (const schema of addonSchemas.values()) {
  if (schema.content) db.exec(schema.content);
  if (kind === 'user' && schema.user) db.exec(schema.user);
}
```

- `schema.upgrade(db, kind)` (optional, added for GitHub backup) runs after the add-on's SQL on
  every content database, for what plain SQL cannot do idempotently: adding a column to a table
  an older release created, or a one-time data step. It must be idempotent and check `kind`
  itself.
- Add-on tables are created whenever the add-on is **registered**, offered or not, as they are
  today. Turning the operator flag on then needs no migration.
- Statements must be idempotent (`CREATE TABLE IF NOT EXISTS`, guarded `ALTER`s), like core
  schema. Existing development databases need nothing.
- Add-on tables are server-only. They are never CRRs and never appear in the frontend
  `DB_SCHEMA` or `CRR_TABLES`. `registerAddonSchema` rejects SQL that calls `crsql_as_crr`.
- All add-ons must register before the first database opens. `index.js` imports
  `addons/index.js` at the top, so this holds in the app, and integration tests get it through
  `createTestApp()`. A unit test that opens databases without the app gets no add-on tables; if
  it needs them, it imports the add-on's `index.js`.
- `tests/setup.js` must **not** import the add-ons. Tried during implementation: the Odoo routes
  pull in `spaces.js`, `pdf.js` and others, so they loaded against the real `db.js` before
  `tests/unit/spaces.test.js` could apply its `vi.mock` of it, and that file failed.

### 5.4 Hooks

Core runs named hooks through one function in the registry:

```js
export function runAddonHooks(name, ...args)   // registered + offered add-ons only
```

| Hook | Called from | When |
|---|---|---|
| `afterChangesApplied(dbKey)` | `sync.js` | After `applyChanges` commits a push |
| `afterSyncRequest(dbKey)` | `sync.js` | After a `/sync` request answered (Odoo's daily reconcile, GitHub's daily backup) |

- Hooks run synchronously and must return quickly. Anything slow is the add-on's job to defer,
  as the Odoo scheduler already does with its debounce timers.
- A throwing hook is caught and logged with the add-on id. It never fails the sync request.
- Core does not check per-user enablement before running a hook. The add-on decides per user,
  as the Odoo scheduler already does with `isAddonActive(run_as, 'odoo')`.
- New hooks are added to this table when an add-on needs one. A hook is named after the moment
  in core, not after what an add-on does with it.

### 5.5 Startup

`index.js` logs each string from `configWarnings()` with an `[addons:<id>]` prefix. That
replaces the Odoo-specific `ODOO_INTEGRATION_ENABLED` warning.

---

## 6) Frontend

### 6.1 Manifest

```js
// frontend/src/addons/odoo/manifest.js
import { Plug, Send, Sheet } from 'lucide-vue-next';

export default {
  id: 'odoo',
  actions: [                                   // toolbar Tools and phone Document menu
    {
      id: 'send',
      icon: Send,
      label: 'Odoo',                           // toolbar
      menuLabel: 'Send to Odoo',               // phone Document menu
      requires: ['online', 'document'],
      hint: 'Send this document to Odoo',
      modal: 'send',
    },
    { id: 'data', icon: Sheet, label: 'Odoo data', menuLabel: 'Sales orders from Odoo',
      requires: ['online', 'document'], hint: 'Insert or refresh sales orders from Odoo', modal: 'data' },
  ],
  modals: {
    send: () => import('./components/OdooSendModal.vue'),
    data: () => import('./components/OdooDataBlockModal.vue'),
  },
  settingsCard: {
    component: () => import('./components/OdooSettingsCard.vue'),   // gets `layout`
  },
  spaceCard: {
    component: () => import('./components/OdooSyncsCard.vue'),
    props: ({ spaceId }) => ({ dbKey: `space:${spaceId}`, spaceMode: true }),
    whenOff: 'Turn on the Odoo add-on in Settings → Add-ons to keep this space in sync with Odoo Knowledge.',
  },
};
```

A manifest imports components only through `() => import(…)`, so the static registry pulls
nothing from an add-on into the main bundle except its manifest and icons. Icons come from
`lucide-vue-next`, which is already in the main bundle.

`frontend/src/addons/registry.js`:

```js
import odoo from './odoo/manifest.js';
export const ADDON_MANIFESTS = [odoo];
```

The server stays the source of truth for whether an add-on is offered and enabled
(`addonsStore`). The frontend manifest only says how it appears. A manifest with no matching
offered add-on renders nothing.

### 6.2 Contribution points

| Point | Rendered by | Core component | Replaces |
|---|---|---|---|
| `actions` (toolbar) | `SubMenuBar.vue` | `<AddonActions surface="toolbar" />` | The two Odoo `BaseButton`s |
| `actions` (phone menu) | `phone/DocumentMenuSheet.vue` | `<AddonActions surface="menu" />` | The two Odoo `ph-row`s |
| `modals` (desktop) | `HomePage.vue`, desktop branch | `<AddonModalHost />` | The `OdooSendModal`, `OdooDataBlockModal` mounts in `HomePage` |
| `modals` (phone) | `phone/DocumentMenuSheet.vue` | `<AddonModalHost />` | The sheet's own `OdooSendModal`, `OdooDataBlockModal` mounts |
| `settingsCard` | `AddonsSection.vue`, `PhoneSettingsPage.vue` | `<AddonCard :addon-id point="settingsCard" layout="desktop" \| "phone" />` | The `#odoo` slot, the `addon.id === 'odoo'` branches, both `OdooConnectionModal` mounts |
| `spaceCard` | `SpacesPage.vue` | `<AddonCard :addon-id point="spaceCard" :context="{ spaceId }" />`, one per manifest with a `spaceCard` | `OdooSyncsCard` and its hint |

Rules for the core components:

- An action or card renders only when `addonsStore.isActive(id)`. It is **absent**, not
  disabled, when the add-on is off (add-ons spec §5). The one exception is `spaceCard.whenOff`:
  it shows when the add-on is offered but off, as the hint does today.
- **Returns from an outside service** (an OAuth callback) land on
  `/settings?addon=<id>&addonResult=…&addonMessage=…`. The add-on's settings card reads and
  clears them while the add-on is on; `useAddonReturn()` (both Settings pages) shows the
  message and clears them while it is off, when the card is absent.
- An action shows on both surfaces unless its optional `surfaces` lists one (`['toolbar']` or
  `['menu']`). GitHub backup's action is toolbar-only: it is not about the open Document, so it
  stays out of the phone Document menu, and phones reach it from its settings card.
- `requires` is computed by core from one context: `online` comes from `syncStore.isOnline`,
  and `document` means a Document is selected. Core disables the action and builds the tooltip
  ("Needs an internet connection", "Select a document first") or the "(needs a connection)"
  suffix the same way for every add-on. The add-on only supplies `hint`, the tooltip when the
  action is available. This replaces Odoo's own wording ("Sending to Odoo requires an internet
  connection", …) with the shared one.
- Actions open modals through a generic UI state: `ui.openAddonModal(addonId, modalId)`,
  `ui.closeAddonModal()` and `ui.addonModal` (`{ addonId, modalId } | null`). These replace the
  four Odoo entries in `uiStore`. At most one add-on modal is open at a time.
- `AddonModalHost` mounts every modal of every add-on that is on (each through
  `defineAsyncComponent`) and binds `show` to `ui.addonModal`, with `@close` calling
  `ui.closeAddonModal()`. That is how the Odoo modals were hosted before (mounted while the
  add-on is on, `show` toggled), so they keep their state between openings and their
  `watch(show)` loaders still fire. Their code loads once the add-on is on, not at startup.
- `AddonCard` puts `settings-addon-<id>` or `space-addon-<id>` (`-hint` for `whenOff`) on the
  card's root; it overrides a test id on the card's own root element.
- Test ids are derived as `<surface>-addon-<addonId>-<actionId>`, for example
  `submenu-tools-addon-odoo-send` and `phone-menu-addon-odoo-data`. Odoo's existing ids
  (`submenu-tools-odoo`, `submenu-tools-odoo-data`, `phone-menu-odoo`, `phone-menu-odoo-data`)
  are renamed in the same change, along with every test and browser script that uses them. Ids
  inside an add-on's own components (`odoo-send-*`, `odoo-data-*`, …) are the add-on's business
  and do not change.

### 6.2.1 Where the modal host is mounted

Checked against the code on 2026-10-29:

- `HomePage.vue` renders either `<PhoneShell v-if="isPhone">` or the desktop layout
  (`v-else`). The Odoo modals in `HomePage` sit in the desktop branch only, so a single host
  there would never mount on a phone.
- The phone editor always renders inside `HomePage`: `PhoneEditor` is only imported there, in
  the `PhoneShell` branch. `DocumentMenuSheet` is only rendered by `PhoneEditor`.
- On a phone the Odoo modals are rendered **inside** `DocumentMenuSheet`, within the
  `BottomSheet`'s `v-if="open"` content. The sheet stays open underneath (sheet z-index 45,
  `BaseModal` z-index 50), and the back gesture, which closes the sheet through the `?sheet=`
  query (`useSheetRoute`), takes the modal with it.

So there are two hosts, in the places the modals live today:

1. `HomePage.vue`, desktop branch.
2. `DocumentMenuSheet.vue`, inside the `BottomSheet`.

They can never both be mounted: the sheet exists only in the `PhoneShell` branch, and the two
`HomePage` branches are `v-if`/`v-else`. This keeps today's phone behaviour exactly: the modal
stacks over the open sheet, and the back gesture closes both.

One fix comes with it. Today the sheet's `sendingToOdoo` and `openingOdooData` flags survive a
back gesture, so reopening the sheet shows the modal again. With the shared `ui.addonModal`
state, `DocumentMenuSheet` calls `ui.closeAddonModal()` when it closes, so a closed sheet never
leaves an add-on modal pending.

Placing one host at `PhoneShell` level instead was rejected: the back gesture would close the
sheet but leave the modal open over the editor, which is a behaviour change.

### 6.3 Settings card

Today `SettingsPage` and `PhoneSettingsPage` each own `showOdoo`, mount `OdooConnectionModal`,
and (desktop only) reach into `OdooSyncsCard` through a ref to reload it after the connection
changes. All of that moves into a new `OdooSettingsCard.vue`, which takes a
`layout: 'desktop' | 'phone'` prop and renders:

- desktop: the "Odoo connection" button, `OdooKeyNotice` and `OdooSyncsCard`;
- phone: the "Odoo connection" row, the notice and the syncs card, styled with `ph-` classes.

The card owns its connection modal and reloads its own syncs card on close. `AddonsSection`
drops its per-add-on named slot and renders `<AddonCard>` instead. A settings page no longer
knows any add-on exists.

### 6.4 Store

`odooStore.js` moves to `addons/odoo/store.js` with the same Pinia id (`'odooStore'`), so
existing state and devtools names are unchanged. `addonsStore` stays core and unchanged.

---

## 7) Enforcement

The point of this spec is that core stays clean as add-ons grow, so the boundary is checked
mechanically.

A small local ESLint rule, `panino/addon-boundaries` in `eslint.config.mjs`, applied to the
backend and frontend sources:

| Files | May not import |
|---|---|
| Core (outside the add-ons folders) | Anything inside `addons/<id>/`, either layer |
| `addons/<a>/**` | Anything inside `addons/<b>/` for any other add-on |
| `addons/registry.js`, `addons/index.js` | (no limit: they are the one place that lists add-ons) |

`no-restricted-imports` was the first idea, but it matches the import string, not the resolved
path, so `../../addons/odoo/x.js` from a test and an add-on reaching a sibling with `../other/`
are hard to catch at every depth. The local rule resolves relative and `@/` specifiers against
the importing file instead. It checks `import`, `import()`, `export … from` and `vi.mock(…)`.
`npm run lint` already runs in CI, so the rule is enforced from then on.

---

## 8) Tests

- **Backend registry (`tests/integration/addonsRegistry.test.js`, throwaway `probe` add-on):** mounting applies `requireAddon` (404 when not offered,
  403 `addon_disabled` when off, `next()` when on) for an add-on registered with routes;
  `registerAddonSchema` runs `content` SQL on user and space databases and `user` SQL on user
  databases only; it rejects `crsql_as_crr`; `runAddonHooks` skips add-ons that are not
  offered, and a throwing hook is logged and does not throw.
  It also registers a failing hook and checks `/sync` still answers 200, and that a hook name
  core does not know is refused.
- **Backend integration:** everything under `addons/odoo/tests/` passes unchanged apart from
  import paths and the router walk in `addon.test.js`, which now prefixes the mount. A push to
  `/sync` still schedules an Odoo sync run (the existing `syncs.test.js` coverage) now through
  `afterChangesApplied`.
- **Frontend unit:** `AddonActions` renders nothing for an add-on that is off, renders the
  manifest's actions when on, and disables them per `requires`; `AddonModalHost` opens and
  closes the requested modal and keeps it mounted between openings; `AddonCard` renders
  `whenOff` only when the add-on is offered but off (`tests/unit/addonContributions.test.js`,
  throwaway `probe` manifest). Closing `DocumentMenuSheet` clears `ui.addonModal`
  (`tests/unit/documentMenuSheetAddons.test.js`). The existing Odoo tests move to
  `addons/odoo/tests/` and pass.
- **Bundle:** after `vite build`, the entry chunk contains no Odoo component code (check that
  `OdooSendModal`'s chunk is separate and not imported from the entry). This guards goal 5.
- **Removal check (manual, once):** on a scratch branch, remove the two registry lines and run
  `npm run lint`, `npm test` and `vite build`. All pass. This proves goal 3.
- **Browser (desktop and phone):** with Odoo off, there are no Odoo entries in the toolbar,
  Document menu, Settings or Spaces. With it on, every entry appears, opens the right modal and
  works as before. On a phone, the modal opens over the Document menu sheet, and the back
  gesture closes both; reopening the sheet does not bring the modal back. Connecting or
  disconnecting refreshes the syncs card on both Settings pages.
- **Clean-core check:** `grep -rni odoo` over backend and frontend sources outside `addons/`
  finds only comments that mention Odoo as an example (for example the PDF low-priority lane)
  and no imports.

---

## 9) Alternatives considered

**One top-level `addons/<id>/` with `backend/` and `frontend/` inside.** Rejected for now:

- Node resolves bare imports (`express`, `better-sqlite3`, `jsdom`) by walking up from the
  importing file, and ESM ignores `NODE_PATH`. Backend add-on code outside
  `backend/api-service/` would not find its dependencies without a per-add-on `package.json`
  and lockfile (more lockfiles to drift, see the `.nvmrc` note in `AGENTS.md`), Dockerfile
  copying that makes the container layout differ from the repo, or injecting every dependency.
- The frontend needs a Vite alias, `resolve.dedupe` for `vue` and `pinia` (two copies of Vue
  break reactivity), an extra Tailwind `content` path, and new vitest and ESLint globs.
- Both Dockerfiles need new `COPY` lines.
- Its main benefit, dropping in an add-on built elsewhere, is a non-goal.

`shared/` shows the cross-folder pattern can work, but it needed its own package and lockfile.
Revisit if add-ons are ever distributed separately. With the extension points from this spec
in place, that later move is mostly mechanical: the manifests and contribution points stay the
same and only the paths change.

**Leave files flat and only add extension points.** That would remove the coupling but leave
twelve `odoo*.js` files among core modules in `backend/api-service/` and eleven Odoo files
across `frontend/src`. The folder move is cheap with `git mv`, so it is included.

---

## 10) Open questions

None blocking. Test ids, the phone modal host and docs location were settled on 2026-10-29
(§2, §6.2.1).

---

## 11) Phases

Do this after the sales-order-blocks work is committed and **before** `feature/odoo-integration`
merges to `main`. Odoo is not deployed, so nothing needs a compatibility shim. Each phase
leaves the suite green and changes no behaviour.

1. **Backend.** ✅ Done 2026-10-29. `addons/registry.js` (from `addons.js`), `addons/index.js`, manifest `routes`,
   `schema`, `hooks` and `configWarnings`; `registerAddonSchema` in `db.js`; `runAddonHooks` in
   `sync.js`; mounting loop in `index.js`; `git mv` of the Odoo modules and tests; route paths
   made relative. Verify: `npm run test:be`, `npm run lint`.
2. **Frontend.** ✅ Done 2026-10-29. `addons/registry.js`, the Odoo manifest, `AddonActions`, `AddonModalHost`,
   `AddonCard`, `OdooSettingsCard`; generic modal state in `uiStore`; the two modal hosts
   (§6.2.1); the seven core files switched to contribution points; test id renames; `git mv` of
   the Odoo components, store, utils, composable and tests. Verify: `npm run test:fe`,
   `npm run lint`, `vite build` bundle check, browser on desktop and phone (§8).
3. **Enforcement and docs.** ✅ Done 2026-10-29. ESLint boundary rule (§7); update `../active/addons.md` (§5 says
   "the manifest is what makes something an add-on, not a folder", which this replaces with
   the folder layout and extension points), `backend/api-service/AGENTS.md`,
   `frontend/AGENTS.md` and the `AGENTS.md` file-routing table; per-add-on `README.md`; agent
   log.
