# Spec AI Editor Pane

**Agent:** GitHub Copilot (GPT-5.4)
**Started:** 2026-03-28 09:20
**Status:** completed

## Objective
Draft a concrete spec for an AI editor pane in Panino, including the harness model, workspace-scoped read behavior, active-note-only edit constraints, and provider feasibility guidance.

## Progress
- [x] Review repository and layer-specific agent instructions
- [x] Inspect existing spec patterns and current editor/layout integration points
- [x] Inspect existing provider and OAuth patterns in the GitHub backup implementation
- [x] Verify the feasibility boundary around GitHub OAuth, Copilot, and GitHub Models using current public documentation
- [x] Draft the AI editor pane spec with UX, harness, provider, security, and rollout details

## Changes Made
- `docs/specs/ai-editor-pane.md` — added a new product and technical spec for a Panino-native AI editor pane, including UI behavior, browser-orchestrated harness design, tool contract, provider abstraction, security constraints, and rollout plan.
- `docs/agent-logs/2026-03-28_09-20_spec-ai-editor-pane.md` — recorded this spec-writing session.

## Tests
- No code changes.
- No automated tests run.
- Reviewed current public documentation for GitHub OAuth, GitHub Copilot docs, and GitHub Models to ground the provider feasibility section.

## Open Items / Notes
- The spec intentionally avoids assuming that GitHub OAuth can unlock a user's Copilot subscription inside Panino.
- The recommended first implementation is a Panino-native harness with a provider path Panino can support today, such as deployment-managed inference or user-managed credentials.
- The current repo does not yet contain a checked-in `docs/specs/copilot-agent-editing.md` file, so this new spec stands on its own rather than amending an existing AI spec document.

## Follow-up 2026-03-28 10:32

### Objective
Compare Hugging Face and OpenRouter as user-authorized provider options for Panino, including OAuth fit and end-user cost burden.

### Progress
- [x] Verify Hugging Face OAuth support for the `inference-api` scope
- [x] Verify OpenRouter OAuth PKCE support and user-controlled API key exchange
- [x] Gather current pricing and billing rules for Hugging Face Inference Providers
- [x] Gather current pricing and billing rules for OpenRouter
- [x] Gather representative model prices to estimate monthly cost under example token assumptions

### Changes Made
- No repository code changes.
- Extended the provider feasibility research with current pricing and billing data for Hugging Face and OpenRouter.

### Tests
- No code changes.
- Reviewed current public documentation for Hugging Face OAuth, Hugging Face Inference Providers pricing, OpenRouter OAuth, and OpenRouter pricing/model pages.

### Open Items / Notes
- Exact monthly cost cannot be derived from request count alone; it depends mainly on input and output token volume per request and the chosen model.
- Hugging Face is the clearest documented fit for true OAuth-based inference on behalf of the user.
- OpenRouter also fits a user-funded model, but the delegated asset is an OpenRouter account or credits balance rather than a third-party consumer subscription.