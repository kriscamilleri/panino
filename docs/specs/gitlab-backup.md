# GitLab Backup Support — Spec

> Add GitLab as a second backup provider while preserving the existing GitHub backup behavior.
> Status: Draft — 2026-03-22

---

## 1) Summary

Extend Panino's existing backup feature to support **GitLab** in addition to GitHub.

The backup format stays the same: Panino exports a full snapshot of notes, folders, and images into a Git repository, then stores a new snapshot commit in the user's own remote repository. The main implementation change is architectural: the current GitHub-specific backup module should be split into a **shared backup core** plus **provider adapters**.

This spec covers:

1. GitLab OAuth connection.
2. GitLab project listing and project creation.
3. Full snapshot commits to a GitLab repository.
4. A generic provider-aware backup UI and API shape that keeps GitHub working.
5. Token refresh support required by GitLab OAuth.

This spec does **not** include Forgejo.

---

## 2) Goals

1. Add GitLab as a supported backup target without breaking existing GitHub backup users.
2. Reuse the existing snapshot export format and daily auto-backup behavior.
3. Refactor the backend so provider-specific logic is isolated behind a small interface.
4. Refactor the frontend from a GitHub-only modal/store to a provider-aware backup flow.
5. Support GitLab.com by default, with optional deployment-level support for a self-managed GitLab base URL.
6. Persist GitLab connection state, selected project, last backup status, and refreshed tokens securely in the existing per-user database.

## Non-Goals

1. No Forgejo support in this spec.
2. No restore or pull-from-GitLab flow.
3. No diff-based or partial backup export. Each backup is still a full logical snapshot.
4. No per-user custom GitLab instance URL entry in the UI.
5. No multiple concurrent backup jobs per user.
6. No redesign of the note/image export format beyond what is needed for provider support.

---

## 3) Product Behavior

### Entry Point

- Rename the current GitHub-specific entry to **Tools -> Backup**.
- The modal becomes provider-aware and shows at least two providers:
  - GitHub
  - GitLab

### Provider Selection

- The modal shows provider tabs or cards at the top.
- Each provider has its own connection status, selected repository/project, last backup time, and last error.
- A provider only appears if it is configured on the server.

### GitLab Connection Flow

1. User opens **Tools -> Backup**.
2. User selects the **GitLab** provider.
3. User clicks **Connect GitLab**.
4. Backend starts the OAuth flow and redirects the user to GitLab.
5. On success, Panino returns to the app, stores the tokens server-side, and displays the connected GitLab user.

### Project Selection

- After connecting, show a list of GitLab projects the user can write to.
- Allow selecting an existing project.
- Allow creating a new private project named `panino-backup` by default.
- Store both the GitLab project ID and the `path_with_namespace` value.

### Backup Behavior

- Manual backups run from the same modal via **Back Up Now**.
- Daily automatic backups remain opportunistic after sync activity.
- If both GitHub and GitLab are configured later, backups are still serialized per user. Only one provider job may run at a time.

### User Warnings

- Keep the current behavior that Panino owns the target repository/project contents.
- When selecting or creating a target project, show a short warning that later backups may replace unrelated files in that repository.

---

## 4) Scope Decisions

### GitLab Deployment Model

GitLab support in this spec is **deployment-scoped**, not user-scoped:

- Default base URL: `https://gitlab.com`
- Optional override: `GITLAB_BASE_URL`

This keeps the first implementation small while still allowing a self-hosted Panino deployment to point at a specific self-managed GitLab instance.

This spec explicitly does **not** add a user-entered GitLab host field.

### Existing GitHub Compatibility

- Existing GitHub routes and data must continue to work.
- Existing GitHub users should not be forced to reconnect.
- The implementation should refactor toward generic provider plumbing, but GitHub can keep backward-compatible route aliases.

---

## 5) UX & UI

### Modal Rename

- Replace **GitHub Backup** with **Backup**.
- Provider-specific copy appears inside the selected provider panel.

### Provider Panel State

Each provider panel should show:

1. Whether OAuth is configured on the server.
2. Whether the user is connected.
3. Connected account name and avatar.
4. Selected repository/project.
5. Last backup time.
6. Last backup commit SHA.
7. Last warning or error.
8. Next scheduled backup time.

### Recommended Flow

1. Provider selector.
2. Connection card.
3. Repository/project selector card.
4. Backup status card.

### URL Query Handling

Replace the current GitHub-only callback query scheme with a provider-aware version:

- `backupProvider=gitlab`
- `backupStatus=connected|error`
- `message=<optional>`

