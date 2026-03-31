 # AI Editor Pane — Spec

> Panino-native AI assistance for the active note, backed by a constrained tool-calling harness and pluggable inference providers.
> Status: Draft — 2026-03-28

---

## 1) Summary

Add an **AI Editor** pane to Panino's main document workspace.

The pane is a docked chat-driven assistant that:

1. Accepts natural-language instructions from the user in a small composer at the bottom of the pane.
2. Reads the **current note draft** plus additional context from the wider Panino workspace.
3. Can **propose** edits to the current note and, after explicit user approval, **apply** them.
4. Must **never modify any note other than the currently open note** in v1.

The implementation should use a **Panino-native harness** rather than embedding GitHub Copilot directly into the web UI. The harness runs an iterative tool-calling loop with a tightly scoped toolset:

1. Read the active note, selection, folder path, globals, and other workspace notes.
2. Search or read the workspace when needed.
3. Produce a final answer or a proposed replacement for the active note.
4. Apply changes only to the active note and only with explicit user approval.

Because Panino is **local-first**, the harness should execute workspace reads and note mutations in the **browser**, close to the local SQLite database and unsaved draft state. The backend should handle **provider credentials**, **OAuth if supported**, and **inference proxying/streaming**.

---

## 2) Goals

1. Add a dockable AI pane to the main editor experience on desktop, with a mobile-safe fallback.
2. Keep all AI write operations scoped to the **currently open note only**.
3. Allow the AI to read broader Panino workspace context when useful: other notes, folders, globals, and image metadata.
4. Support a provider abstraction so Panino is not coupled to one model vendor.
5. Preserve Panino's local-first behavior by reading the active draft from the frontend, not only the synced DB row.
6. Make the AI interaction transparent: show which context was used, what edit is proposed, and when an edit would mutate the note.
7. Keep the initial harness constrained and auditable: no arbitrary shell commands, no unrestricted network fetches, no multi-note writes.

## Non-Goals

1. No mutation of non-active notes, folders, globals, or images in v1.
2. No autonomous background agent that runs without the user explicitly opening the pane and sending a request.
3. No attempt to embed the official GitHub Copilot chat UI inside Panino.
4. No assumption that GitHub OAuth can spend a user's Copilot subscription from Panino.
5. No server-side indexing pipeline or embeddings service in v1.
6. No cross-note batch refactors, note creation, note deletion, or folder restructuring in v1.
7. No persistent server-side storage of prompt/response transcripts in v1.
8. No voice input or dictation integration in this feature.

---

## 3) Product Constraint And Feasibility Decision

### Core constraint

The AI pane may **read across the whole Panino workspace**, but it may only **write to the note that is currently open in the editor**.

In practical terms, the harness may inspect:

1. The active note title, content, selection, and folder path.
2. Other notes and folders in the user's Panino workspace.
3. Global variables and related presentation settings when needed.
4. Image metadata and references when relevant to the active note.

It may not write to any workspace entity other than the active note.

### Feasibility decision on GitHub Copilot

Panino should **not** base this feature on the assumption that a user can sign in with GitHub and then let Panino consume that user's GitHub Copilot entitlement.

Current public documentation reviewed for this task supports the following safe conclusions:

1. GitHub OAuth documentation describes how a third-party app gets GitHub API access on behalf of a user.
2. GitHub Copilot documentation describes Copilot features, supported integrations, and agent/customization concepts in GitHub-supported surfaces.
3. GitHub Models documentation describes a separate inference API and model-development workflow.
4. The reviewed public docs do **not** describe a supported way for a third-party web app to embed Copilot Chat or bill inference usage directly against an end user's Copilot subscription.

### Consequence for the spec

This feature should be treated as a **Panino AI feature** with a pluggable provider layer, not as embedded Copilot.

Recommended provider strategy:

1. **V1 recommended**: deployment-managed provider credentials or user-supplied API key / PAT stored securely by Panino.
2. **Reasonable GitHub-hosted option**: support GitHub Models only through an authentication path GitHub documents for custom applications.
3. **Future-only**: if GitHub later documents a supported OAuth or GitHub App path for user-billed Models or Copilot-style inference in third-party apps, Panino can add a GitHub-linked provider adapter.

---

## 4) User Experience

### Entry point

Add **AI** as a view-level pane toggle in the main editor workspace.

Recommended surfaces:

