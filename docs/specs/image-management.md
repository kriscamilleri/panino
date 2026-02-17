# Uploaded Image Management (Current User) — Spec

> Last updated: 2026-02-15

## Summary
Add first-class image management for the authenticated user so they can view, understand usage of, and remove uploaded images safely. The feature covers API, data model additions, cleanup policy, and minimal UI to manage image assets already stored in the user’s account.

## Problem
Panino currently supports uploading and serving images (`POST /images`, `GET /images/:id`) and embedding them in markdown, but users cannot directly manage their uploaded assets.

Current gaps:
- No image list endpoint for user inventory.
- No delete endpoint for removing uploaded images.
- No policy for orphaned images after note edits/deletes/imports.
- No per-user quota visibility or enforcement.
- No dedicated frontend image management screen.

## Goals
- Let users list their uploaded images with metadata.
- Let users delete one or multiple images they own.
- Prevent accidental breakage by exposing image usage references before deletion.
- Keep storage bounded with predictable cleanup behavior.
- Preserve existing auth and ownership guarantees.

## Non-Goals (v1)
- No background content-addressable deduplication.
- No automatic image optimization/resizing/transcoding.
- No image folder/tag taxonomy.
- No cross-user/admin global image management UI.

## Existing Behavior (Baseline)
- Upload writes file to `backend/api-service/uploads/` and inserts metadata into `images` table.
- Serving validates ownership (`id + user_id`) and path traversal guard.
- Frontend inserts markdown image links to `/images/:id` (or `/api/images/:id` in prod).
- Export/import pipeline includes image binaries and rewrites image references.

## User Experience (v1)
### Entry point
- Add an **Images** action under the account/tools area (same discoverability level as Export/Import).

### Image manager screen/modal
- Show a paginated table/list with:
  - Thumbnail preview
  - Original filename
  - MIME type
  - Size in bytes (new column)
  - Created timestamp
  - Usage count (number of notes referencing this image)
- Support search by filename.
- Support sort by newest/oldest and largest/smallest.
- Support multi-select and bulk delete.

### Deletion flow
- Deleting opens confirmation that includes usage summary:
  - Not referenced by any note: safe delete.
  - Referenced by notes: warn that markdown links will break.
- Confirmation text for referenced images must list up to first 5 affected notes and total count.
- On successful delete, remove rows from list immediately and show toast.

## Data Model
Extend `images` table in frontend and backend schemas.

### `images` table additions
- `size_bytes` INTEGER NOT NULL DEFAULT 0
- `sha256` TEXT NOT NULL DEFAULT ''

Notes:
- `size_bytes` enables UI sorting and quota calculations.
- `sha256` enables future duplicate detection/reporting (no dedupe behavior in v1).
- Keep table as CRR (`crsql_as_crr('images')`).
- Schema updates must be mirrored in:
  - frontend `DB_SCHEMA` (`frontend/src/store/syncStore.js`)
  - backend `BASE_SCHEMA` (`backend/api-service/db.js`)

## API Contract
All routes require JWT auth and use `req.user.user_id` only.

### `GET /images`
List current user images.

Query params:
- `limit` (default 50, max 200)
- `cursor` (opaque pagination token)
- `search` (filename substring)
- `sort` (`created_desc` | `created_asc` | `size_desc` | `size_asc`)

Response `200`:
```json
{
  "images": [
    {
      "id": "uuid",
      "filename": "diagram.png",
      "mimeType": "image/png",
      "sizeBytes": 81234,
      "createdAt": "2026-02-15T21:00:00.000Z",
      "url": "/images/uuid",
      "usageCount": 2
    }
  ],
  "nextCursor": "opaque-or-null"
}
```

### `GET /images/:id/usage`
Returns notes that reference the image URL.

Response `200`:
```json
{
  "imageId": "uuid",
  "usage": {
    "count": 2,
    "notes": [
      { "id": "note-uuid", "title": "Weekly Plan", "updatedAt": "2026-02-15T20:00:00.000Z" }
    ]
  }
}
```

### `DELETE /images/:id`
Delete one image for current user.

Request body (optional):
```json
{
  "force": false
}
```

