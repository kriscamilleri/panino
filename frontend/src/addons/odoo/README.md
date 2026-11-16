# Odoo add-on (app)

The app side of the Odoo add-on: sending a Document to Odoo, the connection and syncs in
Settings and on the Spaces page, and sales order blocks.

- Spec: [`docs/specs/shipped/odoo-integration.md`](../../../../docs/specs/shipped/odoo-integration.md),
  sales order blocks in
  [`docs/specs/shipped/odoo-sales-order-blocks.md`](../../../../docs/specs/shipped/odoo-sales-order-blocks.md).
- How add-ons plug into core:
  [`docs/specs/shipped/addon-folders.md`](../../../../docs/specs/shipped/addon-folders.md).
- The API side lives in [`backend/api-service/addons/odoo/`](../../../../backend/api-service/addons/odoo/).

## Manifest (`manifest.js`)

| Contribution point | What Odoo puts there |
|---|---|
| `actions` | **send** ("Odoo" / "Send to Odoo") and **data** ("Odoo data" / "Sales orders from Odoo"), both need a connection and a selected Document; **overview** ("Odoo overview", desktop Add-ons menu only) opens the overview page |
| `modals` | `send` → `OdooSendModal`, `data` → `OdooDataBlockModal` |
| `pages` | `overview` → `OdooOverviewPage` at `#/addons/odoo/overview` ([spec](../../../../docs/specs/shipped/odoo-overview.md)) |
| `settingsCard` | `OdooSettingsCard` (desktop and phone): connection, Overview, key notice, syncs |
| `spaceCard` | `OdooSyncsCard` in space mode (with Open overview for that space), with a hint while the add-on is off |

Components load only through `() => import(…)` in the manifest, so nothing here is in the
main bundle except the manifest itself.

## Files

| File | Role |
|---|---|
| `store.js` | `useOdooStore` (Pinia id `odooStore`): connection, pickers, links, send, overview, send updates, syncs, sales orders |
| `components/` | The modals and cards above, plus `OdooConnectionModal` and `OdooKeyNotice` |
| `utils/connection.js` | Display helpers: key expiry, app labels, host |
| `utils/article.js`, `composables/useDocumentArticle.js` | A Document's Knowledge article HTML |
| `utils/saleOrderBlock.js`, `utils/saleOrderLayout.js` | Sales order blocks in Markdown and their layouts |
| `tests/` | Unit and component tests |
