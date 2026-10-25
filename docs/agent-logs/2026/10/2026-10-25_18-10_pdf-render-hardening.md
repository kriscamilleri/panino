# PDF render hardening (phases 1–3)

- Agent: Claude Code (Fable 5.1)
- Started: 2026-10-25 18:10
- Status: implemented on `feature/pdf-render-hardening`; see "Open Items" for what is left

## Objective

Implement `docs/specs/active/pdf-render-hardening.md` phases 1–3: contain the server-side
Chromium used by `POST /render-pdf` (no script, no network beyond Google Fonts), remove the CSS
and attribute injection points, harden the server-side image fetch, bound the queue, and keep
every styling capability users have today. Phase 4 (renderer in its own container) is a
deployment change that needs explicit approval and is not part of this work.

## Progress

1. Baseline: rendered a stress document (two uploaded images, two hot-linked images including
   one behind a redirect, four Google fonts via the font setting, `@import` and a `<style>`
   block with `@page` and columns) against the unchanged dev API and kept the PDF.
2. Shared rules: `shared/printStyleRules.js` validates paper size, lengths, colours, font
   sizes, alignment, font names and element keys; exported as
   `@panino/content-merge/print-style-rules`.
3. `backend/api-service/pdfSanitize.js`: css-tree parse and re-serialize for stylesheets and
   declaration lists; drops `Raw` nodes (css-tree keeps unparsable text verbatim, which is
   exactly how a break-out survives), non-allowed `@import`/`url()`/`image-set()` strings,
   `@namespace`, `@charset`; escapes any `</`. Also the renderer request allow-list.
4. `backend/api-service/imageFetch.js`: `ipaddr.js` public-unicast policy, socket `lookup`
   pinned to the checked address, manual redirects (3 hops, re-checked), streaming size
   limit, declared-length check.
5. `pdf.js`: JavaScript off, request interception, DOMPurify hooks for `<style>` and `style`,
   validated settings in `@page` and header/footer templates, placeholder for failed images,
   queue cap (503 + `Retry-After`), job deadline (504, context closed), fixed error messages.
6. Frontend: `printStyleValidation.js` plus a hint line in `StyleCustomizer` so the Print
   Styles page flags a value the server would replace.
7. Docs: `docs/architecture/pdf-pipeline.md` (threat model and controls), backend handbook
   PDF section, the collab-04 sentence about SSRF checks, spec moved to `active/`.

## Changes Made

See `git log main..feature/pdf-render-hardening`. Decisions and findings:

- **undici not used.** The spec suggested an undici `Agent` with `connect.lookup`; Node does
  not expose its bundled undici and the npm package would add a version to keep in step with
  the runtime. `node:http`/`node:https` accept a socket `lookup` option that does the same
  pinning with the hostname kept for SNI and `Host`.
- **Google Fonts hosts allowed in CSS `url()`/`@import`,** matching the request allow-list,
  so a user's own `@font-face` pointing at `fonts.gstatic.com` keeps working.
- **DOMPurify drops a leading `<style>`.** A fragment that starts with `<style>` is parsed
  into `<head>`, which DOMPurify discards. `FORCE_BODY: true` keeps it. Found by the
  integration test for a Document `@page` block; a direct render probe showed Chromium does
  honour a body `<style>` `@page` margin (8 → 22 pages with a 7cm margin).
- **`sanitizeDeclarations` output may contain `"`** (as string delimiters). It is never placed
  in an attribute by string concatenation: DOMPurify sets `style` through the DOM (entity
  escaped), per-element values go into a `<style>` block, header/footer attributes use only
  validated values.
- **supertest requests are lazy**; the queue-cap test must call `.then` to send the first two.
- Pre-existing, not changed: the preview in the browser shows alt text for hot-linked and
  raw `<img>` images (cross-origin isolation for the WASM database); the PDF embeds them
  server-side.

## Tests

- Shared: `npx vitest run` in `shared/` — 15 new tests (`printStyleRules.test.js`).
- Backend unit (host and Docker): `pdfSanitize.test.js` (39) and `imageFetch.test.js` (16),
  covering every §3.1 break-out string, import/url policy, layout CSS round-trips, address
  ranges (loopback, mapped, `::`, CGNAT, benchmark, 6to4, Teredo, NAT64), pinning, redirect
  re-check, hop limit, streaming cut-off, declared length, timeout.
- Backend integration (Docker, `npm run test:be`): `pdf.test.js` adds the local probe server
  that must see no request from any injection point, the raw-HTML containment test through
  `renderHtmlToPdf` (script, link, import, img, iframe, object, poster, header image),
  `data:` image, Document `<style>` `@page` page-count change, malformed settings fallback,
  and a real slow-render timeout followed by a successful job. `pdf.queue.test.js` mocks
  Puppeteer for the fixed 500 message, the 504 with context close, and the 503 queue cap.
  Full suite after the fixes: 33 files, 508 tests pass.
