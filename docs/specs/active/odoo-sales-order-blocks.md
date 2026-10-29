# Odoo Sales Order Blocks — Spec

> Pull a sales order from Odoo into a Document as a table: the order's header values and its
> lines, with the values and columns the person picks. The data is stored in the Document as
> ordinary Markdown, so every output (Preview, PDF, phone, Knowledge, backups, space members)
> shows it with no change to any renderer, and a button pulls it again.
> Part of the Odoo add-on ([`odoo-integration.md`](odoo-integration.md),
> [`addons.md`](addons.md)): invisible until the person switches Odoo on.
> Status: active — implemented on `feature/odoo-sale-order-blocks` 2026-10-29
> Created: 2026-10-29
> Last updated: 2026-10-29 — files moved into the add-on folders ([`addon-folders.md`](addon-folders.md))

---

## 1) Summary

**Odoo data** (desktop Tools toolbar) or **Sales orders from Odoo** (phone Document menu) opens a
dialog that:

- lists the sales order blocks already in the Document, each with **Refresh** and **Edit**, and
  **Refresh all**;
- inserts a new block: search for a sales order, choose the **values** shown from the order
  (customer, dates, totals…) and the **columns** shown for its lines, in the order wanted, then
  **Insert**. Defaults follow Odoo's own quotation PDF.

A block is a snapshot. Inserting or refreshing reads the order from Odoo with the person's own
connection and writes it into the Document between two marker comments. Refresh overwrites the
block, the same rule as everything else Panino creates: Panino owns it, edits inside it are lost
on the next refresh.

## 2) Decisions (Kris, 2026-10-29)

| Question | Decision |
|---|---|
| Live or stored | **Stored snapshot.** A live block would need a render hook in the Preview, both export paths, the Knowledge send and the server's sync renderer; it would be empty offline and for any space member without their own Odoo connection. |
| Choosing what is shown | A dialog to pick and order the header values and the line columns, with sensible defaults |
| Refreshing | A button press: per block, or all blocks in the Document |
| Containment | The add-on stays self-contained: one backend module, one dialog, one pure utility, a few store calls, and an entry point beside each existing Odoo entry point. No change to rendering, schema or sync. |
| Quotation layouts (later the same day) | A block can be drawn from a **Markdown layout with placeholders** instead of the fixed tables. Layouts belong to the block and are picked in the Odoo data dialog (not Panino Document templates): starters, the person's saved layouts, or one written there. |

### Non-goals

- Live data, automatic or scheduled refresh.
- Writing anything to Odoo. The block only reads.
- Other models (invoices, opportunities, products…). The block format carries a `model` so they
  can follow without a migration.
- Fields of related records beyond their name (no `partner_id.email`).

## 3) User journeys

| # | Journey | Acceptance |
|---|---|---|
| U1 | Insert with defaults | Odoo data → Insert a sales order → search "S000" → pick S00020 → Insert. The Document gets a header table (reference, customer, dates, salesperson, status, totals) and a lines table (description, quantity, unit price, discount, taxes, amount) at the cursor. Preview and PDF show both tables. |
| U2 | Choose values and columns | In the dialog, remove Discount, add Delivered quantity, move Amount first, Insert. The tables follow that choice and order. |
| U3 | Refresh | Change the order in Odoo, then Odoo data → Refresh (or Refresh all). The block shows the new data and its "Updated" line the new time; text outside the block is untouched. |
| U4 | Edit | Edit on a block reopens the field choice with that block's values and columns; Update rewrites it. |
| U5 | Add-on off | With Odoo switched off no entry point shows, and the Document still shows the last snapshot as plain tables. |
| U6 | Space member without Odoo | Sees the tables. Refresh needs their own Odoo connection and says so. |
| U7 | Wrong Odoo | Refreshing a block whose order id now holds a different reference (another Odoo database) refuses and leaves the block alone. |

## 4) Block format

```markdown
<!-- odoo:sale.order {"v":1,"id":20,"ref":"S00020","fields":["partner_id","date_order"],"columns":["name","product_uom_qty","price_subtotal"]} -->
| Sales order | S00020 |
|---|---|
| Customer | YourCompany, Joel Willis |
| Order Date | 26 Sep 2026 |

| Description | Quantity | Subtotal |
|---|--:|--:|
| [FURN_6667] Acoustic Bloc Screens<br>Noise-reducing panels | 3 | $825.00 |
| **Services** | | |

*From Odoo, updated 29 Oct 2026, 14:05.*
<!-- /odoo:sale.order -->
```

- The opening comment holds the block's settings as JSON: `v`, the order `id`, its reference
  `ref` (checked on refresh, U7), `fields` (header values) and `columns` (line columns), each an
  ordered list of Odoo field names. HTML comments render as nothing in every output.
