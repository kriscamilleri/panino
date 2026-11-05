# Odoo sales order blocks

- Agent: Claude Code (Opus 5.5)
- Start: 2026-10-29, approximately 09:00
- Status: Implemented and verified locally; not committed

## Objective

Extend the Odoo add-on to pull a sales order (header values and lines) into a Document as a
table, with the shown values and columns chosen in a dialog (sensible defaults) and a button to
refresh. Keep the add-on self-contained so it is easy to switch off or remove.

## Progress

- Kris chose a **stored snapshot** over a live block, with a dialog for choosing values and
  columns and a refresh button. A live block would have needed a render hook in the Preview, both
  export paths, the Knowledge send and the server's sync renderer, and would be empty offline and
  for space members without their own connection.
- Read `sale.order` and `sale.order.line` `fields_get` and sample records from the local Odoo 19
  Community (`:8019`) and Odoo 20 Enterprise (`:8020`). Both use `product_uom_id`, `tax_ids`,
  `price_subtotal` and `display_type` ∈ {`line_section`, `line_subsection`, `line_note`};
  descriptions contain newlines; many2many fields come back as bare ids, so names are read
  separately.
- Spec: `docs/specs/active/odoo-sales-order-blocks.md`.
- The add-ons gate test walks `odooRoutes.stack` for layers with a `.route`, so the new routes
  are registered directly on that router (via `registerSaleOrderBlockRoutes(odooRoutes, …)`), not
  on a nested router the test would not see.
- `BaseModal` does not teleport and the toolbar (`SubMenuBar`) unmounts when its menu changes, so
  the desktop dialog is hosted in `HomePage` through a `uiStore` flag, like the send dialog.

## Changes Made

| File | Change |
|---|---|
| `backend/api-service/odooSaleOrderBlocks.js` (new) | Field catalog from `fields_get` (cached per Odoo database), defaults, allow-listing of requested fields, typed cells, reading order + lines + many2many names + currencies; `GET /addons/odoo/sale-orders`, `…/fields`, `…/:id` |
| `backend/api-service/odoo.js` | Import and register the routes after the gate (2 lines) |
| `backend/api-service/tests/fakeOdoo.js` | Sales fields, order lines (with section, note and hostile text), currencies, tax and tag names |
| `frontend/src/utils/odooSaleOrderBlock.js` (new) | Find blocks, escape cells, format cells, build the Markdown, insert after the cursor's line, replace a block only if unchanged |
| `frontend/src/components/OdooDataBlockModal.vue` (new) | List/refresh/edit blocks, search orders, choose and order values and columns |
| `frontend/src/store/odooStore.js` | `searchSaleOrders`, `fetchSaleOrderFields`, `fetchSaleOrder` |
| `frontend/src/components/SubMenuBar.vue`, `phone/DocumentMenuSheet.vue` | Entry points behind `addonsStore.isActive('odoo')` |
| `frontend/src/pages/HomePage.vue`, `frontend/src/store/uiStore.js` | Host the desktop dialog |
| `backend/api-service/AGENTS.md`, `frontend/AGENTS.md` | Module map entries |

## Tests

- `./scripts/test-backend.sh` new unit (12) and integration (10) tests, plus `addons` and
  `odooChatter`: 46 passed. Full `npm run test:be`: 50 files, 677 passed.
- Frontend `odooSaleOrderBlock.test.js` (25, including hostile Odoo values rendered through the
  shared renderer and variable substitution) and `odooDataBlockModal.test.js` (7). Full
  `npm run test:fe`: 79 files, 978 passed. `npm run lint`: clean.
- Browser, headless Puppeteer against the dev stack (API restarted to load the routes) and the
  local Odoo 19, throwaway account `user-A`:
  - 1280×900: new Document → Tools → Odoo data → search S00020 → defaults → Insert. The block
    went after the cursor's paragraph and the text around it was kept. Edit added Customer
    Reference. After changing `client_order_ref` in Odoo, Refresh replaced the value and left
    exactly one block. The Preview showed 2 tables and 13 rows.
  - 375×812: Document options → Sales orders from Odoo → list → Refresh all picked up a second
    Odoo change, the editor being in Preview mode. Page `scrollWidth` 375.
  - Console: only `GET /spaces` 404 (shared spaces off in dev) and the harness's `about:blank`
    `localStorage` errors.
  - The test order's `client_order_ref` was reset to empty afterwards.
