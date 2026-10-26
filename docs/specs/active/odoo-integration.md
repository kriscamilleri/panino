# Odoo Integration — Spec

> Send a Document to Odoo 19+: as a PDF into the Documents app, as a rendered article into the
> Knowledge app, and as a PDF attached to an internal note in the chatter of an opportunity or
> sales order. And keep a space, a folder or a single Document mirrored into Knowledge, the way
> GitHub backup mirrors an account into a repository. Talks to Odoo's external JSON-2 API directly; nothing is
> installed in Odoo.
> Status: active (implementation started 2026-10-26 on `feature/odoo-integration`)
> Created: 2026-10-25
> Last updated: 2026-10-26

---

## 1) Summary

A user picks **Send to Odoo** on a Document, chooses any of three destinations, and Panino:

- renders the Document to PDF with the existing pipeline and files it in an Odoo **Documents**
  folder;
- renders the Document's markdown to HTML and creates (or updates) an Odoo **Knowledge** article;
- posts the PDF as an attachment on an **internal note** in the chatter of an **opportunity**
  (`crm.lead`) or **sales order** (`sale.order`).

Separately, a user can **sync a space, a folder or a single Document** to Knowledge: every
Document in it becomes an article, every subfolder a nested article, and Panino keeps them up to
date in the background (§11). Manual send stays for one-off sends and for opportunities and sales orders.

Every send uses the **sender's personal connection**, so the Odoo records are created and
updated as that person's Odoo user. This holds for personal Documents and for Documents in shared
spaces. All Odoo traffic goes through the Panino backend, which holds the API key.

Panino only ever modifies Odoo records it created itself, and it always overwrites those. The one
thing it adds to a record it did not create is that internal note on an opportunity or sales
order; it never changes their fields. Panino never deletes in Odoo; sync archives.

## 2) Decisions (Kris, 2026-10-25)

| Question | Decision |
|---|---|
| Destinations | Odoo Documents (PDF file), Odoo Knowledge (article), and the chatter of an opportunity or sales order (PDF attachment) |
| Chatter post type | Always an internal note (`mail.mt_note`), never a message: followers, who can include the customer, are not emailed |
| Chatter resend | Overwrite the PDF on the original note, and post a short internal note saying it was replaced, so the update shows in the chatter |
| Whose connection | Always the sender's personal connection, so Odoo attributes each record to the person who sent it. No space-level connection. |
| Odoo versions | 19 and later only, so the JSON-2 API only |
| Markdown | Rendered as a Knowledge article body, not attached as a `.md` file |
| Edits made in Odoo | Overwritten on the next send. Panino never modifies an Odoo record it did not create. |
| Showing who sent it | The record's Odoo author, from the sender's personal connection. No "Sent from Panino by" footer. |
| Test database | Kris provides an Odoo 19 Enterprise database with API access at implementation time |
| Scope | Manual send (§5) **and** sync to Knowledge (§11) are both in scope |
| Unit of sync | A whole space, a folder (with its subfolders), or a single Document |
| Whose connection runs a sync | The person who set it up; they are the Odoo author of every synced article |
| Deleted in Panino | Archived in Odoo, never deleted |
| Editing in Odoo | Synced articles are read-only in Odoo for everyone but the syncing user |
| PDFs in sync | Yes, opt-in per sync, into a Documents folder, in a later phase |
| Build order | Manual send first; sync builds on it |

## 3) Goals

1. Connect a Panino account to one Odoo database with an API key.
2. Send a Document as a PDF to a chosen Documents folder.
3. Send a Document as a Knowledge article under a chosen parent article (or at the top level).
4. Send a Document as a PDF to an opportunity or a sales order, as an attachment on an internal
   note in its chatter.
5. Sending the same Document again overwrites what Panino created earlier: the PDF, the article,
   or the PDF attached to that opportunity's or order's note.
6. A Document in a shared space maps to one Odoo record per destination, whichever member sends.
7. Keep a space, a folder or a single Document mirrored into Knowledge, one-way, without anyone
   pressing Send.
8. No Odoo module, no Odoo configuration beyond creating a user and an API key.

## Non-Goals

- **Modifying any Odoo record Panino did not create.** There is no "attach to an existing
  article/document" option, and no code path writes to an id Panino did not record at creation.
  An opportunity or sales order only ever gains an internal note; none of its fields change.
