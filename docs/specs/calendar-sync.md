# Calendar Synchronization — Spec

> Auto-create calendar events from date/time metadata in note front-matter.
> Status: Draft — 2026-03-21

---

## 1) Summary

Notes in Panino can contain date/time values in their YAML front-matter (`---` block). This feature reads those values and automatically creates, updates, or deletes corresponding events on the user's connected Google Calendar or Microsoft Outlook calendar. Synced events are written back into the note content as managed markdown links so users can open them directly from the editor or preview. A dedicated reference-management UI (similar to image management) lets users inspect synced events, resolve dangling links, and prune stale references.

---

## 2) Goals

1. Parse date/time fields from a note's front-matter and reflect them as calendar events.
2. Support Google Calendar (via Google Calendar API) and Outlook (via Microsoft Graph API).
3. Keep calendar events in sync — edits to dates update the event; deleting the date removes the event.
4. Provide a simple OAuth connection flow in Tools/Settings.
5. Write the synced event link back into note content as a managed markdown artifact.
6. Provide a calendar reference management UI for auditing, deleting, repairing, and pruning synced event references.

## Non-Goals

- No in-app calendar view (events are managed in the external calendar).
- No support for recurring events in v1.
- No two-way sync (calendar → notes).
- No adoption or deduplication of pre-existing external calendar events.
- No offline event creation — sync requires network connectivity.

---

## 3) Front-Matter Schema

```yaml
---
title: Project Kickoff
calendar:
  date: 2026-04-15
  time: "14:00"
  duration: 60          # minutes, default 60
  title: Project Kickoff Meeting   # optional, falls back to note title
  description: Review goals and milestones   # optional
  calendar: google      # "google" | "outlook", default from settings
---
```

### Field Definitions

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `calendar.date` | `YYYY-MM-DD` | Yes | — | Event date |
| `calendar.time` | `HH:MM` (24h) | No | All-day event | Start time |
| `calendar.duration` | integer (min) | No | 60 | Ignored for all-day events |
| `calendar.title` | string | No | Note title | Event summary |
| `calendar.description` | string | No | empty | Event body text |
| `calendar.calendar` | `"google"` \| `"outlook"` | No | User default | Target provider |

Multiple events per note can be specified with an array:

```yaml
calendar:
  - date: 2026-04-15
    time: "14:00"
    title: Kickoff
  - date: 2026-04-22
    time: "10:00"
    title: Follow-up
```

---

## 4) UX & UI

### Connection Flow

- **Google Calendar**: OAuth 2.0 via Google Identity Services. Scopes: `https://www.googleapis.com/auth/calendar.events`.
- **Outlook**: OAuth 2.0 via Microsoft Identity Platform (MSAL). Scopes: `Calendars.ReadWrite`.
- Tokens (access + refresh) stored encrypted in the backend per-user database.
- A **Calendar Accounts** section in Tools/Settings lets users connect/disconnect providers and set a default.

### Calendar Reference Manager

#### Entry point

- Add a **Calendar References** action under the account/tools area at the same discoverability level as image management.

#### Manager screen

- Show a paginated table/list of synced calendar references for the current user.
- Each row should include:
  - Event title
  - Provider (`google` or `outlook`)
  - Event start date/time
  - Linked note title
  - Sync/reference status
  - Last verified timestamp
  - Whether the document link is present
- Support search by note title and event title.
- Support filter by status: `healthy`, `missing-event`, `missing-link`, `orphaned-reference`, `provider-disconnected`.
- Support sort by newest/oldest and recently verified/least recently verified.
- Support multi-select and bulk actions.

#### Actions

- `Open note` — opens the linked note at the managed reference.
- `Open event` — opens the external provider link when the event still exists.
- `Remove reference` — deletes the managed link from the note and removes the backend mapping.
- `Delete event and reference` — removes the external event first, then removes the managed link and mapping.
- `Repair reference` — reinserts or rewrites the managed markdown link when the event exists but the note content artifact is missing or stale.
- `Recreate event` — creates a new external event and updates the existing managed reference when the external event is missing.

#### Deletion flow

