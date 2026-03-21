# Calendar Synchronization — Spec

> Auto-create calendar events from date/time metadata in note front-matter.
> Status: Draft — 2026-03-21

---

## 1) Summary

Notes in Panino can contain date/time values in their YAML front-matter (`---` block). This feature reads those values and automatically creates, updates, or deletes corresponding events on the user's connected Google Calendar or Microsoft Outlook calendar.

---

## 2) Goals

1. Parse date/time fields from a note's front-matter and reflect them as calendar events.
2. Support Google Calendar (via Google Calendar API) and Outlook (via Microsoft Graph API).
3. Keep calendar events in sync — edits to dates update the event; deleting the date removes the event.
4. Provide a simple connection flow (OAuth) in the app's Settings/Tools area.

## Non-Goals

- No in-app calendar view (events are managed in the external calendar).
- No support for recurring events in v1.
- No two-way sync (calendar → notes). Changes in the external calendar do not propagate back.
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

## 4) Authentication & Connection

- **Google Calendar**: OAuth 2.0 via Google Identity Services. Scopes: `https://www.googleapis.com/auth/calendar.events`.
- **Outlook**: OAuth 2.0 via Microsoft Identity Platform (MSAL). Scopes: `Calendars.ReadWrite`.
- Tokens (access + refresh) stored encrypted in the backend per-user database.
- A **Calendar Accounts** section in Tools/Settings lets users connect/disconnect providers and set a default.

---

## 5) Sync Behavior

1. **On note save/sync**: Parse front-matter; diff calendar fields against last-known state.
2. **Create**: If `calendar.date` is present and no linked event exists, create the event via provider API.
3. **Update**: If calendar fields changed, update the existing event (matched by stored event ID).
4. **Delete**: If the `calendar` block is removed or the note is deleted, delete the linked event.
5. **Event ID mapping**: Store `{ note_id, event_index, provider, external_event_id }` in a local table to track linkage.

### Error Handling

- If the provider API is unreachable, queue the operation and retry on next sync.
- If the OAuth token is expired, attempt refresh; if refresh fails, surface a re-auth prompt.
- Conflicts (event deleted externally): re-create on next sync.

---

## 6) Data Model

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
| `last_synced_hash` | TEXT | Hash of calendar fields for change detection |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |

These tables are **not** CRR-synced — calendar sync is backend-only.

---

## 7) API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/calendar/accounts` | List connected calendar accounts |
| `POST` | `/calendar/accounts/google` | Initiate Google OAuth flow |
| `POST` | `/calendar/accounts/outlook` | Initiate Outlook OAuth flow |
| `GET` | `/calendar/accounts/callback` | OAuth callback handler |
| `DELETE` | `/calendar/accounts/:id` | Disconnect a calendar account |
| `POST` | `/calendar/sync` | Manually trigger calendar sync for all notes |

Automatic sync happens as part of the existing note sync pipeline — no explicit user action required.

---

## 8) Security Considerations

- OAuth tokens encrypted at rest using a per-user key derived from `JWT_SECRET`.
- Never expose raw tokens to the frontend.
- Validate all front-matter calendar fields before sending to provider APIs.
- Rate-limit calendar API calls to stay within provider quotas.