- Odoo 18 and earlier (XML-RPC / JSON-RPC are removed in Odoo 22 anyway).
- Importing from Odoo into Panino, or two-way sync. Sync is one-way: edits made in Odoo are
  overwritten (and prevented, §11).
- Syncing a whole personal account in one go. A sync is always one space, one folder or one
  Document.
- Chatter on any model other than opportunities and sales orders (contacts, tasks, invoices…).
- Chatter messages that notify followers or email the customer.
- Space-level or shared bot connections.
- Sending while offline, and a queued outbox.
- More than one Odoo connection per Panino account.

---

## 4) What Odoo gives us (verified against the 19.0 docs)

Source: <https://www.odoo.com/documentation/19.0/developer/reference/external_api.html>.

- **Endpoint:** `POST /json/2/<model>/<method>`, JSON body with named parameters (no positional
  arguments), `ids` for record methods, optional `context`.
- **Headers:** `Authorization: bearer <api key>`, `Content-Type: application/json`,
  `X-Odoo-Database: <db>` (needed when one server hosts several databases), `User-Agent`.
- **Version:** `GET /web/version` → `{"version_info": [19, 0, …], "version": "19.0"}`.
- **Who am I:** `POST /json/2/res.users/context_get` with no ids validates the key and returns the
  key owner's context.
- **One transaction per call.** Calls cannot be chained in one transaction. Every send step must
  be a single `create` or `write` so a failure never leaves half a record.
- **Errors:** 4xx/5xx with `{name, message, arguments, context, debug}`, where `debug` is a full
  server traceback. It must never reach a Panino user (§9).
- **Plans:** the external API is only on **Custom** plans on Odoo Online; not on One App Free or
  Standard. Odoo.sh and on-premise are not restricted. The Settings screen must say this.
- **API keys last at most three months** and must be rotated. Keys can be generated and revoked
  through `res.users.apikeys/generate` and `/revoke`; non-admin users need the system parameter
  `base.enable_programmatic_api_keys`.
- **Access rights are the key owner's.** Every call is checked against that user's rights and
  record rules, so a member without write access to a record another member sent gets an access
  error, not a silent overwrite.
- **Documents and Knowledge are Enterprise apps; CRM and Sales also exist in Community.** Each
  destination is offered only when its app is installed in the target database.

### Not yet verified: Phase 0

The Enterprise model fields below come from memory of Odoo 17/18 and from third-party sources.
They must be confirmed on the Odoo 19 Enterprise test database through its `/doc` page before any
code depends on them:

