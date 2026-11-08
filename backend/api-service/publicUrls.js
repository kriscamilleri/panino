/**
 * The public address of the Panino web app, for links the API writes into its output
 * (docs/specs/active/editor-toc-and-internal-links.md §6.8): a link to another Document
 * in a PDF opens `<FRONTEND_URL>/#/doc/<id>`.
 *
 * Read only from `FRONTEND_URL`, never from a request's Host, Origin or X-Forwarded-*
 * headers, so a request cannot choose where a PDF's links point. The rule matches the
 * AI agents add-on's own copy (addons/ai/config.js), which core cannot import.
 */

/**
 * @returns {string|null} the app's origin and path without a trailing slash. A value
 *   that is not an absolute http(s) URL, or that has a query or fragment, counts as unset; unset is
 *   `http://localhost:5173` in development and null in production
 */
export function appBaseUrl() {
    const configured = String(process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
    if (configured) {
        try {
            const url = new URL(configured);
            // A query or fragment would end up in front of `#/doc/…` and break every link.
            if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname && !url.username && !url.password
                && !url.search && !url.hash) {
                return configured;
            }
        } catch {
            // Not a URL: treated as unset.
        }
    }
    if (process.env.NODE_ENV === 'production') return null;
    return 'http://localhost:5173';
}

/**
 * Startup warnings about the public URLs, logged next to the add-on warnings.
 *
 * @returns {string[]}
 */
export function publicUrlWarnings() {
    if (appBaseUrl()) return [];
    return ['FRONTEND_URL is not set; links to other Documents in PDFs print as plain text.'];
}
