# PDF Render Hardening

> Contain the server-side Chromium used by `POST /render-pdf`, so user styling cannot run code,
> reach the server's network, or read secrets, without removing any styling capability users have
> today.
> Status: active — Phases 1–3 shipped 2026-10-25 (see
> `docs/agent-logs/2026/10/2026-10-25_18-10_pdf-render-hardening.md`); Phase 4 (renderer in its
> own container) not started.
> Created: 2026-10-24
> Last updated: 2026-10-25
> Implementation: `backend/api-service/pdf.js`, `backend/api-service/pdfSanitize.js`,
> `backend/api-service/imageFetch.js`, `shared/printStyleRules.js`,
> `frontend/src/utils/printStyleValidation.js`, `frontend/src/components/StyleCustomizer.vue`
> Deviations: Phase 3 uses `node:http`/`node:https` with a pinned socket `lookup` instead of an
> undici `Agent` (Node does not expose its bundled undici; no new dependency needed). CSS `url()`
> and `@import` also allow the two Google Fonts hosts, matching the request allow-list.

---

## 1) Summary

Every authenticated user, and signup is public, can get their own markup and script executed by the
headless Chromium that renders PDFs. The HTML body is sanitized with DOMPurify, but the CSS and the
print-style settings are concatenated as raw text into the page Chromium loads, so they can close the
surrounding `<style>` block or `style` attribute and inject arbitrary markup.

Three properties of the renderer turn that into a serious exposure:

- JavaScript is enabled and outbound requests from the page are unfiltered, so injected script can
  call any address the container reaches (`localhost:8000`, the Docker network, the VPS metadata
  service) and write the response into the PDF it returns. The existing DNS/private-IP check only
  covers `<img>` tags the server embeds itself; the browser's own requests bypass it.
- Chromium runs with `--no-sandbox` in the same container as the API, which holds `JWT_SECRET`,
  `SMTP_PASS`, `GITHUB_CLIENT_SECRET`, and every user's and space's SQLite database and uploads.
  A renderer exploit is a container compromise.
- Requests are processed one at a time with no queue bound and no overall job timeout, so one
  hanging page stalls PDF export for everyone.

This spec closes those in four independently shippable phases. Phase 1 alone removes code execution
and network reach and is a small change to `pdf.js`.

---

## 2) Goals

1. Nothing in a `/render-pdf` request can execute script in the renderer.
2. The renderer cannot make network requests other than to Google Fonts and `data:` URLs.
3. Values in the request cannot break out of the CSS or attribute context they are placed in.
4. Server-side image fetches cannot be redirected or re-resolved to private addresses.
5. One request cannot block PDF export for other users indefinitely.
6. Raw internal errors are never returned to the client.
7. **No styling regression.** Users keep full control of layout through CSS: Custom CSS on the
   Styles and Print Styles pages, `<style>` blocks inside a Document, and `style` attributes.

## Non-goals

- Changing the request payload shape or the frontend export flows
  ([`pdfExport.js`](../../../frontend/src/utils/pdfExport.js), `PrintStylesPage.vue`,
  `phone/ExportSheet.vue`).
- Replacing Puppeteer or the header/footer and page-count mechanism.
- Rate limiting `/render-pdf` per user. Worth doing, tracked separately.

---

## 3) Current state

All locations are in [`backend/api-service/pdf.js`](../../../backend/api-service/pdf.js).

### 3.1 Injection points

| Input | Where it lands | Current handling |
|---|---|---|
| `cssStyles` | `<style>` in `buildHtmlDocument` | Single-pass removal of `</style>` (L535); a nested string survives |
| `printStyles.customCSS`, per-element values, object keys | `<style>` via `printStylesToCss` (L116-146) when `cssStyles` is empty | None |
| `printStyles.googleFontFamily` primary font | `body { font-family: "…" }` (L130-133) | Quotes removed only |
| `pageSize`, `pageMargin`, `headerHeight`, `footerHeight` | `@page` rule (L470-473) | None |
| `headerFontColor`, `footerFontColor`, `pageMargin` | Header/footer `style="…"` attribute (L433-437) | None |
| `printHeaderHtml`, `printFooterHtml` | Header/footer templates | DOMPurify, adequate |
| `htmlContent` | `<body>` | DOMPurify with `style` attributes allowed, adequate for markup |

