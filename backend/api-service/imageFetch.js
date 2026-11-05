/**
 * Server-side fetch of an external image for embedding into a PDF as a `data:` URI.
 * The address checks, pinning and size limit live in `safeFetch.js`.
 *
 * SSRF protections:
 * - Every hostname is resolved first and every resolved address must be a public
 *   unicast address (ipaddr.js; IPv4-mapped IPv6 is unwrapped before the check).
 * - The connection is pinned to the checked address through the socket `lookup`
 *   option, so the address that was checked is the address that is connected to.
 *   The hostname is kept for TLS SNI and the `Host` header.
 * - Redirects are followed manually, at most `maxRedirects` hops, re-running the
 *   address check on each hop.
 * - The size limit is enforced while streaming, so an oversized body is cut off
 *   instead of buffered.
 */

import { promises as dns } from 'node:dns';
import {
    FetchOutcome,
    isPublicAddress,
    readBodyLimited,
    requestPinned,
    resolveChecked,
} from './safeFetch.js';

export { isPublicAddress };

export const IMAGE_FETCH_DEFAULTS = Object.freeze({
    timeoutMs: 10000,
    maxBytes: 5000 * 1024,
    maxRedirects: 3,
    userAgent: 'Mozilla/5.0 (compatible; PaninoPDF/1.0)',
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch an external image and return it as a `data:` URI.
 *
 * @param {string} urlStr
 * @param {object} [options]
 * @param {Function} [options.lookup] `dns.lookup`-compatible resolver (test seam)
 * @param {(ip: string) => boolean} [options.isAllowedAddress] address policy (test seam)
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @param {number} [options.maxRedirects]
 * @param {AbortSignal} [options.signal] aborting destroys the in-flight request
 * @returns {Promise<{ ok: true, dataUri: string, bytes: number } | { ok: false, reason: 'blocked'|'failed', detail: string }>}
 */
export async function fetchExternalImageAsDataUri(urlStr, options = {}) {
    const settings = { ...IMAGE_FETCH_DEFAULTS, ...options };
    const lookup = options.lookup || ((hostname, opts) => dns.lookup(hostname, opts));
    const isAllowedAddress = options.isAllowedAddress || isPublicAddress;
    const signal = options.signal || null;
    const deadline = Date.now() + settings.timeoutMs;

    try {
        let url;
        try {
            url = new URL(urlStr);
        } catch {
            throw new FetchOutcome('failed', 'invalid URL');
        }

        for (let hop = 0; ; hop += 1) {
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                throw new FetchOutcome('failed', `unsupported scheme ${url.protocol}`);
            }
            if (signal?.aborted) throw new FetchOutcome('failed', 'aborted');
            const pinned = await resolveChecked(url.hostname, { lookup, isAllowedAddress, deadline });
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new FetchOutcome('failed', 'timeout');

            let response;
            try {
                response = await requestPinned(url, pinned, {
                    headers: { 'User-Agent': settings.userAgent, Accept: 'image/*' },
                    timeoutMs: remaining,
                    signal,
                });
            } catch (error) {
                throw new FetchOutcome('failed', `request failed: ${error.code || error.message}`);
            }

            if (REDIRECT_STATUSES.has(response.statusCode)) {
                response.resume();
                const location = response.headers.location;
                if (!location) throw new FetchOutcome('failed', 'redirect without location');
                if (hop >= settings.maxRedirects) throw new FetchOutcome('failed', 'too many redirects');
                try {
                    url = new URL(location, url);
                } catch {
                    throw new FetchOutcome('failed', 'invalid redirect location');
                }
                continue;
            }

            if (response.statusCode !== 200) {
                response.resume();
                throw new FetchOutcome('failed', `status ${response.statusCode}`);
            }

            const contentType = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            if (!contentType.startsWith('image/')) {
                response.resume();
                throw new FetchOutcome('failed', `content type ${contentType || 'missing'}`);
            }

            const declared = Number(response.headers['content-length']);
            if (Number.isFinite(declared) && declared > settings.maxBytes) {
                response.destroy();
                throw new FetchOutcome('failed', `declared length ${declared} exceeds ${settings.maxBytes} bytes`);
            }

            let body;
            try {
                body = await readBodyLimited(response, settings.maxBytes, deadline, signal);
            } catch (error) {
                if (error instanceof FetchOutcome) throw error;
                throw new FetchOutcome('failed', `read failed: ${error.message}`);
            }
            return { ok: true, dataUri: `data:${contentType};base64,${body.toString('base64')}`, bytes: body.length };
        }
    } catch (error) {
        if (error instanceof FetchOutcome) return { ok: false, reason: error.reason, detail: error.message };
        return { ok: false, reason: 'failed', detail: error.message };
    }
}