1. **View -> AI** toggle, alongside `Documents`, `Editor`, and `Preview`.
2. Optional secondary entry in **Tools** for provider setup or AI settings.

### Pane behavior

On desktop:

1. The AI pane appears as an additional right-hand pane in the main content area.
2. It can coexist with Editor and Preview.
3. It is resizable like the existing editor/preview panes.

On mobile:

1. The AI pane should not try to render as a third compressed column.
2. It should open as a full-height stacked panel or drawer-like full-screen workspace section.
3. The composer remains fixed to the bottom.

### Pane structure

Recommended layout:

1. **Header**
   - `AI Editor`
   - Current note title
   - A clear badge such as `Can edit this note only`
   - Provider/model status

2. **Context strip**
   - Always-visible chips for `Current note`, `Selection` if present, and `Workspace search enabled`
   - Expandable details showing which additional notes were read during the last turn

3. **Conversation area**
   - User messages
   - Assistant responses
   - Tool activity summaries such as `Searched workspace`, `Read note`, `Prepared edit`
   - Pending edit cards with diff preview and `Apply` / `Discard`

4. **Composer**
   - Single text box pinned to the bottom
   - Send button
   - Stop button while streaming
   - Optional quick actions: `Ask`, `Rewrite selection`, `Summarize note`, `Fix markdown`

### Empty states

If no note is open:

1. The pane may still render.
2. The composer is disabled.
3. The pane shows: `Open a note to use AI editing.`

If a provider is not connected:

1. The pane remains visible.
2. The composer is disabled.
3. The pane shows a provider setup action.

### Editing model

The AI pane supports two output classes:

1. **Answer-only**
   - The assistant explains, summarizes, or brainstorms.
   - No note change is proposed.

2. **Edit proposal**
   - The assistant returns a proposed new version of the active note.
   - Panino shows a diff preview before any write occurs.
   - The user chooses `Apply` or `Discard`.

V1 should default to **preview-first editing** rather than silent auto-apply.

---

## 5) Harness Model

### Why the harness should be browser-orchestrated

Panino's most important note state lives on the frontend:

1. The current note draft may be ahead of the synced DB row.
2. The current selection and cursor exist only in the editor instance.
3. Workspace reads already happen efficiently via the frontend local SQLite store.

Because of that, the AI harness should be orchestrated in the browser:

1. The browser manages the tool-calling loop.
2. The browser executes read tools against local workspace state.
3. The browser holds pending diffs and applies approved note writes.
4. The backend only handles provider auth, secret storage, and inference proxying.

### High-level loop

The loop is intentionally similar to an agent harness, but much narrower:

```text
while (not done and rounds < limit):
  build prompt from:
    - system instructions
    - stable tool schema
    - note-scoped safety rules
    - conversation history
    - latest tool results

  stream model response through backend proxy

  if response requests read tools:
    execute read tools in browser
    append tool results
    continue

  if response requests write tool:
    convert to pending edit proposal
    stop loop and wait for user approval

  if response is final text:
    render final text and stop
```

### Stop conditions

The loop stops when:

1. The model returns a final answer with no tool calls.
2. The model requests a note write, which becomes a pending user approval step.
3. The tool round limit is reached.
4. The user presses `Stop`.
5. The provider returns a non-recoverable error.

### Recommended limits

1. Max tool rounds per turn: `8`
2. Max workspace notes read automatically in one turn: `5`
3. Max raw note bytes per tool result before truncation: `16 KB`
4. Max full request budget target: keep under a conservative provider-specific threshold, with older history summarized first

### Prompt assembly

Every inference round should include:

1. Stable system instructions
2. Stable tool definitions
3. Stable product guardrails:
   - edit active note only
   - no external fetch
   - no secret access
   - no writes without approval
4. Conversation history for this pane session
5. Latest tool results

The prefix should remain as stable as possible between rounds so provider-side prompt caching can help when available.

### History compaction

If the conversation gets too long:

1. Keep the latest user turns and latest tool results verbatim.
2. Replace older turns with a compact session summary.
3. Preserve unresolved user intent, current note scope, and pending constraints in the summary.

V1 does not require a separate background summarizer process. A simple on-demand compaction step is sufficient.

---

## 6) Tool Contract

The model should not receive arbitrary SQL or arbitrary mutation tools. It should receive a fixed typed toolset.

### Auto-executable read tools

1. `get_active_note`
   - Returns active note id, title, folder path, current draft content, and content hash.
   - Uses draft state when available, not only the last synced DB row.