- Confirmation must distinguish between removing only the note reference and removing the external event plus the reference.
- Confirmation text should list the affected note and provider account.
- Bulk deletion should return per-item results and allow partial success.

---

## 5) Sync Behavior

1. **On note save/sync**: Parse front-matter; diff calendar fields against last-known state.
2. **Create**: If `calendar.date` is present and no linked event exists, create the event via provider API.
3. **Update**: If calendar fields changed, update the existing event (matched by stored event ID).
4. **Delete**: If the `calendar` block is removed or the note is deleted, delete the linked event.
5. **Event ID mapping**: Store `{ note_id, event_index, provider, external_event_id }` in a local table to track linkage.

### Ownership and Matching Rules

- Panino only updates or deletes events that it previously created and linked to the note in `calendar_events`.
- Panino never searches the user's calendar for an existing event by matching `date`, `time`, `duration`, or `title`. If an unrelated external event already exists at the same time, Panino creates a separate event rather than adopting it.
- Created events should include a provider-side private metadata marker derived from `{ note_id, event_index }` when the target calendar API supports it.

### Error Handling

- If the provider API is unreachable, queue the operation and retry on next sync.
- If the OAuth token is expired, attempt refresh; if refresh fails, mark affected references `provider-disconnected` and surface a re-auth prompt.
- If an external event is found deleted during sync verification, set `reference_status` to `missing-event` and surface it in the manager — do **not** automatically recreate. The user chooses to recreate or remove via the manager.
- Orphaned managed link artifacts are surfaced in the manager UI for prune or repair.

---

## 6) Managed Reference Format

When a calendar event is successfully created, Panino writes a managed markdown block into the note content — similar to image pastes — so the event link is visible in both the editor and preview.

### Canonical block format

```md
<!-- panino:calendar-ref id=<calendar_event_row_id> note=<note_id> index=<event_index> provider=<google|outlook> -->
[Open calendar event](https://calendar.google.com/calendar/event?eid=...)
<!-- /panino:calendar-ref -->
```

- The opening marker is the authoritative locator for repair, prune, and update operations. `id` maps to `calendar_events.id`; `index` maps to `event_index`.
- The closing marker scopes the managed block so Panino can replace it without affecting surrounding content.
- Link text defaults to `Open calendar event`; the manager may add provider/date context without changing the marker contract.
- For multiple events per note, one block per event, each keyed by `event_index`.
- No link is inserted until the event is created. Externally deleted + recreated events (via `Recreate event` action) update the existing link in place.
- Initial insertion position: immediately after the front-matter closing `---` delimiter, separated by a blank line. If the user subsequently moves the block, sync preserves the new position.

### Examples

Single event note after sync:

```markdown
---
title: Project Kickoff
calendar:
  date: 2026-04-15
  time: "14:00"
  duration: 60
  title: Project Kickoff Meeting
---

<!-- panino:calendar-ref id=a1b2c3d4-e5f6-7890-abcd-ef1234567890 note=9f8e7d6c-5b4a-3210-fedc-ba0987654321 index=0 provider=google -->
[Open calendar event](https://calendar.google.com/calendar/event?eid=abc123XYZ...)
<!-- /panino:calendar-ref -->

The rest of the note content goes here.
```

Multi-event note after sync (one block per event, keyed by `index`):

```markdown
---
title: Sprint Planning
calendar:
  - date: 2026-04-15
    time: "14:00"
    title: Kickoff
  - date: 2026-04-22
    time: "10:00"
    title: Follow-up
---

<!-- panino:calendar-ref id=a1b2c3d4-e5f6-7890-abcd-ef1234567890 note=9f8e7d6c-5b4a-3210-fedc-ba0987654321 index=0 provider=google -->
[Open calendar event](https://calendar.google.com/calendar/event?eid=abc123...)
<!-- /panino:calendar-ref -->

<!-- panino:calendar-ref id=b2c3d4e5-f6a7-8901-bcde-f12345678901 note=9f8e7d6c-5b4a-3210-fedc-ba0987654321 index=1 provider=google -->
[Open calendar event](https://calendar.google.com/calendar/event?eid=def456...)
<!-- /panino:calendar-ref -->

The rest of the note content goes here.
```

