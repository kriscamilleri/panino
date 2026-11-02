# Odoo Overview — Spec

> One place to see and update everything a person has sent to Odoo or keeps in sync with it,
> across their own Documents and their spaces. Plus two smaller changes that make repeat sends
> cheaper: an **Update** mode for the Send dialog and **Refresh all** for sales order blocks.
> Builds on [`odoo-integration.md`](../active/odoo-integration.md) and
> [`odoo-sales-order-blocks.md`](../active/odoo-sales-order-blocks.md).
> Status: proposed. Phase 2 (Update mode) implemented on `feature/addons-menu`, 2026-11-01;
> Phases 0 and 1 (add-on pages, the overview, Send updates) on the same branch, 2026-11-02;
> Phase 3 (Refresh all) not started.
> Created: 2026-11-01
> Last updated: 2026-11-01

---

## 1) Summary

Today every Odoo dialog works on **one Document**. Where a Document went and when it was last
sent shows only inside that Document's Send dialog. Syncs are split between Settings (personal)
and the Spaces page (each space). Past 20–30 Documents, a person has no way to answer "what
changed since I sent it?" or "what failed?" without opening each one.

This spec adds:

1. **Odoo overview** (Phase 1): a page listing every Document that has a record in Odoo, opened
   from the Add-ons menu. It opens filtered to what needs attention, can send updates for several
   Documents at once, and holds the syncs.
2. **Update mode** (Phase 2): the Send dialog opens as a short summary with one **Send update**
   button when the Document is already in Odoo.
3. **Refresh all** (Phase 3): one button refreshes every sales order block in a Document.

Nothing here adds a destination, a setting or a new kind of record in Odoo.

## 2) Decisions (Kris, 2026-11-01)

| Question | Decision |
|---|---|
| Should the overview include space Documents that other members sent? | Yes. A space shares its `odoo_links`, so the overview shows them, with who sent them last. |
| Spec first? | Yes. This spec covers Phase 1; Phase 2 starts while it is reviewed. |
| A page or a wide dialog? (2026-11-02) | A page. Add-ons gain a `pages` contribution point for it ([`addon-folders.md`](../active/addon-folders.md) §6.2.5). |

## 3) Goals

- See every Document in Odoo in one list, across My Notes and every space the person belongs to.
- Find what needs attention without reading every row: changed since sent, sync failures,
  paused syncs.
- Send updates for several Documents in one step.
- See and run every sync in one place.
- Repeat sends from the Send dialog take one click.

## Non-Goals

- Badges in the Documents tree or on Home cards. They would need a new core extension point and
  put Odoo state in front of people who are only writing. Revisit once the overview is used.
- Creating records in bulk. Send updates only updates records Panino already made; a first send
  stays in the Send dialog, where the person picks the folder, parent or record.
- Bulk posts to opportunities and sales orders. Sending again posts a "replaced" note on the
  customer's record (`chatter.js`), so it stays a deliberate one-by-one action.
- Reading what changed in Odoo. Sync stays one-way.
- Search across Odoo records. The list filters by Document name only.

## 4) User journeys

**A. "What needs updating?"** Kris opens **Add-ons → Odoo overview**. The list opens on
**Needs attention** and shows three rows: two Documents changed since they were sent, and one
sync with a failed Document. Kris ticks the two Documents and presses **Send updates**. Each row
shows a spinner, then "Sent just now". The filter count drops to 1.

**B. A failed sync.** The remaining row reads "Sync failed: Odoo user can't update this article".
**Retry** runs the sync again (Sync now). If it fails again, the message stays.

**C. A space colleague sent it.** In the **Writers** space, Sam sent "Q3 proposal" to Knowledge
yesterday. Kris sees it with "by Sam". Kris is an editor, so **Send update** is offered. (Spaces
have only owners and editors today; `canSend` is false for a role that may not send, should a
read-only role arrive.)

**D. Already sent, one Document.** Kris presses **Add-ons → Odoo** on "Q3 proposal". The dialog
reads "In Knowledge and Documents, last sent 2 days ago by Sam", with **Send update** and a
**Change where it goes** link. One click sends it.

