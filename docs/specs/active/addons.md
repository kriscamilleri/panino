# Add-ons — Spec

> External service integrations are **add-ons**: the operator offers one, each user switches it
> on, and it is off by default. One registry, one gate on the server, one Settings section.
> Odoo (`../active/odoo-integration.md`) is the first add-on; later integrations follow the same
> shape.
> Status: active (framework and Odoo adoption implemented 2026-10-27 on `feature/odoo-integration`)
> Created: 2026-10-27
> Last updated: 2026-10-29 — add-ons live in their own folders and plug into core through the
> manifest ([`addon-folders.md`](addon-folders.md))

---

## 1) Summary

An add-on is a feature that talks to a service outside Panino on the user's behalf. Today that
is the Odoo integration. An add-on has three independent states:

| State | Who sets it | Where it lives | What it means |
|---|---|---|---|
| **Offered** | The operator | Environment (the add-on's own flag and secrets) | The routes mount, the schema exists, and the add-on is listed under Settings → Add-ons |
| **Enabled** | The user, **off by default** | `addons` row in the user's database | The add-on's entry points appear, its routes accept the user's calls, and its background jobs run for them |
| **Connected** | The user | The add-on's own tables (`odoo_connection`) | Credentials are stored and the add-on can act |

Nothing an add-on adds to the product is visible until the user switches it on. Switching it off
hides it again and pauses its background work, but keeps everything it stored, so switching it
back on is instant. Removing credentials is the add-on's own **Disconnect**, as today.

## 2) Decisions (Kris, 2026-10-26)

| Question | Decision |
|---|---|
| Which features are add-ons | Every external service integration, starting with Odoo. Core features (sync, spaces, PDF, images) are not. |
| Default | Off for every user. An operator offering an add-on does not switch it on for anyone. |
| Off versus disconnected | Two switches. Off keeps the add-on's data and credentials and pauses its jobs. Disconnect removes credentials. |
| Who can switch | Each user, for their own account only. There is no space-level switch. |
| GitHub backup | Converted to an add-on on 2026-10-29 (`docs/specs/active/github-integration.md`). Principle: every integration with an outside service is an add-on. |
| Naming | **Add-ons** in the product. `addons` in code, tables and routes. |

## 3) Goals

1. One place in Settings, on desktop and phone, listing the add-ons the server offers, each with
   a switch that is off until the user turns it on.
2. An add-on that is off is absent from the product: no menu entries, no toolbar buttons, no
   sheets, no background jobs for that user.
3. One server-side gate that every add-on route sits behind, so no route can forget the check.
4. Adding a second add-on means registering a manifest and writing the add-on, not touching the
   Settings page, the store or the gate.

### Non-goals

- Space-level or operator-level enablement per user.
- Add-on marketplaces, third-party add-ons, or loading code at runtime. Add-ons ship with Panino.
- Per-add-on permissions finer than on/off.

---

## 4) User journey

**Settings → Add-ons.** A section listing every add-on the server offers: name, one line saying
what it does and what leaves Panino ("Sends Documents to your Odoo"), and a switch. Everything is
off the first time. When nothing is offered, the section says "No add-ons are available on this
server" (desktop) or is hidden (phone Settings list).

**Switching on** reveals the add-on's own card under the switch: for Odoo, the Connect form and,
once connected, the status, key expiry and syncs. Switching on never connects anything.

**Switching off** asks once: "Turn off Odoo? Your connection and what you sent are kept. Syncs
pause until you turn it back on." The card, and every entry point elsewhere in the product,
disappears. Nothing in the external service changes.

**Phone.** Settings has an Add-ons section with the same switches; an add-on's card is a row
under its switch (Odoo: "Odoo connection"), which opens the add-on's sheet.

---

## 5) Architecture

```text
Operator env ──▶ manifest.isOffered()
                        │
Client               Panino API                       Add-on
──────               ──────────                       ──────
addonsStore ◀─────── GET  /addons   (offered + enabled per user)
            ───────▶ PUT  /addons/:id/enabled  {enabled}
isActive('odoo') ──▶ /addons/odoo/… ──▶ requireAddon('odoo') ──▶ add-on routes
                                           404 when not offered
                                           403 addon_disabled when off for the caller
```

### Registry (`backend/api-service/addons/registry.js`)

Each add-on exports a manifest; the registry is the list of them:

```js
{
  id: 'odoo',                       // route prefix, table key, store key
  name: 'Odoo',
  description: 'Send Documents to your Odoo and keep folders mirrored in Knowledge.',
  isOffered: () => isOdooIntegrationEnabled(),   // the add-on's own env flag and secrets
  routes: odooRoutes,               // mounted at /addons/odoo
  onEnabled: async (userId) => {},  // resume paused work
  onDisabled: async (userId) => {}, // pause jobs; never delete
}
```

The registry exposes `offeredAddons()`, `isAddonActive(userId, id)` (offered **and** enabled)
and the `requireAddon(id)` middleware. Since 2026-10-29 each add-on lives in its own folder per
layer and core reaches it only through its manifest, which also declares its schema, hooks and
UI contribution points: see [`addon-folders.md`](addon-folders.md), which supersedes the
earlier "files may stay flat" note here.

### The gate

`requireAddon(id)` runs after auth on every route under `/addons/<id>`:

1. Not offered → `404 Not found`. The server does not reveal add-ons it does not offer, which is
   the behaviour the Odoo routes have today.
2. Offered, no `addons` row or `enabled = 0` for `req.user.user_id` → `403`
   `{ error: 'addon_disabled', message: 'Turn on Odoo in Settings → Add-ons first.' }`.
3. Otherwise `next()`.

The gate reads the caller's own row only. A space Document sent by an editor is gated on the
editor's switch; the space owner's switch does not matter.

### Background jobs

A job that runs on a user's behalf (an Odoo sync runs as `run_as`) checks
`isAddonActive(run_as, id)` before each run. When the add-on is off for that user the job pauses
with a reason the add-on defines (`addon_disabled` for Odoo syncs), and `onEnabled` resumes what
paused for that reason. Jobs never delete anything when an add-on is switched off.

### Frontend

- `store/addonsStore.js`: `addons` (the `GET /addons` list), `fetchAddons()`,
  `isActive(id)`, `setEnabled(id, enabled)`. Fetched after login and whenever Settings opens;
  held in memory only.
- `components/AddonsSection.vue` renders the list and switches on the desktop Settings page;
  `PhoneSettingsPage` renders the same list as its own **Add-ons** section (a section, not a
  sheet: it is one card and the phone Settings page already scrolls).
- Every entry point an add-on adds is guarded by `addonsStore.isActive(id)` and is absent, not
  disabled, when that is false. Since 2026-10-29 the core components in
  `components/addons/` do the guarding for every add-on ([`addon-folders.md`](addon-folders.md) §6).
- An add-on's components are imported lazily (`() => import(…)` in its manifest), so an add-on
  that is off costs nothing in the main bundle. That matters for a PWA.

---

## 6) Data

Server-only, in `USER_LOCAL_SCHEMA`: not a CRR, not in the frontend
`DB_SCHEMA`, never synced to browsers.

```sql
CREATE TABLE IF NOT EXISTS addons (
  addon_id TEXT PRIMARY KEY NOT NULL,   -- manifest id, e.g. 'odoo'
  enabled INTEGER NOT NULL DEFAULT 0,
  enabled_at TEXT,                      -- ISO 8601, last time it was switched on
  disabled_at TEXT                      -- ISO 8601, last time it was switched off
);
```

No row means off. An add-on's own tables are unchanged by the switch: `odoo_connection`,
`odoo_links`, `odoo_defaults` and `odoo_syncs` stay exactly as the Odoo spec defines them.

## 7) API

| Route | Who | Purpose |
|---|---|---|
| `GET /addons` | any user | `{ addons: [{ id, name, description, enabled, enabledAt }] }`, offered add-ons only |
| `PUT /addons/:id/enabled` | any user | `{ enabled: boolean }` → the updated entry. 404 for an id that is not offered. Runs `onEnabled` / `onDisabled`. The switch has its own path because an add-on's root (`PUT /addons/odoo`) belongs to the add-on. |
| `/addons/<id>/…` | per add-on | the add-on's own routes, all behind `requireAddon(id)` |

The switch is idempotent: switching on an add-on that is on does nothing and returns the entry.

### Security

- The offer is operator-only. A user cannot see or switch on an add-on the server does not offer.
- The switch is per account and read from `req.user.user_id`; nothing in the body names a user.
- Switching off never deletes secrets, links or external records. The add-on's Disconnect does
  that, and the UI says so on both buttons.
- `addon_disabled` is a closed error code like the Odoo ones; the message names the add-on and
  where to switch it on, nothing else.

---

## 8) Adopting Odoo

The Odoo integration (`../active/odoo-integration.md`) is built through Phase 2 with its own
availability check: the routes answer 404 when the operator flag is off, and the client treats a
404 from the status route as "unavailable". Moving it onto the framework is that spec's Phase 3:

- `odoo.js` exports the manifest; `isOdooIntegrationEnabled()` becomes its `isOffered`. The
  operator variables (`ODOO_INTEGRATION_ENABLED`, `ODOO_CREDENTIAL_ENCRYPTION_KEY`,
  `ODOO_ALLOWED_PRIVATE_HOSTS`) keep their names.
- Routes move from `/integrations/odoo/…` to `/addons/odoo/…`. Nothing is deployed with the flag
  on, so there is no compatibility cost.
- `odooStore.available` becomes `addonsStore.isActive('odoo')`; the status-route 404 check goes.
- The Settings → Tools → Odoo button on desktop and phone is replaced by the Add-ons section.
  The toolbar Tools → Odoo button and the phone Document menu entry stay, guarded by `isActive`.
- Users who connected Odoo on a development stack before this phase keep their connection and
  see it again as soon as they switch the add-on on.
- Syncs (Odoo Phase 9) pause with `addon_disabled` and resume on `onEnabled`.

## 9) Tests

- **Unit:** the registry lists only offered manifests; `requireAddon` answers 404, 403
  `addon_disabled` and `next()` for the three states; `addonsStore` derives `isActive` from
  offered and enabled and sends the `PUT`.
- **Integration (backend, Docker):** `GET /addons` omits an add-on whose flag is off; `PUT`
  switches on and off and is idempotent; with Odoo offered but off for the user, **every** route
  on the Odoo router answers 403 `addon_disabled` (the test walks the router's route table, so a
  new route cannot slip past the gate); switching on does not create a connection; switching off
  keeps `odoo_connection` and `odoo_links`; another user's switch has no effect.
- **Browser (phone and desktop):** the Add-ons section lists Odoo off; no Odoo entry appears in
  Settings, the toolbar or the Document menu; switching on reveals the card and the entries;
  switching off asks once, then removes them; the connection survives off and on.

## 10) Phases

1. **Framework and Odoo adoption.** ✅ Done 2026-10-27. `addons.js`, the `addons` table, `GET /addons` and `PUT /addons/:id/enabled`,
   `requireAddon`, `addonsStore`, `AddonsSection` on desktop and phone, the Odoo route rename and
   lazy loading, tests above. This is Odoo Phase 3 and ships before any further Odoo destination.
2. **Later add-ons** register a manifest. GitHub backup was the second (2026-10-29).

## 11) Open questions

None blocking.