- The first header row is always the order reference, so the table has a real heading row.
- Section lines render bold in the first column; note lines italic. Line breaks in a cell become
  `<br>`.
- Numbers, money and dates are formatted in the inserting person's locale and time zone; money
  with the order's currency symbol and decimals.
- Every value from Odoo is escaped where it could take effect, and only there, so the Markdown
  stays readable: `<` always; `&` before something entity-like; the first `{` of `{{`; `_` where
  it could start emphasis (not in `FURN_6667`); `]` before `(`, `[` or `:`; `\`, `` ` ``, `*`,
  `|`, `~` always. So Odoo data can never add HTML, links, images, a table cell, a variable or a
  fake closing marker. The Preview still sanitizes as always.
- A block whose JSON does not parse is listed as damaged and never rewritten.

## 4a) Layouts

A layout is Markdown with placeholders (`frontend/src/addons/odoo/utils/saleOrderLayout.js`):

| Placeholder | Means |
|---|---|
| `{{order.<field>}}` | A value of the order |
| `{{#lines}} … {{/lines}}` | Repeated for each order line |
| `{{#product}}`, `{{#section}}`, `{{#note}}` … `{{/…}}` | Inside `{{#lines}}`: only for that kind of line. Without any of them, the body is for product lines and sections and notes are left out |
| `{{line.<field>}}` | Inside `{{#lines}}`: a value of the line; `line.name` is a section's or note's text |
| `{{odoo.updated}}`, `{{odoo.url}}` | When the block was read, and the order in Odoo (http(s) only) |

- Any other `{{ … }}` is left as written, so the Document's own variables work in a layout.
- A tag alone on its line takes the line with it, so a repeated table row keeps the table whole.
- The fields to read are the placeholders used; the server's allow-list still applies, and a
  field this Odoo lacks renders empty (the dialog says which).
- Odoo values are escaped as in §4, and a value cannot start a heading, list, quote or rule
  at the start of a line.
- A layout cannot contain an HTML comment, is at most 8000 characters, and must nest correctly;
  the dialog checks as it is typed and Insert stays off until it parses.

**The block carries its layout**, as written, in its own comment under the marker, so it reads
in the editor without escapes and can be edited there (the next refresh uses the edit):

```markdown
<!-- odoo:sale.order {"v":2,"id":19,"ref":"S00019"} -->
<!-- odoo:layout
## Quotation {{order.name}}
…
-->
…what the layout drew…
<!-- /odoo:sale.order -->
```

The layout comment is one HTML block (a comment runs to its `-->` line, blank lines included), so
nothing in it renders. Blocks first written with the layout inside the marker's JSON (`"layout"`)
are still read, and are rewritten in this form on their next refresh. Refresh redraws with it, so a space member without that saved layout refreshes the same way.
Marker `v: 1` (the table of chosen values and columns) is unchanged and still written by the
Table choice.

**Choosing a layout.** The dialog's Layout picker offers:

- Table (choose values and columns), with "Edit as Markdown" to turn the choice into a layout;
- starters: **Quotation** (heading, customer and dates, lines with units and taxes, totals
  table) and **Lines only**;
- the person's saved layouts;
- "This block's layout" when editing a layout block.

Saved layouts are per person, server-side in the add-on's own table
`odoo_block_layouts (id, model, name, body, created_at, updated_at)` in `USER_LOCAL_SCHEMA`
(never a CRR, never in the browser schema), at most 50, through
`GET/POST /addons/odoo/sale-order-layouts` and `PUT/DELETE …/:layoutId`, behind the add-on gate
and needing no Odoo connection. Deleting one leaves its text in the dialog and changes no block.

Visual styling (fonts, table borders, the PDF look) stays with Panino's named styles.

## 5) Architecture

```text
OdooDataBlockModal ──▶ odooStore ──▶ GET /addons/odoo/sale-orders?q=           (search)
        │                            GET /addons/odoo/sale-orders/fields        (catalog + defaults)
        │                            GET /addons/odoo/sale-orders/:id?fields=&columns=  (snapshot)
        │                                     │ requireAddon('odoo'), sender's connection
        │                                     ▼
        │                         saleOrderBlocks.js ──▶ fields_get, read sale.order,
        │                                                read sale.order.line, display names,
        │                                                res.currency
        ▼
utils/saleOrderBlock.js (pure: parse, format, build Markdown, insert/replace)
        ▼
editorStore.transformText()  (undo, draft, save, live session as any edit)
```

Paths are relative to the Odoo add-on's folders, `backend/api-service/addons/odoo/` (API) and
`frontend/src/addons/odoo/` (app).