### 3.2 Renderer configuration

- `puppeteer.launch` with `--no-sandbox --disable-setuid-sandbox` (L364-372).
- JavaScript enabled, no request interception (L579-588).
- Same container and environment as the API ([`docker-compose.yml`](../../../docker-compose.yml)).

### 3.3 Server-side image fetch (`fetchExternalImageAsDataUri`, L216-273)

- `fetch` follows redirects without re-checking the target, already noted in
  [pdf-pipeline.md](../../architecture/pdf-pipeline.md).
- DNS is resolved for the check and again by `fetch`, so the checked address and the connected
  address can differ.
- `isPrivateIp` misses IPv4-mapped IPv6 (`::ffff:…`), `::`, `100.64.0.0/10`, and `198.18.0.0/15`.
- When a fetch fails, the original URL is kept in the HTML (L326, L333), so Chromium then fetches it
  directly and unchecked.

### 3.4 Other

- `processQueue` returns `error.message` to the client (L402).
- `queue` is unbounded and `page.pdf()` has no job-level deadline.

---

## 4) Why it is exposed

Each step was reasonable in isolation:

1. **Custom CSS and per-element styling.** The Styles and Print Styles pages let users write CSS so
   the PDF matches the in-app preview. The frontend builds `markdownStore.printStylesCssString` and
   sends it verbatim; the server rebuilds the same string the same way. The CSS was treated as
   trusted because it is "the user's own styles", but it is rendered by the server, inside the
   server's network.
2. **Paged.js.** About 30 commits around January 2026 ran Paged.js in the page, which needed
   JavaScript. `85a78b3` moved to Puppeteer's native header/footer templates and pdf-lib page
   counting, but JavaScript stayed on although nothing uses it any more.
3. **Network access for fonts and images.** Rendering needs `fonts.googleapis.com` and, originally,
   internal images over `INTERNAL_API_URL` (`localhost:8000`), which is why Chromium shares the API
   container. Images are now pre-embedded as `data:` URIs, but the network access was never narrowed.

---

## 5) Design

### Phase 1: contain the browser

Small, all in `pdf.js`, ships alone.

1. **Disable JavaScript.** `await page.setJavaScriptEnabled(false)` before `setContent`. Nothing in
   the pipeline uses it: images are pre-embedded, and page numbers come from Puppeteer's templates
   and `countPdfPages`.
2. **Allow-list requests.** `await page.setRequestInterception(true)` and allow only:
   - `data:` URLs
   - `https://fonts.googleapis.com/*` and `https://fonts.gstatic.com/*`, only when
     `ENABLE_REMOTE_FONTS` is true

   Abort everything else and log the blocked origin, not the full URL. Header and footer templates
   are rendered by Chromium without page network access, so they need nothing extra.
3. **Generic errors.** Replace the `error.message` response with a fixed
   `PDF generation failed` message; log the detail server-side.
4. **Bound the queue.** Cap queue length (initial value 20) and reply `503` with `Retry-After` when
   full. Wrap each job in an overall deadline (initial value 45s, under the frontend's 90s
   `PDF_TIMEOUT_MS`), and close the browser context on timeout so the next job starts clean.

After Phase 1, a style break-out can still inject markup but cannot run code or fetch anything, so
it can affect only the requester's own PDF.

### Phase 2: remove the injection