Behavior:
- If image has references and `force !== true`, return `409` with usage payload.
- If deletable, delete DB row and file from disk in one guarded operation.

Success `200`:
```json
{ "deleted": true, "id": "uuid" }
```

### `POST /images/bulk-delete`
Delete multiple images in one request.

Request:
```json
{ "ids": ["uuid1", "uuid2"], "force": false }
```

Response `200`:
```json
{
  "results": [
    { "id": "uuid1", "deleted": true },
    { "id": "uuid2", "deleted": false, "reason": "in-use", "usageCount": 3 }
  ]
}
```

## Upload Rules (tightened)
For `POST /images`:
- Keep max size 1MB.
- Enforce MIME allowlist: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`.
- Validate stored file extension against accepted MIME mapping.
- Record `size_bytes` and `sha256` at upload time.
- Keep UUID storage filename policy and never trust original filename for storage path.

## Ownership, Authorization, Security
- Every image operation is scoped to `getUserDb(req.user.user_id)`.
- Never accept user ID from request body/query.
- Keep path traversal check on serve and delete file paths.
- Deleting image must tolerate missing disk file and still clean metadata row (report as partial warning in logs, not API failure).
- Preserve existing preview token behavior for internal image URLs.

## Usage Detection Strategy
- Image reference is detected from note markdown by matching `/images/:id` and `/api/images/:id` patterns.
- Usage index is computed on-demand in v1 via SQL + LIKE scan over note content.
- Add optional optimization later: background materialized usage table.

## Lifecycle and Cleanup
### Immediate cleanup
- On single/bulk delete, remove file + metadata.

### Note deletion behavior
- When a note is deleted, do not auto-delete images immediately in v1 (avoid deleting shared assets used by other notes).

### Scheduled orphan prune
- Add daily maintenance job per user DB:
  - Detect images with `usageCount = 0` older than 7 days.
  - Delete in bounded batches (e.g., 100 per run).
  - Log deleted count.

### Import behavior
- Keep current import behavior as-is for v1 (no automatic image reset).
- Document that import can introduce stale images; scheduled prune handles eventual cleanup.

## Quotas and Limits
- Add per-user account image stats endpoint:
  - `imageCount`
  - `totalImageBytes`
  - `quotaBytes` (configurable, default unlimited in dev)
- Optional enforcement in v1.1:
  - Reject upload with `413` if quota exceeded.

## Implementation Plan
1. Backend schema update (`images.size_bytes`, `images.sha256`) and migration guard.
2. Add image management routes (`GET /images`, `GET /images/:id/usage`, `DELETE /images/:id`, `POST /images/bulk-delete`).
3. Add usage query helper and pagination/sorting support.
4. Tighten upload validation and metadata capture.
5. Add frontend store for image manager API integration.
6. Add frontend manager UI (list, search, sort, select, delete).
7. Add scheduled orphan prune job.
8. Add tests and update docs.

## Test Matrix (Required)
1. Upload validation
   - Accept allowlisted MIME types.
   - Reject disallowed MIME/extension.
   - Reject over 10MB.
2. Listing
   - Pagination and cursor behavior.
   - Search and sort results deterministic.
   - Ownership isolation across users.
3. Usage detection
   - Detect `/images/:id` and `/api/images/:id` references.
   - Return correct note count + sample notes.
4. Deletion
   - Delete unused image removes DB row + disk file.
   - In-use image returns `409` when not forced.
   - Forced delete succeeds and returns consistent result.
   - Missing file on disk does not fail metadata cleanup.
5. Bulk delete
   - Mixed success/failure result shape stable.
   - Atomicity guarantees documented and tested (per item, not all-or-nothing).
6. Security
   - Unauthorized requests rejected.
   - User cannot delete/list another user’s images.
   - Path traversal attempts blocked.
7. Cleanup job
   - Prunes only unreferenced images older than threshold.
   - Bounded batch behavior works across runs.

## Open Questions
- Should deletion of in-use images require explicit typed confirmation in UI? 
NO.
- Should v1 include hard quota enforcement or only visibility metrics?
VISIBILITY.
- Should image usage matching include absolute URLs to same host in addition to relative `/images/:id` patterns?
NO.
- Should ZIP import be added in this same milestone to better pair with image management?
NO.