2. `get_active_selection`
   - Returns current selected text and surrounding context if the editor exposes it.
   - If no selection exists, returns empty state.

3. `search_workspace`
   - Full-text search across note titles and content using local data.
   - Returns ranked result summaries, not entire note bodies.

4. `read_note`
   - Returns one specific note's title, folder path, and truncated content.
   - Read-only.

5. `list_folder`
   - Returns a folder's child notes and folders.

6. `get_globals`
   - Returns global variables and other note-rendering context relevant to rewriting.

7. `list_images_for_note`
   - Returns image references and metadata associated with the active note when useful.

### Approval-gated write tool

1. `replace_active_note`
   - Input: `baseContentHash`, `proposedContent`, `summary`
   - Constraint: may only target the currently active note
   - Behavior: creates a pending diff preview, not an immediate mutation

V1 should use **whole-note replacement** rather than range edits.

Rationale:

1. Panino already has a clear note-level content update path.
2. Whole-note replacement is simpler to diff, validate, and rebase.
3. It avoids editor-selection edge cases while still enabling useful rewriting.

### Hard guardrails

1. There is no tool for writing any non-active note.
2. There is no tool for deleting notes.
3. There is no tool for creating notes or folders.
4. There is no tool for arbitrary network access.
5. There is no tool for arbitrary SQL execution.

If the model attempts to ask for a forbidden action, the harness returns a structured tool error and continues.

---

## 7) Edit Application Model

### Proposal flow

When the model requests `replace_active_note`:

1. The frontend verifies the `baseContentHash` matches the current active draft.
2. The frontend computes a visual diff between the current note and `proposedContent`.
3. The pane renders a pending edit card with:
   - summary
   - diff preview
   - apply button
   - discard button

### Apply flow

If the user clicks `Apply`:

1. The frontend re-validates that the note is still the active note.
2. The frontend re-validates that the content hash still matches.
3. The frontend updates the note through the existing content update path.
4. The existing debounce/save/sync pipeline persists the change.

### Conflict handling

If the note changed after the proposal was generated:

1. The pending diff is marked stale.
2. `Apply` is disabled.
3. The user can rerun the request against the latest draft.

### Undo behavior

V1 can rely on the existing editor undo stack and note revision features already present in Panino.

Optional improvement:

1. Create a manual revision checkpoint before apply when revision history is available.
2. Defer this if it materially complicates the first implementation.

---

## 8) Context Strategy

### Default context

Every new user turn should include, without requiring tool calls:

1. Active note title
2. Active note draft content
3. Active note folder path
4. Current selection if present
5. Current date/time and lightweight app context

### On-demand workspace context

The model may pull more context via tools, but Panino should not eagerly dump the whole workspace into every prompt.

Reasons:

1. Token cost
2. Privacy minimization
3. Better relevance
4. Faster responses

### Search-first retrieval

Workspace context should follow a search-first pattern:

1. Search workspace
2. Read one or more matching notes
3. Synthesize answer or edit

This mirrors Panino's local-first architecture better than a heavy precomputed index in v1.

### Context disclosure in UI

The pane should show which extra context was used in the latest turn, for example:

1. `Read note: Weekly plan`
2. `Read note: Project ideas`
3. `Loaded globals`

That disclosure helps the user understand why a response mentioned other notes.

---

## 9) Provider Model

### Provider abstraction

The AI feature should use a provider adapter layer similar in spirit to the backup provider split already used elsewhere in the repo.

Each provider adapter should answer:

1. How does the user connect or configure access?
2. Which models are available?
3. How are chat completions streamed?
4. How are tool calls represented?
5. Does the provider support reasoning / structured tool calling natively?
6. How are errors normalized?

### Supported provider modes

#### Mode A: Deployment-managed provider

Panino operators configure one provider API key in server env.

Pros:

1. Simplest UX
2. Fastest to ship
3. No per-user credential storage UI

Cons:

1. Operator pays for usage
2. Harder to map cost to individual users

#### Mode B: User-managed key or PAT

User enters a provider key or token into Panino settings.

Pros:

1. Clear user-owned billing path
2. Works today for many vendors
3. Compatible with a future GitHub Models PAT flow if desired

Cons:

1. Worse UX than OAuth
2. More sensitive credential handling burden

#### Mode C: OAuth or GitHub App linked provider

Use only when the provider documents a supported auth flow for Panino's use case.

Pros:

1. Better UX
2. Better token lifecycle management