**E. Phone.** Settings → Add-ons → Odoo has an **Overview** button. It opens the same page at
phone width: the same filter and list, one Document per row, with **Send update** per row and
no ticking.

## 5) The overview

### Where it opens

It is a page at `#/addons/odoo/overview`, through the add-on `pages` point, in the shared page
shell (top bar with Back, as Images and Spaces).

- **Desktop:** a new action in the Add-ons menu, **Odoo overview** (`page: 'overview'`,
  `requires: ['online']`, toolbar only, no Document needed), next to **Odoo** and **Odoo data**.
- **Phone:** an **Overview** button on the Odoo Settings card. The phone Document menu does not
  get it, since that menu is about one Document.
- The Odoo Settings card and the Spaces page card each get an **Open overview** link. The Spaces
  page card opens it filtered to that space (`?where=space:<id>`).

### Layout

```text
┌ ← Back   Odoo ──────────────────────── odoo.example.com ─┐
│ [Needs attention 3] [All 41]   Where: [All ▾]  [Search…] │
│                                                          │
│ ☐ Q3 proposal     Writers   Knowledge · Documents        │
│                   Changed since sent · 2 days ago, Sam   │
│                                     Open ▾  Send update  │
│ ☐ Price list      My Notes  Documents                    │
│                   Changed since sent · 3 weeks ago       │
│ ─ Syncs ───────────────────────────────────────────────  │
│   Writers (whole space) → Knowledge   Failed: 1 of 18    │
│     Onboarding — Odoo user can't update this article     │
│                                       Retry   ⋯          │
│                                                          │
│ 2 selected                              [Send updates]   │
└──────────────────────────────────────────────────────────┘
```

- **Filter tabs:** **Needs attention** (default) and **All**, each with a count. With nothing to
  attend to, the default tab reads "Everything is up to date" and shows the All count as a link.
- **Where:** All, My Notes, or one space. Only places with at least one record are listed.
- **Search:** filters rows by Document title, on the client.
- **Rows:** one per Document, not per link. The second line gives the state and the last send:
  when and by whom ("you" for the caller).
- **Open ▾:** one entry per record in Odoo ("Knowledge article", "Documents PDF",
  "S00042 internal note"), opening in a new tab (`target="_blank" rel="noopener noreferrer"`).
  With one record, it is a plain **Open in Odoo** link.
- **Clicking the title** opens the Document in Panino and closes the overview.
- **Syncs section:** every sync in My Notes and the spaces, with the status line and the actions
  the cards have today (Sync now, Take over, Remove). Each failure is listed by Document name,
  not cut off after three. Syncs with nothing to report are listed under **All** only.
- **Sorting:** Needs attention first by state (failed, paused, changed), then last sent, oldest
  first. All: last sent, newest first.
- The list loads in one request and shows up to 500 Documents. Past that, it says so and asks the
  person to narrow it with **Where**. There is no pagination.

### Row states

| State | When | In Needs attention | Actions |
|---|---|---|---|
| **Changed since sent** | the Document's content differs from what was last sent (§6) on a Documents or Knowledge record | yes | Send update |
| **Up to date** | sent, unchanged | no | Tick and Send updates (desktop), or the Document's Send dialog |
| **Kept in sync** | its Knowledge record belongs to an active sync | no | none on the row; the sync's actions |
| **Sync failed** | the covering sync's last run lists this Document in its failures | yes | Retry (runs the sync) |
| **Sync paused** | the covering sync is paused | yes | Take over, or what the pause reason needs (reconnect) |
| **Deleted in Panino** | the record's Document no longer exists | no, All only | Open in Odoo |
| **Another Odoo** | sent to an Odoo other than the caller's connection | no, All only | Open in Odoo |

A Document with several records takes the most urgent state. A row whose only record is an
internal note on an opportunity or sales order is never **Changed since sent**: it shows
"Sent to S00042" and **Open**, and the Send dialog is the way to post again.

