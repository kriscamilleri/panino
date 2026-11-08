# AI agents add-on (backend)

Lets outside AI agents and scripts read and write a user's Documents: personal API keys, the v1
REST API, an MCP server, and OAuth 2.1 sign-in for MCP clients ("connected apps"). Offered with
`AI_ADDON_ENABLED=true`; each user switches it on. While a user's switch is off, every key and
connected app of theirs is refused (403 `ADDON_DISABLED`) and nothing is deleted.

- Spec: [`docs/specs/shipped/ai-integration.md`](../../../../docs/specs/shipped/ai-integration.md)
  (keys and v1 rules: [`llm-api.md`](../../../../docs/specs/shipped/llm-api.md); properties, folders,
  Trash, revisions, images, templates and PDF: [`ai-api-expansion.md`](../../../../docs/specs/shipped/ai-api-expansion.md))
- How it works: [`docs/architecture/public-api.md`](../../../../docs/architecture/public-api.md)

## Manifest fields used

`routes` (session, gated), `publicRoutes` (REST, MCP and OAuth endpoints, each authenticating
itself), `wellKnown` (`oauth-protected-resource`, `oauth-authorization-server`), `schema.auth`
(tables on the auth database), `schema.content` (`ai_trash_origins`), `configWarnings`. No hooks, no background jobs.

## URLs

| | Path (production adds `/api`) | Credential |
|---|---|---|
| REST | `/addons/ai/v1/*`, `GET /addons/ai/v1/openapi.json` | API key |
| MCP | `POST /addons/ai/v1/mcp` | API key or OAuth access token |
| OAuth | `/addons/ai/oauth/{authorize,token,register,revoke}` | OAuth protocol |
| Discovery | `/.well-known/oauth-protected-resource[/…]`, `/.well-known/oauth-authorization-server` | none |
| Settings | `/addons/ai/{setup,keys,connections}`, `/addons/ai/oauth/requests/:id[/approve\|/deny]` | session |

Public URLs come from `PUBLIC_API_BASE_URL` and `FRONTEND_URL` (required in production; OAuth
answers 503 without them).

## Files

| File | Contents |
|---|---|
| `index.js` | Manifest and registration |
| `config.js` | Offered flag and every public URL |
| `schema.js` | Auth database: `api_keys`, `ai_oauth_clients`, `ai_oauth_requests`, `ai_oauth_grants`, `ai_oauth_codes`. Content databases (user and space): `ai_trash_origins` |
| `routes.js` | Composes the public and session routers |
| `serviceCore.js` | Shared rules of every operation: databases an agent reaches, row shapes, write rules (scope, live sessions, expected versions, size, revisions, announcing changes) |
| `documentService.js`, `documentText.js` | Documents: account, spaces, tree, search, list, read (whole, by lines, by section), outline, create, replace, exact edits, insertion, append; pure text helpers. The search query language, its term helpers and the word count are in `shared/searchText.js`, and the Trash rule and folder walks in `shared/trashFolder.js`, so the app's search reads a query the same way; `documentText.js` and `keyUtils.js` re-export the old names |
| `propertyService.js`, `propertyText.js`, `authorship.js` | Properties: built-in (word count, created and modified on and by, from revision history) and front matter; the filter language (in `shared/propertyFilter.js`, re-exported by `propertyText.js`); `searchByProperties`, the property scan behind a search's `prop:` parts |
| `folderService.js` | Folders and Trash: create, read, rename, move, trash, list Trash, restore (with `ai_trash_origins`) |
| `revisionService.js`, `lineDiff.js` | Revision history: list, read, compare (Myers line diff), save a checkpoint, restore (core `restoreNoteRevision`) |
| `imageService.js` | Images: list, read, usage, upload (core `storeImage`, plus a content check), delete if unused |
| `libraryService.js` | Templates (read, create from), global variables (read), PDF export (core `documentPdf.js`) |
| `api/` | One adapter per area (`documents`, `properties`, `folders`, `revisions`, `images`, `library`): MCP tools, REST routes, OpenAPI paths and next-step sentences; `toolKit.js`, `restKit.js`, `openapiKit.js` are the shared building blocks, `index.js` lists the areas |
| `restRoutes.js`, `openapi.js` | Mount every area's REST routes behind key authentication; merge their OpenAPI paths |
| `mcp.js`, `mcpTools.js` | MCP protocol layer (2025 and 2026 revisions, stateless); every area's tools, the error mapping and the server instructions |
| `agentAuth.js` | Resolves `pnk_` keys and `pna_` tokens, checks the switch, rate limit |
| `keys.js`, `keyUtils.js` | Key management routes and lookup; pure helpers |
| `oauth.js`, `oauthClients.js`, `oauthUtils.js` | Authorization server, client resolution (metadata documents through `safeFetch.js`, DCR), pure helpers |
| `tests/` | `unit/` (helpers, tool schemas), `integration/` (gate, REST, MCP, OAuth), `perf/` (opt-in load benchmark on an 87 MB account: `PANINO_PERF=1`, see the file's header), `aiTestSetup.js` |

## Search

`search_documents` / `GET /addons/ai/v1/search?q=` read `q` with the app's query language
(`docs/specs/active/advanced-search.md` §4, §6.5). Every part must match; existing word and
phrase queries give the same results as before. One example per part:

| Part | Example | Notes |
|---|---|---|
| words, `"phrases"` | `budget "quarterly review"` | the `in` parameter (`all` / `title` / `content`) still says which fields plain words must occur in |
| `title:` | `title:"team sync"` | the title only, whatever `in` says |
| `in:` | `in:Projects/2026`, `in:"Acme Team/Contracts"` | that folder and below; a space name may lead (`My Notes` for the personal database); with `folderId`, only Documents in both |
| `is:checklist` | `is:checklist` | at least one checklist item (SQL function `panino_has_checklist`, the shared rule) |
| `prop:` | `prop:status=draft`, `prop:"due <= 2026-12-01"`, `prop:status="in progress"` | one property filter condition; also `word_count`, `created_on`, `modified_on`, `created_by`, `modified_by`. Goes through the property scan (5000 Documents per database, `truncated`, `scanned`) |
| `-` | `-"old draft"`, `-in:Archive`, `-prop:status=done` | excludes, but only before a letter or a quote: `-5`, `--` and `-` alone stay words. Quote anything to search it literally: `"title:"`, `"-draft"` |
| `in:Trash` | `budget in:Trash` | Trash is left out unless asked: `in:Trash`, `includeTrash`, or a `folderId` inside it |
| `tag:` | `tag:urgent` | not available yet: a notice; a query of only `tag:` parts returns no results with it (200) |

A part that cannot be read is skipped and explained in `notices`; a query of exclusions only is
refused (400). The parity tests in `tests/integration/searchLanguage.test.js` run the app's
engine (`@panino/content-merge/document-search`) on the same databases and expect the same
Documents in the same order.