Cons:

1. Depends on official provider support
2. Must not be inferred from Copilot marketing or unrelated OAuth docs

### Recommended v1 direction

Ship v1 with **one provider mode that is clearly implementable today**.

Most pragmatic order:

1. Deployment-managed provider or user-managed key
2. Optional GitHub Models adapter if Panino accepts a documented auth path such as user PAT or another officially supported route
3. Defer any `GitHub account -> Copilot entitlement` story until GitHub explicitly documents it for third-party apps

---

## 10) Backend Responsibilities

The backend should not own workspace retrieval for the active note flow. It should own the secure parts.

### Responsibilities

1. Store provider credentials securely.
2. Handle OAuth or provider setup flows when supported.
3. Proxy inference requests so secrets are never exposed to the browser.
4. Stream provider output back to the browser.
5. Normalize provider responses into one chat/tool-calling format.
6. Enforce auth and per-user rate limits.

### Suggested API routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ai/providers` | List providers available to this deployment and current user |
| `GET` | `/ai/providers/:provider/status` | Connected/configured/model status |
| `POST` | `/ai/providers/:provider/connect` | Start OAuth if the provider supports it |
| `GET` | `/ai/providers/:provider/callback` | OAuth callback |
| `POST` | `/ai/providers/:provider/credentials` | Save user-managed token / key |
| `DELETE` | `/ai/providers/:provider/credentials` | Clear saved credentials |
| `POST` | `/ai/chat/stream` | Stream one model round with tool schema and messages |
| `GET` | `/ai/models` | Optional model catalog for configured providers |

### Response normalization

The backend should present one normalized shape to the frontend regardless of provider:

1. streamed assistant text deltas
2. tool call requests
3. completion reason
4. usage metadata if available
5. provider/model identifiers

---

## 11) Frontend Responsibilities

### New components and stores

Suggested additions:

1. `frontend/src/components/AiEditorPane.vue`
2. `frontend/src/store/aiPaneStore.js`
3. `frontend/src/components/AiProviderModal.vue` or a provider settings surface embedded in the pane

### Expected integrations

1. `ContentArea.vue`
   - Add optional AI pane rendering and resizing

2. `uiStore.js`
   - Add `showAiPane`
   - Persist pane visibility like the other workspace panes

3. `SubMenuBar.vue`
   - Add View toggle for AI
   - Add optional Tools entry for provider/settings if needed

4. `editorStore.js`
   - Ensure the AI layer can read selection and current content hash through the editor bridge or adjacent store state

5. `draftStore` / `docStore`
   - Provide active draft content and stable update pathway for approved replacements

### Browser-side harness store responsibilities

The AI pane store should manage:

1. provider selection and status
2. current thread messages
3. current tool loop state
4. pending tool results
5. pending edit proposal
6. stop/cancel behavior
7. context disclosure for the last turn

---

## 12) Data Model

### Backend per-user provider config

Add a new backend-only table for AI provider credentials and preferences.

Suggested table: `ai_provider_config`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | UUID |
| `provider` | TEXT | Provider identifier |
| `auth_mode` | TEXT | `deployment`, `token`, `oauth` |
| `access_token_enc` | TEXT | Encrypted token or API key |
| `refresh_token_enc` | TEXT | Optional encrypted refresh token |
| `token_expires_at` | TEXT | Optional expiry timestamp |
| `model_id` | TEXT | User-selected default model |
| `provider_base_url` | TEXT | Optional custom API base |
| `created_at` | TEXT | ISO 8601 |
| `updated_at` | TEXT | ISO 8601 |
| `last_error` | TEXT | Last provider setup or auth error |

### Frontend local UI settings

Extend the existing `uiSettings` payload in `settings` with:

1. `showAiPane`
2. optional `aiPaneWidth`
3. optional `aiContextDisclosureExpanded`

### Conversation persistence

V1 recommendation:

1. Keep AI conversation history **ephemeral in memory only**.
2. Do not sync it.
3. Do not store it server-side.

Rationale:

1. Lower privacy risk
2. Lower schema complexity
3. Easier first implementation

---

## 13) Privacy And Security

### Data sent to providers

Panino should send only the context actually used in a turn:

1. active note content
2. selected text
3. any additional workspace snippets explicitly loaded through tools

It should **not** automatically send the entire workspace on every request.

### Secret handling