| Model | Fields and methods assumed |
|---|---|
| `documents.document` | `name`, `datas` (base64, writable), `mimetype`, `folder_id` (a `documents.document` of `type = 'folder'` since 18), `type`, `create_date` |
| `knowledge.article` | `name`, `body` (HTML), `parent_id`, `internal_permission`, `create_date`; `create` and `write` accept a sanitized HTML `body` |
| Knowledge checklists | the HTML Knowledge uses for checkboxes (believed `ul.o_checklist` / `li.o_checked`) |
| Chatter post | `message_post` is callable over JSON-2 on `crm.lead` and `sale.order` with `body`, `message_type: 'comment'`, `subtype_xmlid: 'mail.mt_note'`, `attachment_ids`; an attachment staged as `res_model: 'mail.compose.message', res_id: 0` by the same user is moved onto the record; the plain-text `body` is escaped, not rendered |
| Staged attachments | what happens to a staged attachment whose `message_post` failed (believed: removed by Odoo's autovacuum) |
| `crm.lead` | `type` (`'opportunity'`), `name`, `partner_id`, `stage_id` |
| `sale.order` | `name` (the reference, e.g. S00042), `partner_id`, `state` |
| Links | the web URLs in 19 (`/odoo/documents/<id>`, `/odoo/knowledge/<id>`, `/odoo/crm/<id>`, `/odoo/sales/<id>` assumed) |

---

## 5) User journeys

**Connect.** Settings → Integrations → Odoo. Fields: Odoo URL, database name, API key, key
expiry date. **Test and save** calls `/web/version` (must be ≥ 19) and `res.users/context_get`,
checks which of `documents.document`, `knowledge.article`, `crm.lead` and `sale.order` exist
(`ir.model/search_count`), then stores the connection. It shows the Odoo user's name and which
destinations are available. At least one must be.
Help text: use your own Odoo user (it is shown as the author of what you send), create a key
(max three months), Custom plan needed on Odoo Online.

**Send.** Document menu (phone: Document menu sheet; desktop: Document menu) → **Send to Odoo**:

- ☐ **PDF to Documents** — folder picker (search over folders), remembered per Panino database.
- ☐ **Article to Knowledge** — parent picker ("Top level" or search over articles), remembered.
- ☐ **PDF to an opportunity or sales order** — one record picker searching both (reference or
  name, customer, stage or status), listing the records this Document was already sent to first.
  The sheet says "Posted as an internal note. The customer isn't emailed."
- **Send** → progress per destination → toast "Sent to Odoo" with **Open in Odoo** links
  (`target="_blank" rel="noopener noreferrer"`).

The entry shows "Connect Odoo in Settings" when the sender has no connection, and is disabled
offline. The sheet names the Odoo host the Document is going to. **Article to Knowledge** has a
**Keep in sync** switch, which turns the send into a Document sync (§11). For a Document that is
already synced, on its own or inside a synced folder or space, the option reads "Synced to
Knowledge" with the time of the last sync: the sync owns that article, so a manual send cannot
create a second one.

**Send again.** If the Document was sent before (by anyone, for a space Document), the sheet
says "Last sent 3 days ago by Kris" and the button reads **Update in Odoo**. The PDF's `datas`
and the article's `name` and `body` are overwritten, including any edits made in Odoo. The folder
and parent pickers are hidden: the record stays where it is in Odoo.

For the chatter, sending again **to the same opportunity or order** overwrites the PDF on the
note Panino posted there; that note keeps its original date. Panino then posts a short internal
note, without an attachment: "<title>.pdf was replaced with a new version from Panino." So the
update shows as new activity while the chatter keeps one copy of the PDF. If posting that note
fails, the overwrite still stands and the result says the note is missing. Picking a
**different** opportunity or order posts a new note there and leaves the first one alone.

- If the earlier record was deleted in Odoo, Panino creates a new one and says so.
- If the sender's Odoo user may not write to it (a space Document first sent by someone with more
  rights), the destination fails with "Your Odoo user can't update this record" and nothing
  changes.
- If the sender is connected to a different Odoo than the earlier send, it is treated as a first
  send in that Odoo; the earlier record is left alone.

**Key expiry.** From 14 days before the stored expiry date, Settings and the send sheet show
"Your Odoo key expires on …". A 401 marks the connection **Key rejected** and points to
Settings. Automatic rotation is Phase 6.

---

## 6) Architecture

```text
Client (local-first)                      Panino API                        Odoo 19+
────────────────────                      ──────────                        ────────
build pdfRequest (Export code)  ─┐
render article HTML (markdownStore)      POST /integrations/odoo/send
apply front-matter variables   ─┴──────▶  authz (document dbKey, role)
                                          sender's connection
                                          renderPdf(pdfRequest)  ──────────▶ documents.document create/write
                                          sanitize article HTML  ──────────▶ knowledge.article create/write
                                          same PDF               ──────────▶ ir.attachment + message_post
                                          record link             ◀──────── ids
                                 ◀─────── per-destination result
```

- **Content comes from the client.** Panino is local-first: the server copy may be behind or the
  Document may not have synced. The client sends exactly what the user sees, with front-matter
  variables already applied, as the PDF export does today.
- **The browser never calls Odoo.** Odoo sends no CORS headers, and the key must stay on the
  server.
- **The PDF reuses the existing pipeline.** `pdf.js` gains an internal
  `renderPdf(payload, { signal })` sharing the current queue and limits; `POST /render-pdf`
  becomes a thin wrapper. The send route calls it directly; no PDF round-trips through the client.

### Odoo client (`backend/api-service/odooClient.js`)

A small JSON-2 client: `call(connection, model, method, params)`.

- Outbound requests go through the SSRF-safe fetch extracted from `imageFetch.js`
  (`resolveChecked` + pinned socket `lookup`) into a shared `safeFetch.js`.
- Timeouts per call (10 s; 60 s for uploads), response size cap, `User-Agent: Panino/<version>`.
- Maps errors to a closed set: `unreachable`, `not_odoo_19`, `key_rejected`, `access_denied`,
  `missing_app`, `record_gone`, `too_large`, `odoo_error`. The Odoo `name` is kept in server logs
  only; `message`, `arguments` and `debug` are never forwarded.

