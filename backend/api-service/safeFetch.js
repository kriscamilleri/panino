/**
 * Outbound HTTP requests to hosts that users choose, safe against SSRF.
 *
 * - Every hostname is resolved first and every resolved address must pass the
 *   address policy (by default: public unicast only, via ipaddr.js; IPv4-mapped
 *   IPv6 is unwrapped before the check).
 * - The connection is pinned to the checked address through the socket `lookup`
 *   option, so the address that was checked is the address that is connected to.
 *   The hostname is kept for TLS SNI and the `Host` header.
 * - The size limit is enforced while streaming, so an oversized body is cut off
 *   instead of buffered.
 *
 * `imageFetch.js` builds on these pieces for PDF images; `addons/odoo/client.js` uses
 * `safeRequest` for the Odoo API.
 */

import http from 'node:http';
import https from 'node:https';
import { promises as dns } from 'node:dns';
import ipaddr from 'ipaddr.js';

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

/** A failed fetch: `reason` is `blocked` (address policy) or `failed` (anything else). */
export class FetchOutcome extends Error {
    constructor(reason, detail) {
        super(detail);
        this.reason = reason;
    }
}

/**
 * Resolve a hostname and check every address. Returns the address to connect to, or
 * throws `blocked` / `failed` outcomes.
 *
 * @param {string} hostname
 * @param {{ lookup: Function, isAllowedAddress: (ip: string) => boolean, deadline: number }} options
 * @returns {Promise<{ address: string, family: number }>}
 */
export async function resolveChecked(hostname, { lookup, isAllowedAddress, deadline }) {
    const literal = hostnameLiteral(hostname);
    if (literal) {
        if (!isAllowedAddress(literal)) throw new FetchOutcome('blocked', 'address not allowed');
        return { address: literal, family: ipaddr.parse(literal).kind() === 'ipv6' ? 6 : 4 };
    }
    let results;
    let timer;
    try {
        // `dns.lookup` has no timeout of its own; bound it by the fetch deadline.
        const expiry = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new FetchOutcome('failed', 'timeout')), Math.max(0, deadline - Date.now()));
        });
        results = await Promise.race([lookup(hostname, { all: true }), expiry]);
    } catch (error) {
        if (error instanceof FetchOutcome) throw error;
        throw new FetchOutcome('failed', `DNS lookup failed: ${error.code || error.message}`);
    } finally {
        clearTimeout(timer);
    }
    const list = Array.isArray(results) ? results : [results];
    if (list.length === 0) throw new FetchOutcome('failed', 'DNS lookup returned no address');
    for (const entry of list) {
        if (!isAllowedAddress(entry.address)) throw new FetchOutcome('blocked', 'address not allowed');
    }
    return { address: list[0].address, family: list[0].family };
}

/**
 * Send one request to the pinned address and resolve with the response once its
 * headers arrive.
 *
 * @param {URL} url
 * @param {{ address: string, family: number }} pinned
 * @param {{ method?: string, headers?: object, body?: Buffer|string|null, timeoutMs: number, signal?: AbortSignal|null }} options
 * @returns {Promise<import('node:http').IncomingMessage>}
 */
export function requestPinned(url, pinned, { method = 'GET', headers = {}, body = null, timeoutMs, signal = null }) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
        }
        const client = url.protocol === 'https:' ? https : http;
        // `timeout` on the request is only an idle timeout; a host that trickles header
        // bytes would never trip it. This timer is the absolute cap for the header phase.
        let timer = null;
        const req = client.request(url, {
            method,
            headers,
            // Connect to the address that passed the check; keep `url.hostname` for
            // SNI and the Host header.
            lookup(hostname, options, callback) {
                if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
                else callback(null, pinned.address, pinned.family);
            },
            timeout: timeoutMs,
            signal,
        }, (response) => {
            clearTimeout(timer);
            resolve(response);
        });
        timer = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        req.end(body ?? undefined);
    });
}

/**
 * Read a response body, cutting it off past `maxBytes` or the deadline.
 *
 * @param {import('node:http').IncomingMessage} response
 * @param {number} maxBytes
 * @param {number} deadline epoch milliseconds
 * @param {AbortSignal|null} [signal]
 * @returns {Promise<Buffer>}
 */
export function readBodyLimited(response, maxBytes, deadline, signal = null) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        const timer = setTimeout(() => {
            response.destroy(new Error('timeout'));
        }, Math.max(0, deadline - Date.now()));
        const onAbort = () => response.destroy(new Error('aborted'));
        signal?.addEventListener('abort', onAbort, { once: true });
        response.on('close', () => signal?.removeEventListener('abort', onAbort));
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
 * One request to a user-chosen host, with no redirects followed. A redirect comes
 * back as its status, for the caller to treat as an error.
 *
 * @param {string} urlStr
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.headers]
 * @param {Buffer|string|null} [options.body]
 * @param {number} [options.timeoutMs] whole request, DNS to last body byte
 * @param {number} [options.maxBytes] response body limit
 * @param {string[]} [options.allowedProtocols] default `['https:']`
 * @param {(ip: string, hostname: string) => boolean} [options.isAllowedAddress] default public only
 * @param {Function} [options.lookup] `dns.lookup`-compatible resolver (test seam)
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ ok: true, status: number, headers: object, body: Buffer } | { ok: false, reason: 'blocked'|'failed', detail: string }>}
 */
export async function safeRequest(urlStr, options = {}) {
    const {
        method = 'GET',
        headers = {},
        body = null,
        timeoutMs = 10000,
        maxBytes = 1024 * 1024,
        allowedProtocols = ['https:'],
        signal = null,
    } = options;
    const lookup = options.lookup || ((hostname, opts) => dns.lookup(hostname, opts));
    const deadline = Date.now() + timeoutMs;

    try {
        let url;
        try {
            url = new URL(urlStr);
        } catch {
            throw new FetchOutcome('failed', 'invalid URL');
        }
        if (!allowedProtocols.includes(url.protocol)) {
            throw new FetchOutcome('blocked', `unsupported scheme ${url.protocol}`);
        }
        if (url.username || url.password) throw new FetchOutcome('blocked', 'credentials in URL');
        if (signal?.aborted) throw new FetchOutcome('failed', 'aborted');

        const policy = options.isAllowedAddress || isPublicAddress;
        const isAllowedAddress = (ip) => policy(ip, url.hostname);
        const pinned = await resolveChecked(url.hostname, { lookup, isAllowedAddress, deadline });
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new FetchOutcome('failed', 'timeout');

        let response;
        try {
            response = await requestPinned(url, pinned, { method, headers, body, timeoutMs: remaining, signal });
        } catch (error) {
            throw new FetchOutcome('failed', `request failed: ${error.code || error.message}`);
        }

        const declared = Number(response.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
            response.destroy();
            throw new FetchOutcome('failed', `declared length ${declared} exceeds ${maxBytes} bytes`);
        }
        let responseBody;
        try {
            responseBody = await readBodyLimited(response, maxBytes, deadline, signal);
        } catch (error) {
            if (error instanceof FetchOutcome) throw error;
            throw new FetchOutcome('failed', `read failed: ${error.message}`);
        }
        return { ok: true, status: response.statusCode, headers: response.headers, body: responseBody };
    } catch (error) {
        if (error instanceof FetchOutcome) return { ok: false, reason: error.reason, detail: error.message };
        return { ok: false, reason: 'failed', detail: error.message };
    }
}