### Content ownership rules

- Panino owns only content inside the `panino:calendar-ref` block.
- Users may move the block within the note; sync preserves that placement.
- User edits to the link text or URL inside the block may be normalized back on the next sync/repair.
- A malformed block (missing one marker) transitions to `orphaned-reference` and surfaces in the manager.
- If the user deletes the entire managed block manually, the next sync reinserts it for the still-linked event unless the calendar front-matter was also removed.
- If a managed block is pasted into a different note, the `note` attribute in the marker will not match the note being scanned. That block is treated as `orphaned-reference` in the destination note and surfaced for prune or removal. The original note and its `calendar_events` mapping are unaffected. One event maps to exactly one note; cross-note managed blocks are not supported.

### Reference Health States

| Status | Condition |
|--------|-----------|
| `healthy` | Backend mapping exists, external event exists, managed link exists in note content |
| `missing-event` | Backend mapping exists, but provider no longer has the external event |
| `missing-link` | Backend mapping and event exist, but the managed markdown link is missing from note content |
| `orphaned-reference` | Managed markdown link exists in note content, but no valid backend mapping remains |
| `provider-disconnected` | Mapping exists, but the provider account is disconnected or re-auth has failed |

---

## 7) Data Model

### Table: `calendar_accounts` (backend, per-user DB)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `provider` | TEXT | `"google"` \| `"outlook"` |
| `email` | TEXT | Provider account email |
| `access_token_enc` | TEXT | Encrypted access token |
| `refresh_token_enc` | TEXT | Encrypted refresh token |
| `expires_at` | TEXT | ISO 8601 |
| `is_default` | INTEGER | 0 or 1 |
| `created_at` | TEXT | ISO 8601 |

### Table: `calendar_events` (backend, per-user DB)

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `note_id` | TEXT | FK to notes |
| `event_index` | INTEGER | Position in array (0 for single) |
| `account_id` | TEXT | FK to calendar_accounts |
| `external_event_id` | TEXT | Provider's event ID |
| `external_event_url` | TEXT | Deep link to the provider event page when available |
| `document_link_marker` | TEXT | Stores the full opening HTML comment string for this reference, used when scanning note content to locate the managed block without a full parse |
| `reference_status` | TEXT | `healthy` \| `missing-event` \| `missing-link` \| `orphaned-reference` \| `provider-disconnected` |
| `last_verified_at` | TEXT | ISO 8601 timestamp for latest provider/content verification |
| `last_synced_hash` | TEXT | Hash of calendar fields for change detection |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |

These tables are **not** CRR-synced — calendar sync is backend-only.

---

## 8) API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/calendar/accounts` | List connected calendar accounts |
| `POST` | `/calendar/accounts/google` | Initiate Google OAuth flow |
| `POST` | `/calendar/accounts/outlook` | Initiate Outlook OAuth flow |
| `GET` | `/calendar/accounts/:provider/callback` | OAuth callback handler (`:provider` = `google` \| `outlook`) |
| `PATCH` | `/calendar/accounts/:id` | Update account settings (e.g. set as default) |
| `DELETE` | `/calendar/accounts/:id` | Disconnect a calendar account |
| `GET` | `/calendar/references` | List synced calendar references for the current user |
| `GET` | `/calendar/references/:id` | Get one reference with note/event health details |
| `DELETE` | `/calendar/references/:id` | Remove the note reference and mapping |
| `POST` | `/calendar/references/bulk-delete` | Remove multiple references with per-item results |
| `POST` | `/calendar/references/:id/repair` | Repair a missing/stale managed link in note content |
| `POST` | `/calendar/references/:id/recreate-event` | Recreate an external event for a dangling mapping |
| `POST` | `/calendar/sync` | Manually trigger calendar sync for all notes |

Automatic sync happens as part of the existing note sync pipeline — no explicit user action required.

### `GET /calendar/references` query params