### Only Panino's own records are written

The **link table (§8) is the only source of record ids Panino may write to.** A link is created
only from the id returned by Panino's own `create`. Before any `write`:

1. The link must match the sender's connection target (normalized base URL + database name).
2. A `read` of `create_date` must return the value stored when Panino created the record. This
   catches a link pointing at a different database behind the same URL (a restore or a swap).
3. Only then `write`. If step 2 finds no record, it is `record_gone` → create a new one. If it
   finds a different `create_date`, the link is dropped and a new record created; the existing
   one is left untouched.

Pickers only choose where a **new** record goes (folder, parent). No API takes an Odoo record id
to write to from the client.

**Chatter is the one exception, and it only adds.** The client names the opportunity or order
(`resModel` from an allow-list of `crm.lead` and `sale.order`, plus `resId`). The server only
ever passes that id to `message_post`, never to `write` or `unlink`. What Panino creates there,
and may later overwrite, is its own `ir.attachment`, under the same `create_date` check, plus a
check that the attachment still belongs to that `res_model`/`res_id`.

### Calls per send

| Step | Call |
|---|---|
| PDF, first send | `documents.document/create` `{vals_list: [{name, folder_id, datas, mimetype: 'application/pdf'}]}`, then `read` `create_date` |
| PDF, again | `documents.document/read` `{ids: [id], fields: ['create_date']}`, then `write` `{ids: [id], vals: {datas, name}}` |
| Article, first send | `knowledge.article/create` `{vals_list: [{name, body, parent_id}]}`, then `read` `create_date` |
| Article, again | `knowledge.article/read` (as above), then `write` `{ids: [id], vals: {name, body}}` |
| Folder picker | `documents.document/search_read` `{domain: [['type','=','folder']], fields: ['name','folder_id'], limit}` |
| Article picker | `knowledge.article/search_read` `{domain: [['name','ilike',q]], fields: ['name','parent_id'], limit: 20}` |
| Chatter, first send to a record | `<model>/read` `{ids: [resId], fields: ['name']}` (exists, readable); `ir.attachment/create` `{vals_list: [{name, datas, mimetype: 'application/pdf', res_model: 'mail.compose.message', res_id: 0}]}`; `<model>/message_post` `{ids: [resId], body: '<title> (PDF from Panino)', message_type: 'comment', subtype_xmlid: 'mail.mt_note', attachment_ids: [attachmentId]}`; `ir.attachment/read` `create_date` |
| Chatter, again to that record | `ir.attachment/read` `{ids: [id], fields: ['create_date','res_model','res_id']}`, then `write` `{ids: [id], vals: {datas, name}}`, then `<model>/message_post` `{ids: [resId], body: '<title>.pdf was replaced with a new version from Panino.', message_type: 'comment', subtype_xmlid: 'mail.mt_note'}` |
| Record picker | `crm.lead/search_read` `{domain: [['type','=','opportunity'], '|', ['name','ilike',q], ['partner_id','ilike',q]], fields: ['name','partner_id','stage_id'], limit: 10}` and `sale.order/search_read` `{domain: ['|', ['name','ilike',q], ['partner_id','ilike',q]], fields: ['name','partner_id','state'], limit: 10}` |

The record-changing step is one call for Documents and Knowledge, so they either fully succeed or
leave Odoo unchanged. The chatter takes two:

- **First send:** stage the attachment, then post the note. If the post fails, the staged
  attachment is linked to nothing and visible to no one. Panino does not delete it; Phase 0
  confirms Odoo's autovacuum removes it.
- **Resend:** overwrite the attachment, then post the "replaced" note. A failed note after a
  successful overwrite is reported, not retried as a second overwrite.

If the `create_date` read after a create fails, the link is stored without it and filled in by
the next send's read. The three destinations are independent: any can succeed while another
fails, and the result reports each.

---

## 7) Markdown → Knowledge article

- Rendered **on the client** with the same MarkdownIt instance and front-matter substitution the
  Preview uses, then sanitized with DOMPurify. The server sanitizes again (same allow-list as
  `pdfSanitize.js`) before sending; Odoo sanitizes a third time on write.
- The first `# heading`, when it equals the title, is dropped from the body (Knowledge shows the
  article name as its title).
