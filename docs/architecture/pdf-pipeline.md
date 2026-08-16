# PDF pipeline

PDF rendering is implemented in `backend/api-service/pdf.js`. Authenticated requests enter a
sequential queue, user HTML is sanitized, internal images are embedded from the uploads
directory, and external image URLs are resolved after an initial DNS/private-network check.
The current fetch follows redirects, so redirect targets are a known hardening gap rather than
an absolute SSRF guarantee. Puppeteer renders the page and `pdf-lib` resolves
page-count-dependent output.

This is a short reference; update it when the rendering mechanism changes. The backend layer
handbook remains the entry point for route and testing conventions.

## Puppeteer version gotchas (found bumping 22 -> 25 in DX-10)

- `Browser.isConnected()` was removed; use the `browser.connected` boolean instead
  (`pdf.js` browser-reuse check).
- `page.pdf()` now returns a plain `Uint8Array`, not a Node `Buffer`. Express's `res.send()`
  only special-cases real `Buffer`s — handing it a `Uint8Array` silently falls through to the
  JSON-serialization branch and corrupts the response body. Wrap the result in
  `Buffer.from(...)` before `res.send()`.

Neither of these produced an obvious error; the second was only caught by an integration
test asserting on the response `Content-Type` header. Re-check both after any future
Puppeteer major bump.