**Send update** and the tick box show only when the caller can send it: their own Documents, or a
space where they are owner or editor, on the same Odoo, and online.

### Send updates

**Send updates** sends each selected Document again to its existing Documents and Knowledge
records, one Document at a time, in list order. It never creates a record and never posts to an
opportunity or sales order. Each row shows its own result. A failure on one does not stop the
rest. At the end, a toast reads "Sent 5 of 6. 1 failed." and the failed row keeps its message.

Rendering happens on the server, with the renderer sync already uses
(`@panino/content-merge/markdown-render` and `syncPdf.js`). Today's Send dialog renders in the
browser from the selected Document only. Rendering six Documents in the browser would mean
loading each one and its styles, and the server renderer already produces the same output
(odoo-integration.md §11, "Server-side rendering").

The server renders the copy it holds, so edits not yet synced from this browser are not
included. Before it sends, the overview runs `syncStore.sync(dbKey)` for each database in the
selection and saves the open editor's pending edits first. If the sync fails or takes longer
than 10 seconds, it says "Your latest changes haven't reached the server yet" and sends nothing.

Limits: at most 25 Documents per press, one press at a time per person (`409 busy`), and each
press counts as one send against the existing rate limit (10 per minute). Counting each Document
would have made a 25-Document press fail after ten. With more selected, the button reads
"Send updates (first 25)".

## 6) Changed since sent

Comparing `notes.updated_at` with `last_sent_at` is not reliable: pinning a Document moves
`updated_at` (docStore), and client clocks drift. Instead, each manual send stores a hash of the
Document's content as the server holds it:

- New column `odoo_links.sent_hash TEXT`: SHA-256 of the note's `title` and `content` at send
  time. Manual send and Send updates set it. Sync keeps using `content_hash` and leaves
  `sent_hash` alone.
- **Changed since sent** = the current hash differs from `sent_hash`.
- Links without `sent_hash` (sent before this change) fall back to
  `updated_at > last_sent_at`. A false "changed" goes away with the next send.
- The column goes into `ODOO_CONTENT_SCHEMA` for new databases, and the add-on's
  `schema.upgrade` adds it with `ALTER TABLE … ADD COLUMN` where it is missing. The table is not
  a CRR, so no `crsql_begin_alter` is needed, and it stays server-only.

Known edge: if a send included edits that had not reached the server yet, the stored hash is of
the older content, and the row shows **Changed** once the edits arrive. Sending again clears it.
The wait in §5 makes this rare.

## 7) API

All under `/addons/odoo`, behind auth and the add-on gate.

| Route | Who | Purpose |
|---|---|---|
| `GET /addons/odoo/overview` | any user with the add-on on | Every Document with a record, across the caller's user database and every active space they belong to. Also the syncs of each. |
| `POST /addons/odoo/resend` | owner of `user:`; space owner or editor | `{dbKey, noteIds: string[]}` (1–25): send each again to its existing Documents and Knowledge records, rendered on the server. Answers `{results: {[noteId]: {ok, documents?, knowledge?, error?, message?}}}` |

`GET /overview` answers:

```js
{
  odooHost: 'https://odoo.example.com' | null,   // the caller's connection
  truncated: false, total: 41,
  places: [{ dbKey, name, role }],               // 'My Notes' for the user database
  documents: [{
    dbKey, placeName, noteId, title,             // title null when the Document is gone
    state: 'changed' | 'current' | 'synced' | 'sync_failed' | 'sync_paused' | 'deleted' | 'other_odoo',
    canSend: boolean,
    lastSentAt, lastSentBy, lastSentByMe,        // lastSentBy: name, null when it was the caller
    records: [{ destination, key, label, sameOdoo, url, syncId }],
    failure: { error, message } | null,          // from the covering sync's last run
  }],
  syncs: [ /* GET /syncs payload, plus dbKey, placeName, canEdit */ ],
}
```

- One read per database: `odoo_links` joined to `notes` on `source_id` (left join, so deleted
  Documents show), `source_type = 'note'` only. Folder links belong to syncs and are shown there.
