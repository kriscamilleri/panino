/**
 * Server-side fetch of an external image for embedding into a PDF as a `data:` URI.
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

import http from 'node:http';
import https from 'node:https';
import { promises as dns } from 'node:dns';
import ipaddr from 'ipaddr.js';

export const IMAGE_FETCH_DEFAULTS = Object.freeze({
    timeoutMs: 10000,
    maxBytes: 5000 * 1024,
    maxRedirects: 3,
    userAgent: 'Mozilla/5.0 (compatible; PaninoPDF/1.0)',
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Whether an IP address is a public unicast address that a server-side fetch may
 * connect to. Loopback, private, link-local, carrier-grade NAT, benchmarking, reserved,
 * multicast, unspecified and every IPv6 transition range are rejected.
 *
 * @param {string} ip
 * @returns {boolean}
 */
export function isPublicAddress(ip) {
    // Only the canonical forms: four-part dotted IPv4 or a valid IPv6. ipaddr.js also
    // accepts shorthand such as `1.2.3`, which no resolver or URL parser produces.
    if (typeof ip !== 'string') return false;
    if (!ipaddr.IPv4.isValidFourPartDecimal(ip) && !ipaddr.IPv6.isValid(ip)) return false;
    let address;
    try {
        address = ipaddr.parse(ip);
        if (address.kind() === 'ipv6' && address.isIPv4MappedAddress()) {
            address = address.toIPv4Address();
        }
    } catch {
        return false;
    }
    return address.range() === 'unicast';
}

function hostnameLiteral(hostname) {
    const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    return ipaddr.IPv4.isValidFourPartDecimal(bare) || ipaddr.IPv6.isValid(bare) ? bare : null;
}

/**
 * Resolve a hostname and check every address. Returns the address to connect to, or
 * throws `blocked` / `failed` errors.
 */
async function resolveChecked(hostname, { lookup, isAllowedAddress }) {
    const literal = hostnameLiteral(hostname);
    if (literal) {
        if (!isAllowedAddress(literal)) throw new FetchOutcome('blocked', 'address not allowed');
        return { address: literal, family: ipaddr.parse(literal).kind() === 'ipv6' ? 6 : 4 };
    }
    let results;
    try {
        results = await lookup(hostname, { all: true });
    } catch (error) {
        throw new FetchOutcome('failed', `DNS lookup failed: ${error.code || error.message}`);
    }
    const list = Array.isArray(results) ? results : [results];
    if (list.length === 0) throw new FetchOutcome('failed', 'DNS lookup returned no address');
    for (const entry of list) {
        if (!isAllowedAddress(entry.address)) throw new FetchOutcome('blocked', 'address not allowed');
    }
    return { address: list[0].address, family: list[0].family };
}

class FetchOutcome extends Error {
    constructor(reason, detail) {
        super(detail);
        this.reason = reason;
    }
}

function requestOnce(url, pinned, { timeoutMs, userAgent }) {
    return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, {
            method: 'GET',
            headers: { 'User-Agent': userAgent, Accept: 'image/*' },
            // Connect to the address that passed the check; keep `url.hostname` for
            // SNI and the Host header.
            lookup(hostname, options, callback) {
                if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
                else callback(null, pinned.address, pinned.family);
            },
            timeout: timeoutMs,
        }, resolve);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end();
    });
}

function readBody(response, maxBytes, deadline) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        const timer = setTimeout(() => {
            response.destroy(new Error('timeout'));
        }, Math.max(0, deadline - Date.now()));
        response.on('data', chunk => {
            total += chunk.length;
            if (total > maxBytes) {
                response.destroy(new FetchOutcome('failed', `body exceeds ${maxBytes} bytes`));
                return;
            }
            chunks.push(chunk);
        });
        response.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
        response.on('error', error => { clearTimeout(timer); reject(error); });
    });
}

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
 * @returns {Promise<{ ok: true, dataUri: string, bytes: number } | { ok: false, reason: 'blocked'|'failed', detail: string }>}
 */
export async function fetchExternalImageAsDataUri(urlStr, options = {}) {
    const settings = { ...IMAGE_FETCH_DEFAULTS, ...options };
    const lookup = options.lookup || ((hostname, opts) => dns.lookup(hostname, opts));
    const isAllowedAddress = options.isAllowedAddress || isPublicAddress;
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
            const pinned = await resolveChecked(url.hostname, { lookup, isAllowedAddress });
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new FetchOutcome('failed', 'timeout');

            let response;
            try {
                response = await requestOnce(url, pinned, { ...settings, timeoutMs: remaining });
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
                body = await readBody(response, settings.maxBytes, deadline);
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
