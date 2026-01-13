# PDF POC

A minimal service to stress-test the PDF renderer with Paged.js without auth.

## Run
1. `cd poc && npm install`
2. `npm start` (defaults to port 9000)

## Rendering the included test doc
- `cd poc && ./render-test.sh`
- Produces `poc/poc-test.pdf` using `poc/test-doc.md` and the shared print defaults.

## API
- POST `/render-pdf` with `{ htmlContent, cssStyles?, printStyles? }` (same as production). The service processes requests sequentially and returns an inline PDF. If `cssStyles` is omitted, the server auto-generates CSS from the default print styles.

## Defaults
- Default print styles, fonts, header/footer, margins come from `poc/print-defaults.json` (mirrors frontend defaults). Incoming `printStyles` are merged over these defaults.
- CSS generation uses `style-utils.js` to build the stylesheet from the current print styles.

## Notes
- Uses local Paged.js if found at `poc/lib/paged.polyfill.js`, otherwise `backend/api-service/lib/paged.polyfill.js`, then CDN fallback.
- Image IDs matching `/images/<id>` load from `poc/uploads` (prefix match); external URLs are fetched and inlined with SSRF guards.
- CORS enabled; `/uploads` served statically for quick testing.
