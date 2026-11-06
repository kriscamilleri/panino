# Name the API key in revision history

- Agent: Claude Code (Opus 5.5)
- Start: 2026-11-06, 13:00
- Status: Implemented and verified locally on `feature/api-key-revision-label`; not merged

## Objective

Kris asked that revisions made through the v1 API show which API key made them, not just
"via API", so separate keys per service (Claude Code, n8n, …) can be told apart.

## Progress

- `note_revisions` is backend-only (not a CRR), so a new column needs no frontend schema or
  sync change. Added `actor_label`, filled with the key's name at write time. A snapshot,
  not a key id: revoked keys are pruned after 30 days and the history must still say which
  key it was.
- Names alone are ambiguous if two keys share one, so key names are now unique among a
  user's unrevoked keys (case-insensitive, `409 API_KEY_NAME_TAKEN`). Revoking frees a name.
- No `CONTENT_SCHEMA_VERSION` bump: the column is additive, every query names its columns,
  and a bump would make a rolled-back server refuse the databases.

## Changes Made

- `db.js`: `actor_label TEXT` in `BASE_SCHEMA` and the rebuild table definition; added in
  place by `ensureNoteRevisionsSchema` on both the "already migrated" and "actor columns
  missing" paths; carried through the FK rebuild and interrupted-rebuild recovery.
- `revision.js`: `actorLabel` accepted by `createRevisionSnapshot` (kept only for kind
  `'api'`, trimmed, at most 60 characters); selected and serialized as `actorLabel`.
- `publicApi.js`: `snapshotAfter` passes `req.apiKey.name`.
- `apiKeys.js`: duplicate-name check inside the create transaction.
- `RevisionPanel.vue`: "via <name> (API key)" with a tooltip; "via API" when no label.
- Docs: `docs/architecture/public-api.md`, spec `llm-api.md` (U6, D4).

## Tests

- `npm run test:be`: 56 files, 816 tests passed. New: label rules (`revision.test.js`),
  in-place migration of a pre-label table and the rebuild path (`db.test.js`), duplicate
  names and per-key labels surviving revocation (`publicApi.test.js`).
- `npm run test:fe`: 88 files, 1076 passed (`revisionPanel.test.js` covers labelled and
  pre-label API revisions).
- `npm run lint`: clean.
- Dev stack (API container restarted to load the branch), local test account `user-A`:
  created keys "Claude Code" and "n8n invoices"; a third named "claude code" was refused
  over curl and in Settings (error alert shown). Created a Document with one key and
  appended with each; Revision History shows "by API Demo via Claude Code (API key)" and
  "… via n8n invoices (API key)" on the matching rows. No console errors. Both keys revoked
  afterwards.

## Open Items / Notes

- Revisions written before this change keep the generic "via API".
- Keys cannot be renamed; if renaming is added later, old revisions keep the old name by
  design (it is what the key was called when it wrote).
