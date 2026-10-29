# Odoo add-on (API)

Sends Documents to Odoo (Documents, Knowledge, CRM and Sales chatter), keeps folders, Documents
and spaces in sync with Knowledge, and reads sales orders into Documents.

- Spec: [`docs/specs/active/odoo-integration.md`](../../../../docs/specs/active/odoo-integration.md),
  sales order blocks in
  [`docs/specs/active/odoo-sales-order-blocks.md`](../../../../docs/specs/active/odoo-sales-order-blocks.md).
- How add-ons plug into core:
  [`docs/specs/active/addon-folders.md`](../../../../docs/specs/active/addon-folders.md).
- The app side lives in [`frontend/src/addons/odoo/`](../../../../frontend/src/addons/odoo/).

## Manifest (`index.js`)

| Field | What it is |
|---|---|
| `isOffered` | `ODOO_INTEGRATION_ENABLED=true` and an `ODOO_CREDENTIAL_ENCRYPTION_KEY` of 32+ characters (`connection.js`) |
| `onEnabled` / `onDisabled` | Resume / pause the user's syncs with reason `addon_disabled` |
| `routes` | `routes.js` (plus `saleOrderBlocks.js`), mounted at `/addons/odoo` behind the gate; paths are relative |
| `schema.user` | `odoo_connection`, `odoo_block_layouts` (`schema.js`) |
| `schema.content` | `odoo_links`, `odoo_defaults`, `odoo_syncs`, in user and space databases (`schema.js`) |
| `hooks.afterChangesApplied` | Debounced sync runs after a `/sync` push (`syncScheduler.js`) |
| `hooks.afterSyncRequest` | The daily reconcile check (`syncScheduler.js`) |
| `configWarnings` | The flag is on but the encryption key is missing or short |

## Files

| File | Role |
|---|---|
| `routes.js` | Connection, pickers, links, send, syncs |
| `client.js` | JSON-2 API client over `safeFetch.js`, error codes, app detection |
| `connection.js` | The stored connection, the address policy, the offer check |
| `documents.js`, `knowledge.js`, `articleImages.js`, `chatter.js` | One per destination |
| `links.js` | Send and sync bookkeeping (`odoo_links`, `odoo_defaults`) |
| `sync.js`, `syncScheduler.js`, `syncPdf.js` | Knowledge syncs: one run, when to run, the PDFs a sync files |
| `saleOrderBlocks.js` | Sales order search, field catalog, snapshots and saved layouts |
| `tests/` | Unit and integration tests; `tests/fakeOdoo.js` is the fake Odoo server |