GitHub should migrate to the same scheme for consistency.

---

## 6) Architecture

### High-Level Refactor

Split the current backup implementation into:

1. **Shared backup core**
2. **Provider registry**
3. **Provider adapters**

### Shared Backup Core Responsibilities

The shared core owns:

1. Reading notes, folders, and images from the user database.
2. Building the snapshot entries and README.
3. Missing-image handling and warning generation.
4. Backup job lifecycle and in-memory job tracking.
5. Common status payload generation.
6. Auto-backup eligibility checks.
7. Token encryption helpers.

### Provider Adapter Responsibilities

Each provider adapter owns:

1. OAuth authorize URL generation.
2. OAuth callback token exchange.
3. Current-user lookup.
4. Repository/project listing.
5. Repository/project creation.
6. Repository/project selection validation.
7. Executing a snapshot commit.
8. Disconnect semantics.
9. Token refresh, if required by that provider.

### Proposed Backend Layout

Suggested file structure:

```text
backend/api-service/
  backup/
    index.js                 # route registration + provider registry
    core.js                  # snapshot building, job orchestration, shared helpers
    storage.js               # backup_config accessors and token encryption helpers
    providers/
      github.js
      gitlab.js
```

The exact file names may differ, but the separation of concerns should match this shape.

---

## 7) Provider Interface

The backend should define a small provider contract.

Suggested shape:

```javascript
{
  id: 'gitlab',
  label: 'GitLab',
  isConfigured(),
  buildCallbackUrl(req),
  createAuthorizeUrl({ req, userId }),
  handleOAuthCallback({ req, code, state }),
  disconnect({ config }),
  getViewer({ config }),
  listRepos({ config }),
  createRepo({ config, name }),
  validateSelectedRepo({ config, repoRef }),
  ensureValidAccessToken({ config, saveConfig }),
  runSnapshotBackup({ config, snapshot, trigger, onStage, saveConfig })
}
```

The shared core should not know provider-specific endpoint details.

---

## 8) GitLab OAuth

### Configuration

Add backend environment variables:

```ini
GITLAB_CLIENT_ID=
GITLAB_CLIENT_SECRET=
GITLAB_BASE_URL=https://gitlab.com
```

Derived values:

- OAuth authorize URL: `${GITLAB_BASE_URL}/oauth/authorize`
- OAuth token URL: `${GITLAB_BASE_URL}/oauth/token`
- REST API base: `${GITLAB_BASE_URL}/api/v4`

### OAuth Scope

Use the GitLab `api` scope.

Rationale:

1. Panino needs to read the authenticated user via `/user`.
2. Panino needs to list accessible projects.
3. Panino needs to create a project.
4. Panino needs to create commits through the REST API.

`write_repository` alone is insufficient because the implementation uses the REST API rather than Git-over-HTTP.

### Token Expiration

GitLab access tokens expire after a short period and include a refresh token.

Required behavior:

1. Store encrypted `access_token`.
2. Store encrypted `refresh_token`.
3. Store `token_expires_at`.
4. Before any GitLab API call, refresh the token if it is expired or within 60 seconds of expiry.
5. If refresh fails with an unrecoverable error such as `invalid_grant`, clear the stored GitLab credentials and require reconnect.

### Callback URL

The callback path should be:

- `/backup/gitlab/callback`

Production example:

- `https://panino.sh/api/backup/gitlab/callback`

Development example:

- `http://localhost:8000/backup/gitlab/callback`

---

## 9) GitLab API Integration

### Current User

Use:

- `GET /user`

Persist:

- `username`
- `name` if needed for display
- `avatar_url`

### List Writable Projects

Use:

- `GET /projects?membership=true&min_access_level=30&simple=true&order_by=last_activity_at&sort=desc&per_page=100&page=n`

Notes:

1. `min_access_level=30` filters to Developer-or-higher, which is the minimum practical level for repository writes.
2. The frontend should display `path_with_namespace` as the primary project label.
3. The stored project identifier should be the stable numeric `id`, not only the namespace path.

### Create Project

Use:

- `POST /projects`

Recommended payload:

```json
{
  "name": "panino-backup",
  "visibility": "private",
  "initialize_with_readme": true,
  "default_branch": "main"
}
```

This ensures the created project already has a default branch and can accept commit-based backups immediately.

### Validate Selected Project

Use:

- `GET /projects/:id`

Store:

1. `repo_id` as the GitLab project ID
2. `repo_full_name` as `path_with_namespace`
3. `repo_default_branch`