| Param | Type | Notes |
|-------|------|-------|
| `limit` | integer | Default 50, max 200 |
| `cursor` | string | Opaque pagination cursor |
| `search` | string | Substring match against note title and event title |
| `status` | string | Filter by `reference_status` value |
| `sort` | string | `created_desc` \| `created_asc` \| `verified_desc` \| `verified_asc` |

---

## 9) Lifecycle and Pruning

### Immediate cleanup

- When the user removes a reference from the manager, delete the managed markdown link from note content and remove the corresponding `calendar_events` row.
- When the user chooses `Delete event and reference`, delete the provider event first, then remove the document artifact and mapping.

### Note edit and delete behavior

- If note metadata no longer defines a calendar event, sync should remove the corresponding managed link and backend mapping.
- If a note is deleted, remove all related `calendar_events` mappings and attempt to delete the external events best-effort.

### Scheduled prune job

- Add a daily maintenance job per user/account scope.
- Detect references in problematic states such as `missing-event`, `orphaned-reference`, and `provider-disconnected` older than a grace period of 7 days.
- Prune in bounded batches (for example 100 references per run).
- For `orphaned-reference`, remove the managed markdown artifact from note content when it can be located safely.
- For `missing-event`, remove the stale mapping and link only after the grace period unless the user repaired or recreated it.
- Log counts for scanned, repaired, and pruned references.

### Dangling reference policy

- Do not prune immediately when a provider call fails transiently.
- A dangling reference should remain visible in the manager UI during the grace period so the user can repair, recreate, or remove it deliberately.
- Disconnecting a calendar provider should mark affected references as `provider-disconnected` rather than deleting them immediately.
- When a user reconnects a disconnected provider account and re-auth succeeds, references with `provider-disconnected` status for that account should be re-evaluated on the next sync pass and transition back to an accurate status (`healthy`, `missing-event`, etc.).

---

## 10) Security Considerations

- OAuth tokens encrypted at rest using a per-user key derived from `JWT_SECRET`.
- Never expose raw tokens to the frontend.
- Validate all front-matter calendar fields before sending to provider APIs.
- Rate-limit calendar API calls to stay within provider quotas.
- All reference-management operations must be scoped to the authenticated user's note set and provider accounts only.

---

## 11) Test Matrix (Required)

1. Front-matter parsing
   - Single event and array of events both parsed correctly.
   - Invalid `date` format produces a validation error; no event is created.
   - Missing required `date` field is a no-op (no event created or deleted).
   - Unknown `calendar` provider value falls back to user default.
2. Sync create/update/delete
   - Adding `calendar.date` to a note triggers event creation and managed link insertion.
   - Changing calendar fields updates the existing event (not create a new one).
   - Removing the `calendar` block deletes the event and removes the managed link.
   - Change detection via `last_synced_hash` skips provider API calls when fields are unchanged.
3. Listing and filtering
   - Status filters return stable results.
   - Search by note title and event title works.
   - Pagination cursor is stable across pages.
   - Ownership isolation across users holds.
4. Reference health detection
   - Detect `healthy`, `missing-event`, `missing-link`, `orphaned-reference`, and `provider-disconnected` correctly.
   - Missing link detection handles manually edited note content.
   - External event deletion sets status to `missing-event`; does not auto-recreate.
   - Re-auth after disconnect transitions `provider-disconnected` references to accurate status.
5. Deletion
   - Remove reference deletes only the managed note artifact and mapping.
   - Delete event and reference also deletes the provider event.
   - Bulk delete returns per-item success/failure.
6. Repair and recreate
   - Repair restores a missing document link without duplicating it.
   - Recreate event updates the existing mapping and inserted link.
7. Managed block format
   - Initial insertion position is immediately after the front-matter closing delimiter.
   - Block can be located by scanning `document_link_marker` content.
   - Malformed block (missing one marker) correctly transitions to `orphaned-reference`.
   - A block pasted into a different note (mismatched `note` attribute) is treated as `orphaned-reference` in the destination; the original note's mapping is unaffected.
8. Pruning
   - Prune only affects dangling references older than the grace period.
   - Bounded batch behavior works across repeated runs.
   - Transient provider failures do not cause immediate pruning.
   - `provider-disconnected` references are not pruned during grace period.