- Spaces come from `listSpacesForUser` when shared spaces are enabled. A space the caller has
  left is not read.
- The 500-row cap is applied after sorting, across all places.
- `POST /resend` reuses the `/send` code path per destination, with the server-built PDF request
  and article HTML instead of the client's. A Document under a sync gets
  `knowledge: {ok: false, error: 'synced'}`, as `/send` does today. A Document with no Documents
  or Knowledge record gets `{ok: false, error: 'not_sent'}`.
- Error codes, messages and logging follow odoo-integration.md §6 and §9. No new codes beyond
  `not_sent`.

### Security

- Authorization is from `req.user.user_id` only. `dbKey` in `/resend` goes through
  `documentDatabase(…, { forSending: true })`, like `/send`.
- `/overview` is read-only, returns no key and no raw Odoo errors, and names other members only
  by display name, as `/links` does.
- `/resend` writes only through existing links, so the "only Panino's own records" rule (§6 of
  the integration spec) holds unchanged.
- A body cap, the 25-Document cap and the rate limit bound the server rendering cost. Resends run
  one at a time per user; a second `/resend` while one runs answers `409 busy`.

## 8) Send dialog: Update mode (Phase 2)

When `GET /links` returns a Documents or Knowledge record on the caller's Odoo, the dialog opens
in **Update** mode:

```text
┌ Send to Odoo ──────────────────────────────┐
│ In Knowledge and Documents                 │
│ Last sent 2 days ago by Sam                │
│ Open in Odoo ▾                             │
│                                            │
│ Change where it goes        [Send update]  │
└────────────────────────────────────────────┘
```

- **Send update** sends to the existing Documents and Knowledge records only, through `/send` as
  today (rendered in the browser). It does not post to opportunities or sales orders.
- **Change where it goes** shows today's full form, with the current destinations ticked. Its
  state is not remembered; the next open starts in Update mode again.
- A Document whose Knowledge record is kept in sync shows "Kept in sync with Knowledge" instead
  and offers **Send update** only when it also has a Documents record.
- A Document with only internal notes, or none, opens on today's form.
- No backend change, apart from `/send` storing `sent_hash` (§6).

## 9) Refresh all sales orders (Phase 3)

The sales orders dialog gets **Refresh all** when the Document has more than one block. It
refreshes each block through the existing per-block path, one at a time, and reports
"Refreshed 4 of 4" or names the blocks that failed. No backend change.

## 10) Phases

| Phase | Contents | Size |
|---|---|---|
| 1a | `sent_hash` column, set by `/send`; `GET /overview`; backend tests | S |
| 0 | Core: the add-on `pages` point (route, `AddonPage.vue`, page actions) | S, done 2026-11-02 |
| 1b | Overview page, its Add-ons menu action and the Overview button (phone Settings card); filters, rows, Open menu, syncs section reusing the sync card's actions; Settings and Spaces cards link to it | M |
| 1c | `POST /resend` with server rendering; Send updates; the sync before sending | M |
| 2 | Send dialog Update mode | S |
| 3 | Refresh all | S |

Phase 2 can ship before Phase 1.

## 11) Tests

- **Backend:** `/overview` with links in the user database and a space, another member's send
  with their name, a space the caller left (absent); each state, including deleted, another
  Odoo, sync failed and paused; the hash fallback for old links; pinning a Document does not
  make it **Changed**; the 500 cap. `/resend`: updates only existing records and never creates;
  skips chatter; `synced` and `not_sent`; another person's database 404; 25 cap; one press is one
  send against the rate limit; the
  gate on both routes (the existing router walk covers them).
- **Frontend:** the overview's default tab and counts, the empty state, the Where filter and
  search, row actions by state and role, Send updates with one failure among several, the
  Open menu's link attributes; Update mode with and without a sync, and Change where it goes;
  Refresh all with one failure.
- **Browser:** desktop and phone against the dev stack and the local Odoo, with a space and
  around 30 sent Documents.

## 12) Open questions

- **Badges in the tree.** Left out on purpose (§3); revisit after the overview has been used.