- Task lists (`- [ ]`, `- [x]`) are converted to Knowledge checklist markup (Phase 0 confirms it).
- Tables, code blocks, quotes and links pass through as plain HTML.
- **Images (Phase 5).** Panino image URLs need a Panino session, so they would break in Odoo.
  The first versions replace each image with a link-free placeholder ("Image not sent"). Phase 5
  uploads each image as an `ir.attachment` on the article and rewrites `src`; that is several
  calls, so a failure part-way leaves an article with some images missing and is reported as such.
- No "Sent from Panino by" footer: the article's Odoo author is the sender (§2).

---

## 8) Data model

Server-only tables, like `backup_config`: **not** CRRs, **not** in the frontend `DB_SCHEMA`,
never synced to browsers.

**The connection belongs to the person**, in the user's database (`BASE_SCHEMA`):

```sql
CREATE TABLE IF NOT EXISTS odoo_connection (
  id TEXT PRIMARY KEY NOT NULL,          -- one row
  base_url TEXT NOT NULL,                -- https origin, normalized
  database_name TEXT NOT NULL DEFAULT '',-- X-Odoo-Database; '' when not needed
  api_key_enc TEXT NOT NULL,             -- AES-256-GCM, §9
  key_expires_on TEXT,                   -- ISO 8601 date, entered by the user
  odoo_user_name TEXT,
  odoo_version TEXT,
  apps TEXT NOT NULL DEFAULT '[]',       -- JSON: ["documents","knowledge","crm","sales"]
  created_at TEXT NOT NULL,
  last_verified_at TEXT,
  last_error TEXT                        -- one of the §6 error codes
);
```

**Links belong to the Document (or folder)**, in the database it lives in: the user's database
(`BASE_SCHEMA`) or the space database's server-local schema (`SPACE_LOCAL_SCHEMA`). That is what
lets every member of a space update the same Odoo record. Remembered folder and parent choices
live with the links, so a space shares them too:

```sql
CREATE TABLE IF NOT EXISTS odoo_links (
  source_id TEXT NOT NULL,               -- note id, or folder id for a synced folder's article
  source_type TEXT NOT NULL DEFAULT 'note' CHECK (source_type IN ('note', 'folder')),
  destination TEXT NOT NULL CHECK (destination IN ('documents', 'knowledge', 'chatter')),
  odoo_target TEXT NOT NULL,             -- normalized base_url + '|' + database_name
  target_key TEXT NOT NULL DEFAULT '',   -- '' for documents/knowledge; 'crm.lead:42' or 'sale.order:7' for chatter
  odoo_record_id INTEGER NOT NULL,       -- documents.document, knowledge.article, or Panino's ir.attachment
  odoo_message_id INTEGER,               -- chatter only: the note Panino posted
  odoo_create_date TEXT,                 -- from Odoo, for the §6 ownership check
  sync_id TEXT,                          -- set when a sync (§11) owns this record
  content_hash TEXT,                     -- sync only: hash of what was last written
  archived_at TEXT,                      -- sync only: archived in Odoo after a delete or move-out
  first_sent_by TEXT NOT NULL,           -- Panino user id
  last_sent_at TEXT NOT NULL,
  last_sent_by TEXT NOT NULL,
  PRIMARY KEY (source_id, destination, odoo_target, target_key)
);

CREATE TABLE IF NOT EXISTS odoo_defaults (
  odoo_target TEXT PRIMARY KEY NOT NULL,
  folder_id INTEGER,
  parent_article_id INTEGER
);
```

A Document can be linked to several opportunities and orders, one row each. Deleting a Document
deletes its manual-send links; a synced Document's link is kept until the sync has archived its
article. Panino never deletes anything in Odoo.

## 9) API

All routes are behind auth and `ODOO_INTEGRATION_ENABLED` (default false, like the collab flags).
The connection is always the caller's own, from `req.user.user_id`. `dbKey` names the
**Document's** database: `user:` must be the caller's own, `space:` requires membership.

