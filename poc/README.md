# PDF POC

A minimal service to stress-test the PDF renderer (no Paged.js) without auth.

## Run
1. `cd poc && npm install`
2. `npm start` (defaults to port 9000)

## Rendering the included test doc
- `cd poc && ./render-test.sh`
- Produces `poc/poc-test.pdf` using `poc/test-doc.md` and the shared print defaults.
	- Script auto-kills any existing server on port 9000 before starting.

## API
- POST `/render-pdf` with `{ htmlContent, cssStyles?, printStyles? }` (same as production). The service processes requests sequentially and returns an inline PDF. If `cssStyles` is omitted, the server auto-generates CSS from the default print styles.
	- Headers/footers use Puppeteer header/footer templates; `%p` and `%P` map to current/total pages after a two-pass render (first pass to count pages, second pass to render with totals).

## Defaults
- Default print styles, fonts, header/footer, margins come from `poc/print-defaults.json` (mirrors frontend defaults). Incoming `printStyles` are merged over these defaults.
- CSS generation uses `style-utils.js` to build the stylesheet from the current print styles.
	- Page totals are computed from a draft PDF buffer using `pdf-lib` and injected into the final render so `Page X of Y` is accurate.

## Notes
- Image IDs matching `/images/<id>` load from `poc/uploads` (prefix match); external URLs are fetched and inlined with SSRF guards.
- CORS enabled; `/uploads` served statically for quick testing.