5. **Validate structured print-style fields.** Each falls back to its `PRINT_STYLE_DEFAULTS` value
   when it does not match:

   | Field | Accepted |
   |---|---|
   | `pageSize` | A value in `PAPER_SIZES` (`A4`, `Letter`) |
   | `pageMargin`, `headerHeight`, `footerHeight` | `/^\d+(\.\d+)?(cm|mm|in|px|pt)$/` |
   | `headerFontColor`, `footerFontColor` | Hex `#rgb`/`#rrggbb` or `rgb()`/`rgba()` with numeric arguments |
   | `headerFontSize`, `footerFontSize` | Integer 6–72 (already parsed with `parseInt`) |
   | `headerAlign`, `footerAlign` | Already allow-listed |
   | `googleFontFamily` entries | `/^[\w\s-]+$/` |
   | Per-element style keys | The known selector set in `PRINT_STYLE_DEFAULTS`; unknown keys dropped |

   Move the validation into a shared module so the frontend Styles pages can use the same rules and
   show invalid values instead of having them silently replaced.

6. **Parse and re-serialize all CSS.** Run `cssStyles`, `customCSS`, and every per-element value
   (wrapped as a declaration list) through a CSS parser (`css-tree`, which can parse declaration
   lists and serialize back) instead of stripping strings. Re-serialized output cannot contain
   `</style>` or close an attribute, so break-out becomes structurally impossible while any valid
   CSS a user wrote is kept. During the walk:
   - drop `@import` unless it targets `https://fonts.googleapis.com/`
   - drop `url()` values that are not `data:`
   - keep everything else, including `@page`, `@media print`, `@font-face` with `data:` sources,
     grid, flex, columns, and `break-*` properties

   Content that fails to parse is dropped at the rule level, as browsers do, not the whole sheet.

7. **Keep `<style>` in Document content, sanitized the same way.** DOMPurify continues to allow
   `<style>` elements and `style` attributes in `htmlContent`. A `<style>` element cannot break out of
   itself once DOMPurify has parsed it, and after Phase 1 CSS can neither run code nor fetch. As
   defence in depth, and so the PDF matches what the request allow-list would render anyway, pass
   each `<style>` element's text and each `style` attribute through the item 6 sanitizer via a
   DOMPurify `uponSanitizeElement` / `uponSanitizeAttribute` hook.

### Phase 3: fix the server-side image fetch

8. - `redirect: 'manual'`, following at most 3 hops, re-running the address check on each.
   - Connect to the checked address: use an undici `Agent` with a `connect.lookup` that returns the
     pre-validated IP, with the original hostname kept for TLS SNI and the `Host` header.
   - Replace `isPrivateIp` with `ipaddr.js`: parse, unwrap IPv4-mapped addresses, and allow only
     `range() === 'unicast'`.
   - Enforce the 5 MB limit while streaming, not after buffering the whole body.
   - On a failed or blocked fetch, replace the image with an empty placeholder instead of keeping
     the original URL. With Phase 1 in place Chromium would block it anyway; this makes the output
     deterministic and the log accurate.

### Phase 4: isolate the renderer

Deployment change. Needs explicit approval, a backup, and an agent log per
[AGENTS.md §4](../../../AGENTS.md).