1. Provider credentials must never be exposed directly to the browser runtime.
2. Browser requests go through the authenticated Panino backend proxy.
3. Stored provider tokens use encryption at rest, similar to other sensitive provider credentials in the app.

### Hard safety rules

1. AI writes require explicit user approval.
2. AI writes only target the active note.
3. Provider prompts must exclude JWTs, auth tokens, backend env values, and unrelated internal config.
4. The harness should refuse any model attempt to access forbidden data classes.

### Logging

V1 should avoid storing raw prompt/response content in backend logs.

Acceptable operational logging:

1. provider id
2. model id
3. latency
4. token/tool counts if available
5. high-level error codes

---

## 14) Error Handling

### Provider/setup errors

1. If no provider is configured, disable the composer and show setup UI.
2. If auth expires, show reconnect UI and preserve the unsent user draft in the composer.

### Harness errors

1. If a tool call fails, show a compact inline tool error and let the loop continue when safe.
2. If the tool limit is reached, stop and tell the user to narrow the request.
3. If the provider stream errors, preserve the partial response already received.

### Edit errors

1. If the note changed since proposal generation, mark the proposal stale.
2. If the note is no longer active, discard the proposal.
3. If apply fails, keep the diff card visible and show a retry path when appropriate.

### Offline behavior

If Panino is offline or the API is unreachable:

1. The pane can stay visible.
2. The composer is disabled.
3. Existing thread content remains readable.
4. No provider calls are attempted.

---

## 15) Testing

This feature is incomplete without tests.

### Frontend unit tests

Add coverage for:

1. `uiStore` AI pane visibility persistence
2. AI pane empty states with no note selected
3. Tool loop stop behavior on final answer vs pending edit
4. Guardrail that only `replace_active_note` exists as a write tool
5. Stale edit detection via `baseContentHash`
6. Context disclosure rendering for read-note and search-tool activity

### Frontend integration tests

Add coverage for:

1. Opening and closing the AI pane from the View menu
2. Sending a message with an active note selected
3. Rendering a pending diff card from a mocked provider response
4. Applying an approved edit updates the current note only
5. Switching notes invalidates any pending edit tied to the prior note

### Backend tests

Add coverage for:

1. provider status routes
2. credential encryption and retrieval
3. inference proxy auth enforcement
4. normalized streaming response handling
5. provider-specific error mapping

### Manual validation

Validate with browser tooling at minimum:

1. Desktop layout with Documents + Editor + Preview + AI visible
2. Mobile layout does not collapse into an unusable three-pane stack
3. Streaming responses render cleanly
4. Pending diff preview is understandable and apply/discard works
5. No console errors are introduced

---

## 16) Rollout Plan

### Phase 1: Pane Shell And Read-Only Chat

1. Add UI pane and composer
2. Add provider config/status surface
3. Add backend inference proxy
4. Add browser-side loop with `get_active_note` only
5. Ship answer-only chat with no note mutation yet

### Phase 2: Workspace Retrieval

1. Add `search_workspace`, `read_note`, `list_folder`, and `get_globals`
2. Add context disclosure UI
3. Tune context truncation and ranking

### Phase 3: Active Note Editing

1. Add `replace_active_note`
2. Add pending diff preview
3. Add stale-hash conflict handling
4. Validate apply path against existing draft/save flow

### Phase 4: Provider Maturity

1. Add additional providers behind the same normalized backend contract
2. Add user-managed credential UX if not already present
3. Revisit GitHub-hosted options only if the auth path is officially documented for Panino's use case

---

## 17) Open Questions

1. Which provider path should v1 actually ship with: deployment-managed, user-managed key, or both?
2. Should the AI pane open by default for first-time users, or stay opt-in from the View menu?
3. Should Panino create a manual revision checkpoint before every AI-applied edit, or rely on undo/revision features already present?
4. Is lexical SQLite search sufficient for v1 workspace retrieval, or is semantic retrieval important enough to justify a later phase?
5. Should the pane support note-scoped sessions that survive page reload locally, or should thread history remain ephemeral?

---

## 18) Recommendation

The most defensible first version is:

1. A **Panino-native AI pane** in the existing editor workspace
2. A **browser-orchestrated harness** with typed read tools and one approval-gated write tool
3. **Workspace-wide read, active-note-only write** as the hard product rule
4. A provider layer that ships with a path Panino can implement today without depending on undocumented Copilot entitlement reuse

That gives Panino a real AI editing surface while staying consistent with the app's local-first architecture and keeping provider risk contained.