| Route | Who | Purpose |
|---|---|---|
| `GET /integrations/odoo` | any user | own status: host, Odoo user, version, apps, expiry, last error. Never the key. |
| `PUT /integrations/odoo` | any user | `{baseUrl, databaseName, apiKey, keyExpiresOn}`: verify (§5), then store |
| `DELETE /integrations/odoo` | any user | remove own connection (links stay with the Documents) |
| `GET /integrations/odoo/folders?q=` | connected user | folder picker |
| `GET /integrations/odoo/articles?q=` | connected user | article picker |
| `GET /integrations/odoo/records?q=` | connected user | opportunity and sales order picker |
| `GET /integrations/odoo/links?dbKey=&noteId=` | can read the Document | last-sent state for the sheet |
| `POST /integrations/odoo/send` | owner of `user:`; space owner or editor | `{dbKey, noteId, title, pdfRequest?, documents?: {folderId}, knowledge?: {parentId, html}, chatter?: {resModel, resId}}` → `{documents?, knowledge?, chatter?}`, each `{ok, url, created, error?}` |

`noteId` must exist in that database, which ties every link to a real Document. `folderId` and
`parentId` are used only when creating; they are ignored when a link exists. `pdfRequest` is
required when `documents` or `chatter` is present and is rendered once for both. A `resModel`
other than `crm.lead` or `sale.order` is rejected with 400.

### Security

- **Key storage:** AES-256-GCM with a dedicated `ODOO_CREDENTIAL_ENCRYPTION_KEY`. Unlike the
  backup token there is **no fallback to `JWT_SECRET`**: without the key the feature stays off.
  Extract the backup module's `encryptToken` / `decryptToken` into a shared `secrets.js` taking the
  key as a parameter. The key is write-only through the API and never logged.
- **Outbound requests (SSRF):** `https:` only, public addresses only via the pinned lookup.
  Self-hosted Odoo on a private network needs the operator to list the host in
  `ODOO_ALLOWED_PRIVATE_HOSTS`. No redirects followed.
- **Only Panino's own records are written** (§6), enforced on the server. Opportunities and
  sales orders only receive `message_post`, always with `subtype_xmlid: 'mail.mt_note'` set by
  the server; the client cannot choose the subtype or message type.
- **Content leaves Panino.** The send sheet names the Odoo host. In a space, sending requires
  editor rights; `first_sent_by` and `last_sent_by` record who sent.
- **Space membership:** a removed member can no longer send that space's Documents. Their own
  connection is theirs; what they sent stays in Odoo, owned by their Odoo user.
- **Limits:** request body cap for `/send` (PDF payload plus HTML; align with `/render-pdf`
  `MAX_REQUEST_BYTES` and Nginx `client_max_body_size`), PDF size cap before base64 (default
  25 MB), per-user rate limit (10 sends per minute).
- **Errors:** only the §6 codes and a short message reach the client. `debug` tracebacks are
  dropped before logging too (they contain Odoo server paths).

---

## 10) UI

- **Settings → Integrations → Odoo** (desktop Settings page and `PhoneSettingsPage`): the form,
  status, expiry warning, Disconnect, and which destinations this Odoo offers.
- **Send sheet** (phone: a new `?sheet=odoo` on the editor route via `useSheetRoute`; desktop: a
  `BaseModal`): destination checkboxes, folder and parent pickers (first send only), opportunity
  and sales order picker, last-sent line per destination, Send / Update.
- Copy says **Document** for Panino Documents and names Odoo's apps by their names ("Documents",
  "Knowledge") and records by Odoo's terms ("opportunity", "sales order", "internal note");
  "file" only for the PDF.

---

## 11) Folder and space sync

### What it does

A **sync** maps one whole space, one Panino folder (with everything under it) or one single
Document to one Knowledge parent article in one Odoo database. From then on, Panino keeps the
articles matching, one way:

| In Panino | In Odoo |
|---|---|
| The synced folder or space | Children of the chosen parent article (the folder itself is not an article) |
| A subfolder | An article with an empty body, parent of its contents |
| A Document | An article: title → `name`, rendered markdown → `body` (§7) |
| Rename | `name` written |
| Edit | `body` written |
| Move within the synced tree | `parent_id` written |
| Delete, or move out of the synced tree | Article **archived** (recoverable in Odoo) |
| Restored or moved back in | Article unarchived and rewritten |
| Article deleted in Odoo | Recreated on the next run (Panino is the source) |

Order follows Panino's title sort through Knowledge's `sequence`.

A **Document sync** follows the Document, not a place: moving it to another folder changes
nothing in Odoo, and only deleting it archives the article. It is set up from the send sheet's
**Keep in sync** switch or from the Document menu.