If the selected project has no default branch, Panino should reject selection in v1 with a clear error.

### Create Backup Commit

Use:

- `POST /projects/:id/repository/commits`

GitLab differs from GitHub here:

- GitHub currently creates a whole Git tree and then points a commit at it.
- GitLab's commit API accepts an `actions[]` array and applies those file changes in a single commit.

That means GitLab backup must first compute a **tree diff**.

### GitLab Snapshot Commit Algorithm

1. Build the desired snapshot entries using the existing shared snapshot code.
2. Fetch the current repository tree recursively.
3. Treat the repository as fully managed by Panino.
4. Compare the current tree to the desired snapshot paths.
5. Build one `actions[]` array:
   - `create` for new files
   - `update` for existing files
   - `delete` for files currently in the repo but absent from the new snapshot
6. Submit the whole snapshot as one commit to the default branch.

Recommended commit payload:

```json
{
  "branch": "main",
  "commit_message": "Panino backup 2026-03-22T18:00:00.000Z (manual)",
  "allow_empty": true,
  "actions": [
    {
      "action": "update",
      "file_path": "README.md",
      "content": "...",
      "encoding": "text"
    }
  ]
}
```

### Encoding Rules

1. Text note files and README should use `encoding: text`.
2. Binary images should use `encoding: base64`.

### Request Size Limits

GitLab's commit API has request size limits and rate limits for large commit payloads.

Implications:

1. Very large backups may need defensive error handling.
2. The first implementation should return a clear provider-specific error if GitLab rejects an oversized request.
3. Chunking across multiple commits is out of scope for this version.

---

## 10) Data Model Changes

The existing `backup_config` table is close, but GitLab requires extra token and repository metadata.

### Existing Table

The current table already stores one row per provider via the `provider` column.

### Required Additions

Add these nullable columns:

| Column | Type | Purpose |
|--------|------|---------|
| `refresh_token_enc` | TEXT | Encrypted GitLab refresh token |
| `token_expires_at` | TEXT | ISO 8601 timestamp for access token expiry |
| `provider_base_url` | TEXT | Base URL for provider instance, used by GitLab |
| `repo_id` | TEXT | Stable provider repository/project identifier |
| `repo_default_branch` | TEXT | Stored default branch for backup target |

### Semantics

1. GitHub rows may leave these new columns null.
2. GitLab rows must set `provider = 'gitlab'`.
3. `repo_full_name` for GitLab stores `path_with_namespace`.
4. `repo_id` stores the GitLab numeric project ID serialized as text for consistency with SQLite.

### Migration Requirement

Update the existing `backup_config` migration helper in the backend so old databases gain the new columns safely.

---

## 11) Backend API Contract

### New Generic Route Shape

