# PDF pipeline

PDF rendering is implemented in `backend/api-service/pdf.js`, with three helpers:
`pdfSanitize.js` (CSS sanitation and the renderer request policy), `imageFetch.js`
(server-side image fetch with SSRF protections) and the shared
`shared/printStyleRules.js` (validation of the structured print-style settings, also used by
the Print Styles page for inline hints).

Authenticated requests enter a sequential, bounded queue. The print-style settings are
validated, user HTML and CSS are sanitized, internal images are embedded from the uploads
directory and external images are fetched server-side and embedded as `data:` URIs. Puppeteer
renders the page with JavaScript disabled and a request allow-list, and `pdf-lib` resolves
page-count-dependent output.

This is a short reference; update it when the rendering mechanism changes. The backend layer
handbook remains the entry point for route and testing conventions.

## Threat model

Every authenticated user, and signup is public, can have their own markup and CSS rendered by
the server's Chromium, which runs in the API container next to the secrets and every user's
database. The renderer is therefore treated as hostile input processing:

| Risk | Control |
|---|---|
| Script execution in the renderer | `page.setJavaScriptEnabled(false)`; DOMPurify on all HTML fragments |
| Requests from the renderer to the API, the Docker network or the host's metadata service | Request interception: only `data:`, `about:` and, when remote fonts are on, `https://fonts.googleapis.com/` and `https://fonts.gstatic.com/`. Everything else is aborted and logged by origin |
| CSS or a setting closing the `<style>` block or a `style` attribute | Every CSS input (request stylesheet, Custom CSS, per-element values, `<style>` text and `style` attributes in the Document) is parsed with css-tree and re-serialized; unparsable text is dropped at the rule or declaration level; `</` cannot appear in the output. Structured settings (paper size, lengths, colours, font sizes, alignment, font names, element keys) are validated against `printStyleRules.js` and fall back to the defaults |
| `@import` and `url()` reaching other hosts | Dropped unless `data:`, a fragment, or Google Fonts. The request allow-list would block them anyway |
| SSRF through the server-side image fetch | Every hostname is resolved first and every address must be public unicast (`ipaddr.js`, IPv4-mapped unwrapped); the socket is pinned to the checked address with the hostname kept for SNI and `Host`; redirects are followed manually for at most 3 hops with the check repeated; the 5 MB limit is enforced while streaming; a failed or blocked image becomes a placeholder comment, never the original URL |
| One request stalling export for everyone | Queue cap (`PDF_QUEUE_LIMIT`, default 20) answers `503` with `Retry-After`; each job has a deadline (`PDF_JOB_TIMEOUT_MS`, default 45 s, under the frontend's 90 s) after which the client gets a fixed `504` and the job's browser context is closed |
| Internal detail in responses | Fixed messages: `PDF generation failed`, `PDF generation timed out`, `PDF service busy, try again shortly`; detail is logged server-side |

Not yet done (Phase 4 of `docs/specs/active/pdf-render-hardening.md`): moving Chromium into
its own container without secrets or data volumes and with its sandbox enabled. Until then a
renderer exploit is still a container compromise; the controls above remove the known ways to
reach the renderer with code or requests.

## What users keep

Custom CSS on the Styles and Print Styles pages, `<style>` blocks and `style` attributes in a
Document, `@page`, `@media print`, columns, grid, flex, page breaks, `@font-face` with `data:`
sources, Google Fonts through the font setting or `@import`, uploaded and `data:` images, and
external images on public hosts (fetched and embedded by the server). Dropped: CSS `url()` to
external hosts (hot-linked backgrounds), paper sizes other than A4 and Letter, and script.

## Puppeteer version gotchas (found bumping 22 -> 25 in DX-10)

- `Browser.isConnected()` was removed; use the `browser.connected` boolean instead
  (`pdf.js` browser-reuse check).
- `page.pdf()` now returns a plain `Uint8Array`, not a Node `Buffer`. Express's `res.send()`
  only special-cases real `Buffer`s — handing it a `Uint8Array` silently falls through to the
  JSON-serialization branch and corrupts the response body. Wrap the result in
  `Buffer.from(...)` before `res.send()`.
- `page.setRequestInterception(true)` disables the browser cache for that page; fonts are
  fetched per render. Acceptable at current volumes.

Neither of the first two produced an obvious error; the second was only caught by an
integration test asserting on the response `Content-Type` header. Re-check both after any
future Puppeteer major bump.