**Existing articles are adopted.** When a Document already sent to Knowledge by hand comes under
a sync, the sync takes over that article (it is Panino's own, §6): it sets `sync_id` on the link,
moves the article under the sync's parent if needed and rewrites it. No second article is made.

### Setting one up

- **Personal:** Settings → Integrations → Odoo → **Add sync**: pick a folder or a Document, pick
  the Knowledge parent (or top level), optionally a Documents folder for PDFs (Phase 11).
- **Space:** the space's settings → **Sync to Odoo**, available to the owner and editors. The
  person who sets it up is shown as "Syncing as <Odoo user>" and their connection runs it. Their
  Odoo user is the author of every article.
- One sync per space, folder or Document. Anything inside a synced space or folder cannot have
  its own sync.
- The first run creates the whole tree level by level, using `create` with a list of records per
  level (one call and one transaction per level).

**Read-only in Odoo.** On the root articles of a sync, Panino sets the internal permission to read
and makes the syncing user a write member; the children inherit it. Colleagues read the mirror
but cannot edit a copy that the next run would overwrite. Phase 0 confirms the calls
(`internal_permission`, `knowledge.article.member`).

### When it runs

- **After changes:** when `/sync` applies changes in a database with a sync, a run for that sync
  is scheduled **3 minutes** later, restarted by further changes (so a burst of edits is one
  run), and at most every 3 minutes.
- **Sync now** in Settings and in the space settings.
- **Daily reconcile:** once a day a full comparison catches drift, such as articles deleted or
  unarchived in Odoo, and rewrites what differs.
- One run per sync at a time, in a job map like `backupJobs`. Runs are capped per Odoo target
  (60 calls a minute) so a first run of a large folder does not hammer the Odoo server.

### Change detection

Each run reads the folder tree and Documents from the **server copy** of the database (as GitHub
backup does), renders each Document, and hashes `name + parent + body`. Only records whose hash
differs from `odoo_links.content_hash` are written. A Document still sitting unsynced on a phone
is picked up by the run after it syncs.

Each record succeeds or fails on its own; failures are retried on the next run and counted in
the sync's status. A run never stops halfway through a write because each write is one call.

### Server-side rendering

There is no browser in a background run, so the markdown rendering the Preview does (MarkdownIt
setup, front-matter and global variable substitution, sanitizing) moves into `shared/` and is used
by both the frontend Preview and the backend. **Sync must render exactly what the Preview shows**;
a shared test fixture set compares the two. Manual Knowledge send (§7) switches to the shared
renderer at the same time, so both produce the same article.

PDFs in a sync (Phase 11) also mean building the print request (styles, print styles, page size)
on the server and a Puppeteer render per changed Document. That is real CPU on the server, so
it is opt-in per sync and runs at lower priority than interactive `/render-pdf` requests.

### Status

Like the backup card: last run time, records created/updated/archived, failures with the §6 error
codes, **key expiry** shown in red from 14 days out, and a paused state. A sync pauses, and says
why, when the key is rejected, when the syncing user disconnects Odoo, or when they leave the
space. Another owner or editor can then **take over**: their connection runs it from then on.
Their Odoo user must be able to write the existing articles; if not, the take-over fails with
`access_denied` and changes nothing.

### Data

In the database being synced (`BASE_SCHEMA` or `SPACE_LOCAL_SCHEMA`), server-only like the rest:

```sql
CREATE TABLE IF NOT EXISTS odoo_syncs (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('space', 'folder', 'note')),
  source_id TEXT,                        -- folder id or note id; NULL for a whole space
  odoo_target TEXT NOT NULL,
  parent_article_id INTEGER,             -- NULL: top level of Knowledge
  documents_folder_id INTEGER,           -- PDFs, Phase 11; NULL: off
  run_as TEXT NOT NULL,                  -- Panino user id whose connection runs it
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  paused_reason TEXT,
  last_run_at TEXT,
  last_result TEXT,                      -- JSON: counts and failures
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Records a sync writes carry `sync_id` in `odoo_links`, which makes the §6 ownership rule apply to
sync unchanged.

### API

| Route | Who | Purpose |
|---|---|---|
| `GET /integrations/odoo/syncs?dbKey=` | can read the database | syncs and their status |
| `POST /integrations/odoo/syncs` | owner of `user:`; space owner or editor | `{dbKey, scope, sourceId?, parentArticleId, documentsFolderId?}`; runs as the caller |
| `POST /integrations/odoo/syncs/:id/run` | same | Sync now |
| `POST /integrations/odoo/syncs/:id/take-over` | same | run as the caller from now on |
| `DELETE /integrations/odoo/syncs/:id` | same | stop syncing; articles stay in Odoo, links are dropped |

## 12) Phases

0. **Verify.** On the Odoo 19 Enterprise test database, confirm the §4 table through `/doc` and
   by hand with `curl`: create/read/write on Documents and Knowledge, `message_post` with a staged
   attachment on an opportunity and a sales order, checklist markup, record URLs, error shapes for
   missing records and missing rights. For sync: batch `create`, archiving and unarchiving
   articles, `sequence`, and setting read-only permissions with a write member. Record results in
   this spec.
1. **Connection.** `safeFetch.js` extraction, `secrets.js`, `odooClient.js`, `odoo_connection`,
   connection routes, Settings UI, feature flag.
2. **PDF to Documents.** `renderPdf` refactor, links and the ownership check, send route
   (Documents only), folder picker, send sheet on phone and desktop. Personal and space
   Documents.
3. **PDF to an opportunity or sales order.** Record picker, staged attachment and internal note,
   overwrite plus a "replaced" note on resend to the same record. Works on Community databases.
4. **Article to Knowledge.** HTML rendering and sanitizing, checklist mapping, parent picker.
   Images replaced by placeholders.
5. **Images** uploaded into articles.
6. **Key lifecycle.** Expiry warnings everywhere; optional rotation through
   `res.users.apikeys/generate` when allowed (generate the new key, store it, verify it, then
   revoke the old one).
7. **Shared renderer.** Move Preview rendering into `shared/`, with fixtures proving frontend and
   backend output match; manual Knowledge send switches to it.
8. **Sync to Knowledge.** `odoo_syncs`, Document and folder syncs, adopting manually sent
   articles, first run by levels, change detection, archive and restore, read-only permissions,
   scheduler and daily reconcile, status card, the send sheet's Keep in sync switch. Personal
   Documents and folders.
9. **Space sync.** Whole-space syncs and syncs of space folders and Documents, space settings,
   owner/editor rules, pause and take-over.
10. **Images in synced articles**, reusing Phase 5.
11. **PDFs in sync** (opt-in): server-built print request, low-priority rendering into a
    Documents folder.

## 13) Tests

- **Unit:** `odooClient` against mocked `fetch` (headers, error mapping, traceback never
  surfaced, timeouts); `safeFetch` (private addresses refused, allow-list honoured, no redirects);
  HTML conversion (heading drop, checklists, image placeholders, sanitizing).
- **Ownership:** no route writes to an id that is not in `odoo_links`; a link for another
  `odoo_target` is ignored; a `create_date` mismatch drops the link and creates a new record
  without writing to the old one; a deleted record is recreated.
- **Chatter:** `message_post` always carries `mail.mt_note` whatever the client sends; no
  `write` or `unlink` is ever issued on `crm.lead` or `sale.order`; resend to the same record
  writes only Panino's attachment and posts one "replaced" internal note; a failed "replaced"
  note leaves the overwrite in place and is reported; a different record gets a new note; a
  disallowed `resModel` is refused; an attachment that moved to another record is not overwritten.
- **Sync:** first run creates the tree level by level; an edit writes one body; a rename, a move
  and a delete write name, parent and `active` respectively; nothing unchanged is written (hash);
  an article deleted in Odoo is recreated; a failed record is retried next run without stopping
  the others; a burst of changes schedules one run; a rejected key pauses the sync; take-over
  without write rights changes nothing; manual Knowledge send is unavailable inside a synced
  folder; a synced Document moved to another folder changes nothing in Odoo; a manually sent
  article is adopted by a new sync, not duplicated.
- **Renderer parity:** the shared fixtures render identically in the frontend Preview and on the
  server.
- **Integration (backend, Docker):** routes with a fake Odoo HTTP server: authz (other user's
  `dbKey`, space viewer/editor/owner, removed member), create then update by a second space
  member, access denied for that member, partial success across destinations, flag off → 404.
- **Against real Odoo:** a scripted smoke test (`scripts/odoo-smoke.mjs`), run by hand against
  the test database. Not in CI: it needs an Enterprise database and a live key.
- **Browser:** phone and desktop send flows on the local stack against the fake Odoo server.

## 14) Open questions

None blocking. Phase 0 may change §4's field names, the checklist mapping, the chatter calls and the Knowledge
permission and archive calls.