| File | Role |
|---|---|
| API `saleOrderBlocks.js` | Field catalog (cached per Odoo database), defaults, reading and normalizing an order; registers its routes on the Odoo router |
| API `routes.js` | Two lines: import, and register the routes |
| API `schema.js` | `odoo_block_layouts` in the add-on's user schema |
| App `utils/saleOrderBlock.js` | Parse blocks, escape and format cells, build the Markdown, insert and replace in an editor state |
| App `utils/saleOrderLayout.js` | Layout parsing, validation, the fields a layout uses, rendering, starters, the table-as-layout conversion |
| App `store.js` | `searchSaleOrders`, `fetchSaleOrderFields`, `fetchSaleOrder` |
| App `components/OdooDataBlockModal.vue` | The dialog |
| App `manifest.js` | The `data` action (toolbar "Odoo data", phone "Sales orders from Odoo") and the `data` modal; core renders both through `AddonActions` and `AddonModalHost` |

Removing the feature is deleting the two new modules, the dialog, their tests, two lines in
`routes.js`, the table in `schema.js`, three store functions, and the `data` action and modal in
`manifest.js`. Documents keep their tables.

The marker comments survive only in the Markdown: DOMPurify drops HTML comments, so the Preview,
the PDF and Knowledge never carry the settings.

### The snapshot response

```json
{
  "order": { "id": 20, "name": "S00020", "url": "https://odoo.example.com/odoo/sale.order/20" },
  "fields": [{ "name": "partner_id", "label": "Customer", "cell": { "type": "text", "value": "…" } }],
  "columns": [{ "name": "price_subtotal", "label": "Subtotal", "type": "monetary" }],
  "lines": [{ "kind": "line", "cells": [{ "type": "monetary", "value": 825, "currency": { "symbol": "$", "position": "before", "decimals": 2 } }] },
            { "kind": "section", "text": "Services" }]
}
```

Cell types: `text` (char, text, selection label, many2one name, many2many names joined), `number`,
`monetary`, `date` (`YYYY-MM-DD`), `datetime` (ISO 8601 UTC), `boolean`; `null` when Odoo has no
value. Formatting is the client's job, so it uses the person's locale.

### Field catalog

`fields_get` on `sale.order` and `sale.order.line`, keeping the types above plus `many2many`,
and dropping `id`, `message_*`, `activity_*`, `access_*`, `website_message_*`, and `html` and
`binary` fields. Cached per Odoo database for an hour, like the file-field detection.

Defaults, filtered to the fields the database has:

- **Values:** `partner_id`, `date_order`, `validity_date`, `user_id`, `state`, `amount_untaxed`,
  `amount_tax`, `amount_total`.
- **Columns:** `name`, `product_uom_qty`, `price_unit`, `discount`, `tax_ids`, `price_subtotal`.

Verified against the local Odoo 19 Community and 20 Enterprise on 2026-10-29: both have every
default field with these names (`product_uom_id`, `tax_ids`; not `product_uom`, `tax_id`).

## 6) Security

- Every route sits behind `requireAddon('odoo')` on the Odoo router, so the router-walking gate
  test covers them.
- Requested field names are checked against the catalog (an allow-list from `fields_get`) and
  capped at 30 each; anything else is dropped. Binary and HTML fields are never read.
- The order id must be a positive integer. At most 500 lines and 200 related names per field are
  read; responses keep the client's 2 MB cap.
- Odoo's access rules are the person's own: an order their Odoo user cannot read answers
  `access_denied` or `record_gone`.
- Errors are the closed Odoo codes with fixed messages; nothing from Odoo's error body reaches
  the client.
- Odoo data is escaped before it enters the Document (§4).

## 7) Tests

- **Layouts:** `odooSaleOrderLayout.test.js` (parsing errors, rendering each line kind, hostile values in a layout, starters, table-as-layout, v2 blocks round-trip and refresh); layout cases in `odooDataBlockModal.test.js`; saved-layout routes in the backend integration test.
- **Backend unit:** catalog filtering and defaults; field allow-listing; normalizing each field
  type; section and note lines; many2many names; currency.
- **Backend integration (fake Odoo):** search, catalog, snapshot; unknown fields dropped;
  missing order `record_gone`; Sales not installed `missing_app`; not connected; the gate test
  sees the new routes.
- **Frontend unit:** parse (several blocks, damaged JSON, unclosed block); escaping (pipes, HTML,
  a fake closing marker, newlines); formatting; building; insert at cursor; replace one block
  keeps the rest of the text; the dialog's insert and refresh.
- **Browser:** U1–U4 against the local Odoo 19 on desktop and phone width. Done 2026-10-29
  (headless, 1280 and 375): see the agent log.

## 8) Open items

- Many2many beyond 200 ids per field are cut off.
- Other models (invoice, opportunity) reuse the format with another `model` in the marker.
- Saved layouts are personal; sharing them with a space is not done.