The preferred route shape is provider-aware:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/backup/providers` | List available backup providers and config flags |
| `GET` | `/backup/:provider/status` | Get provider-specific status |
| `POST` | `/backup/:provider/connect` | Start OAuth flow |
| `GET` | `/backup/:provider/callback` | OAuth callback |
| `DELETE` | `/backup/:provider/disconnect` | Clear saved credentials |
| `GET` | `/backup/:provider/repos` | List writable repos/projects |
| `POST` | `/backup/:provider/repos` | Create a backup repo/project |
| `PUT` | `/backup/:provider/repo` | Select a repo/project |
| `POST` | `/backup/:provider/run` | Trigger manual backup |

### Backward Compatibility

Keep existing GitHub routes working by mapping them to the same provider registry internally.

Examples:

- `/backup/github/status`
- `/backup/github/run`

GitLab should use the new route family from the start.

### Provider Listing Response

Suggested payload:

```json
{
  "providers": [
    {
      "id": "github",
      "label": "GitHub",
      "configured": true
    },
    {
      "id": "gitlab",
      "label": "GitLab",
      "configured": true
    }
  ]
}
```

---

## 12) Frontend Changes

### Store Refactor

Replace the GitHub-only store with a provider-aware store.

Suggested direction:

- `githubBackupStore.js` -> `backupStore.js`

The store should accept a provider ID when making requests.

Example methods:

```javascript
fetchProviders()
fetchStatus(provider)
fetchRepos(provider)
startConnect(provider)
disconnect(provider)
createRepo(provider, name)
selectRepo(provider, repoRef)
runBackup(provider)
```

### Component Refactor

Replace the GitHub-only modal with a provider-aware modal.

Suggested direction:

- `GitHubBackupModal.vue` -> `BackupModal.vue`

### UI State Refactor

Rename GitHub-specific UI flags to provider-agnostic names.

Examples:

1. `showGithubBackupModal` -> `showBackupModal`
2. `openGithubBackupModal()` -> `openBackupModal()`
3. `closeGithubBackupModal()` -> `closeBackupModal()`

### Progress UI

The existing progress stages remain valid:

1. queued
2. exporting_notes
3. building_tree
4. creating_commit
5. pushing_to_provider

Rename the final stage from `pushing_to_github` to `pushing_to_provider`.

---

## 13) Auto-Backup Behavior

The auto-backup trigger point remains unchanged:

- Panino checks backup eligibility opportunistically after sync activity.

For GitLab, the same rules apply:

1. GitLab is connected.
2. A GitLab project is selected.
3. Auto-backup is enabled.
4. Last backup is older than 24 hours.

If the architecture later allows both GitHub and GitLab to be configured for the same user, auto-backups must remain serialized. If more than one provider is due, start one and defer the rest until a later opportunity.

---

## 14) Error Handling

### OAuth Errors

- If OAuth is not configured on the server, return `503` from the connect endpoint.
- If callback exchange fails, redirect back with `backupProvider=gitlab&backupStatus=error`.

### Token Refresh Errors

- If token refresh fails because the grant is invalid, clear the GitLab credential fields and require reconnect.

### Project Validation Errors

- Selecting a project without write-capable access should return `403`.
- Selecting a project with no default branch should return `400` with a clear message.

### Backup Errors

- Persist the provider-specific `last_error` just like GitHub.
- Preserve missing-image warnings in `last_warning`.
- Keep provider-specific error messages readable and not GitHub-branded.

---

## 15) Tests

This feature is incomplete without tests.

### Backend Integration Tests

Add GitLab-focused tests for:

1. `POST /backup/gitlab/connect` returns an authorize URL.
2. `GET /backup/gitlab/callback` stores encrypted access and refresh tokens.
3. `GET /backup/gitlab/status` returns disconnected and connected states correctly.
4. `GET /backup/gitlab/repos` lists writable projects only.
5. `POST /backup/gitlab/repos` creates a private project initialized with `main`.
6. `PUT /backup/gitlab/repo` validates selected project and stores `repo_id` plus `repo_full_name`.
7. `POST /backup/gitlab/run` creates a commit with create, update, and delete actions.
8. Expired GitLab tokens are refreshed before API calls.
9. Invalid refresh tokens force a reconnect path.
10. Missing referenced images produce a warning but still allow a successful backup.

### Frontend Unit Tests

Update or replace the existing GitHub-only store tests so they cover:

1. Provider listing.
2. Provider-specific status fetch.
3. GitLab connect URL fetch.
4. GitLab project selection.
5. Provider-specific error propagation.

### Manual Validation

Validate in the browser with MCP:

1. GitHub provider still works.
2. GitLab provider appears only when configured.
3. OAuth redirect completes and returns to the modal cleanly.
4. Project selection and manual backup work at desktop and mobile widths.
5. No console errors are introduced.

---

## 16) Rollout Plan

### Phase 1

1. Extract shared backup core.
2. Move existing GitHub logic behind a provider adapter.
3. Keep GitHub routes backward-compatible.

### Phase 2

1. Add GitLab adapter.
2. Add schema fields for refresh tokens and repository metadata.
3. Add provider-aware backend endpoints.

### Phase 3

1. Convert frontend modal and store to provider-aware versions.
2. Add GitLab UI.
3. Migrate callback query handling to provider-aware parameters.

### Phase 4

1. Add backend integration tests.
2. Update frontend unit tests.
3. Validate the user flow with MCP.

---

## 17) Risks And Open Questions

### GitLab Request Size Limits

GitLab's commit API can reject oversized action batches. Large image-heavy backups may hit this limit sooner than the GitHub tree-based approach.

This version should surface a clear error and defer chunking or multipart commit strategies to a later iteration.

### Repository Ownership Semantics

Panino treats the selected target repository/project as backup-managed. That means unrelated files may be deleted in later backups.

This should be stated clearly in UI copy.

### Self-Managed GitLab Scope

This spec supports deployment-level self-managed GitLab via `GITLAB_BASE_URL`, but it does not support per-user arbitrary GitLab instances.

That keeps the first version tractable.

### Future Forgejo Work

This spec deliberately stops after the provider abstraction and GitLab provider are in place. Forgejo should be evaluated later as a separate provider that reuses the same shared backup core.