9. - Move Puppeteer into a `pdf-renderer` service: no secrets in its environment, no data or
     uploads volumes, its own internal network that the API can reach, and outbound access limited
     to Google Fonts.
   - The API keeps authentication, sanitization, and image embedding, and sends the renderer the
     final HTML plus PDF options.
   - Run Chromium with its sandbox enabled (non-root user plus a seccomp profile that permits the
     sandbox's namespaces), dropping `--no-sandbox`.
   - Remove the stale `INTERNAL_API_URL` comment from the compose file once nothing reads it.

---

## 6) Compatibility

| Capability today | After this spec |
|---|---|
| Custom CSS on Styles / Print Styles pages | Unchanged |
| `<style>` blocks and `style` attributes in a Document | Unchanged |
| `@page` rules, margins, columns, grid, flex, page breaks | Unchanged |
| Google Fonts via `googleFontFamily` or `@import` | Unchanged |
| Uploaded images (personal and space), `data:` images | Unchanged |
| External `<img>` on public hosts | Unchanged (fetched and embedded by the server) |
| Header/footer HTML, images, `%p` / `%P` | Unchanged |
| A3 or other paper sizes sent by a hand-built request | Fall back to A4; the UI only offers A4 and Letter |
| CSS `url()` to an external host (e.g. a hot-linked background) | **Dropped.** See open question 1 |
| Script in any field | Dropped (already intended; now enforced) |

---

## 7) Tests

Add to [`tests/integration/pdf.test.js`](../../../backend/api-service/tests/integration/pdf.test.js)
and a new `tests/unit/pdfSanitize.test.js`. All backend tests run via `npm run test:be`.

**Unit (sanitizer and validators)**
- Each injection point in §3.1 with a break-out string: output parses as a single stylesheet or
  declaration list and contains no markup.
- `@import` to Google Fonts kept; any other `@import` dropped.
- `url(data:…)` kept; `url(https://…)` and `url(http://…)` dropped.
- Valid layout CSS (`@page`, `columns`, grid, `break-before`) round-trips unchanged in meaning.
- Each structured field rejects malformed input and falls back to its default.
- `ipaddr`-based check rejects IPv4-mapped loopback, `::`, CGNAT, and benchmark ranges.

**Integration (real Puppeteer)**
- A request whose CSS references a local HTTP test server on a random port: the server sees no
  request. Covers break-out markup, CSS `url()`, and `<style>` inside the Document.
- `data:` image and an uploaded image still render (existing image tests continue to pass).
- A Document with its own `<style>` block setting `@page` margins and a two-column layout renders,
  and its page count differs from the same Document without the block.
- External image whose host redirects to a private address is not embedded.
- The 500 response body is the fixed message.
- Queue full returns `503`; a job exceeding the deadline returns an error and the next job succeeds.
- Existing header/footer, page-number, concurrency, auth, and 400 tests still pass.

**Browser validation** (dev stack, per [AGENTS.md §1](../../../AGENTS.md))
- Export from the Print Styles page and from the phone Export sheet with the default styles, with
  Custom CSS, and with a Document containing a `<style>` block; compare against the pre-change PDF.

---

## 8) Rollout

| Phase | Scope | Risk |
|---|---|---|
| 1 | `pdf.js` only | Low. Only change in output is the unchecked-fallback image case |
| 2 | `pdf.js`, new shared sanitize module, one dependency (`css-tree`) | Medium. Diff exported PDFs for the default and a few customized style sets before merging |
| 3 | `pdf.js`, one dependency (`ipaddr.js`), `undici` already in Node 24 | Low |
| 4 | `docker-compose*.yml`, new Dockerfile, `deploy.sh`, Nginx unaffected | Medium. Production deploy; follow the deploy pre-flight |

Phases 1–3 can ship as one PR or three. Phase 4 is its own PR and deploy.

On completion, update [pdf-pipeline.md](../../architecture/pdf-pipeline.md) with the threat model
and the request allow-list, update the PDF section of
[backend/api-service/AGENTS.md](../../../backend/api-service/AGENTS.md), and correct
[collab-04-shared-spaces.md §4.6](../proposed/collab-04-shared-spaces.md), which says the SSRF checks "stay
exactly as they are".

---

## 9) Open questions

1. **External CSS `url()`.** Should background images and similar from external hosts be supported?
   If yes, route them through the Phase 3 fetch-and-embed path (rewrite to `data:` before render)
   rather than widening the allow-list.
2. **Self-hosted fonts.** Serving the default fonts from the renderer image would remove the last
   external dependency and allow a deny-all request policy. Worth it for Phase 4?
3. **Queue cap and deadline values.** 20 and 45s are starting points; check production PDF timings
   before fixing them.