- DOMPurify drops HTML comments, so the marker settings never reach the Preview, PDF or Knowledge
  HTML.

## Open Items / Notes

- Not committed: Kris to review. The branch `feature/odoo-sale-order-blocks` was cut from
  `feature/odoo-integration`, where the add-on lives (not yet on `main`).
- A wide lines table (six columns) overflows a narrow Preview pane on desktop and phone; that is
  the Preview's general table styling, not specific to these blocks.
- Many2many fields show at most 200 related names per field; orders show at most 500 lines (the
  block says so).
- "Open in Odoo" uses the connection's base URL, so on the dev stack it is the container address
  `http://odoo:8069`.

## Follow-up: quotation layouts (same day)

Kris asked for a way to amend the quotation's layout, perhaps with templates. Decided: layouts
belong to the order block and are chosen in the Odoo data dialog; they are Markdown with
placeholders (spec §4a).

- `frontend/src/utils/odooSaleOrderLayout.js` (new): parse/validate, `layoutFields`,
  `renderLayout`, starters (Quotation, Lines only), `tableLayout`.
- `odooSaleOrderBlock.js`: marker `v: 2` carries the layout; `v: 1` unchanged.
- `OdooDataBlockModal.vue`: Layout picker, Markdown editor with insert-a-value pickers, live
  validation, save / save as new / delete.
- Backend: `odoo_block_layouts` in `USER_LOCAL_SCHEMA` (`db.js`), layout routes in
  `odooSaleOrderBlocks.js`; `odooStore` gains `fetchLayouts`, `saveLayout`, `deleteLayout`.
- Tests: frontend 80 files / 1009 passed; lint clean; backend block + addons tests 24 passed
  (full suite below).
- Browser (Claude in Chrome, demo account `user-A`, local Odoo 19): edited the S00020 block,
  switched it to the Quotation layout, added the customer to the heading, Update. The Preview
  showed the heading, customer and dates, lines with units, and the totals table.
- **Unexplained, not reproduced:** in the first demo, a refresh that set a line's quantity
  to 30 was gone after a later reload; the Document showed the inserted version. Repeating the
  same sequence (refresh, close, go Home, reload) twice afterwards kept the refresh both times.
  The tab had stayed open while Vite hot-swapped `odooStore` and the dialog underneath it (the
  same stale state made Edit fail with `fetchLayouts is not a function` until a reload). Worth
  watching for; no fix made.
- The Recent Documents card snippet shows the marker comment's JSON as text
  (`utils/markdownSnippet.js` does not strip HTML comments). Not changed: core code.

## Follow-up: no escapes in the editor (same day)

Kris asked to remove the escaped characters from the editor.

- A layout block now keeps `{"v":2,"id","ref"}` in the marker and the layout as written in a
  `<!-- odoo:layout … -->` comment under it; older blocks with the layout in the JSON are read and
  rewritten on refresh (`odooSaleOrderBlock.js` `blockConfig`, `LAYOUT_SECTION`).
- `escapeCell` escapes only what could take effect (spec §4); `[FURN_6667] Chair (Black)` now
  stays as is. All injection cases still pass; new cases for each rule and for the layout comment.
- Frontend: 80 files / 1014 passed; lint clean.
- Browser: Refresh all on the demo Document rewrote both blocks in the readable form. The first
  attempt still wrote the old form because the tab ran a cached `OdooDataBlockModal.vue` from an
  earlier hot reload; a hard reload (ctrl+shift+r) fixed it. Dev-server caching only, but it fits
  the earlier unexplained lost refresh, which also happened in a tab that had been hot-reloaded.