- Frontend: `printStyleValidation.test.js` (3); full suite 888 pass. `npm run lint` clean.
- Stress document (scratch script against the dev stack): before the `FORCE_BODY` fix the
  hardened output was byte-identical in size to the baseline, same 5 pages, same embedded
  fonts (Source Sans 3, Playfair Display, JetBrains Mono, Lora) and images, rasterized pages
  identical byte for byte. After the fix the same request renders with the Document's own
  `@page { margin: 2.5cm 1.5cm }` applied (its HTML starts with the `<style>` block, which
  main silently dropped), so the text reflows; re-rendering with that block removed is again
  identical to the baseline on all five pages. Fonts and images unchanged in both.
- Browser (Claude in Chrome, dev stack, 1406px): created "PDF Stress Document" with the same
  content, uploaded two images through the app, opened Customize Print Styles: 5-page PDF
  with header, both local images, both hot-linked images, code block, table, two-column
  page; typing `2em` into Side Margins shows the server-rule hint and `2cm` clears it.
  The API log shows no blocked renderer request and no replaced setting for that render.
- Browser at 375px (headless Chromium via the backend's Puppeteer, fresh account, scratch
  script `phone-export.mjs`): New note → content with a `<style>` block, a hot-linked image
  behind a redirect and a styled paragraph → Document options → Export as PDF → Download PDF.
  The `/render-pdf` call returned 200 `application/pdf`, one A4 page, image embedded (API log:
  "External fetched (15KB)"), Playfair Display and Source Sans 3 embedded.

## Adversarial review (second model, two reviewers)

Correctness reviewer findings and what was done:

- **High — image fetch had no absolute cap during the header phase.** `http.request`'s
  `timeout` is an idle timeout; a host trickling header bytes held the job open. Added a
  timer in `requestOnce` that destroys the request at the deadline; new unit test with a
  `net` server that trickles header bytes.
- **High — css-tree's tolerant parser is quadratic on malformed CSS** (298 KB → 0.4 s, 1.2 MB
  → 5.5 s) and runs on the API event loop with no bound. Added `CSS_LIMITS` (256 KB per
  stylesheet, 16 KB per declaration list) checked before parsing; `cssStyles`/`customCSS`
  over the cap answer `413 CSS too large`, `<style>` and `style` over it are dropped. Running
  the sanitizer in a worker thread is left as a follow-up.
- **Medium — nested rules without a leading `&` were dropped** (css-tree 3.2.1 keeps them as
  `Raw`, sometimes with the following declarations). `expandNestedRaw` re-parses such text as
  rules then declarations and splices back what parses cleanly; the url policy and break-out
  rules apply inside. Tests added with exact expected output.
- **Medium — the deadline used a module-global context**, so an abandoned job that reached
  the renderer late could have its context closed by a later job's timeout, and abandoned
  jobs kept rendering. Replaced with a per-job token: `job.aborted` is checked at each
  phase of `generatePdf` and before creating the context; the context lives on the job.
- Low — quoted Google font names (`"Source Sans 3"`) were dropped by the new validator;
  quotes are now stripped per entry. Low — `PDF_QUEUE_LIMIT=-5` would have refused every
  request; settings must now be positive integers. Low — the queue-cap test assumed arrival
  order; it now accepts either order. Nits — `processQueue()` rejections are caught, the
  settle timer is cleared, docs say "20 waiting" and name `about:` in the allow-list.

Reviewer's "checked and fine" covered: UI-producible values all validate; a 60-case CSS corpus
round-trips; `FORCE_BODY` fixes a real pre-existing bug; https pinning verified; shared
package subpath resolves in Vite and in both Dockerfiles; the `<!-- pagebreak -->` replacement
was already dead on main because DOMPurify strips comments.

## Open Items / Notes

- Phase 4 (separate `pdf-renderer` service, sandbox on, no secrets or volumes) is not
  started; it needs explicit approval, a backup and a deploy pre-flight.
- The session's Chrome window refused to resize to 375px, so the phone check ran in headless
  Chromium instead (above).
- Queue cap 20 and deadline 45 s are the spec's starting values; revisit with production
  timings.
- Follow-ups from review: run the CSS sanitizer in a worker thread so the job deadline can
  abandon it; `npm audit` reports a pre-existing DOMPurify advisory (`<=3.4.16`) that this PR
  does not change — with JavaScript off in the renderer it cannot execute there, but the
  dependency should be bumped separately.
