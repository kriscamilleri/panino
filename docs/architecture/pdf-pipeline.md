# PDF pipeline

PDF rendering is implemented in `backend/api-service/pdf.js`. Authenticated requests enter a
sequential queue, user HTML is sanitized, internal images are embedded from the uploads
directory, and external image URLs are resolved after an initial DNS/private-network check.
The current fetch follows redirects, so redirect targets are a known hardening gap rather than
an absolute SSRF guarantee. Puppeteer renders the page and `pdf-lib` resolves
page-count-dependent output.

This is a short reference; update it when the rendering mechanism changes. The backend layer
handbook remains the entry point for route and testing conventions.
