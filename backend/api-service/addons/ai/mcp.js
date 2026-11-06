// The MCP endpoint of the AI agents add-on (docs/specs/active/ai-integration.md §5):
// Streamable HTTP, stateless, JSON responses only, tools only. Serves two
// protocol eras from one handler:
//   2025  (2025-06-18, 2025-11-25)  initialize handshake, no session issued
//   2026  (2026-07-28)              version and capabilities in every request's _meta
import express from 'express';
import { applyRefusalHeaders, authenticateRequest } from './agentAuth.js';
import { publicUrls } from './config.js';
import { callTool, hasTool, listTools, SERVER_INSTRUCTIONS } from './mcpTools.js';

export const mcpRoutes = express.Router();

export const LEGACY_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18']);
export const MODERN_VERSIONS = Object.freeze(['2026-07-28']);
export const SUPPORTED_VERSIONS = Object.freeze([...MODERN_VERSIONS, ...LEGACY_VERSIONS]);

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

const SERVER_INFO = Object.freeze({ name: 'panino', title: 'Panino', version: '1.0.0' });
const CAPABILITIES = Object.freeze({ tools: { listChanged: false } });
const LIST_TTL_MS = 5 * 60 * 1000;

const ERR = Object.freeze({
    PARSE: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL: -32603,
    HEADER_MISMATCH: -32020,
    UNSUPPORTED_VERSION: -32022,
    // Server-defined: the request was authenticated but cannot be served.
    REFUSED: -32001,
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function rpcResult(id, result) {
    return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
    return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/** HTTP status for a JSON-RPC error: the 2026 transport maps them; 2025 answers 200. */
function statusFor(code, modern) {
    if (code === ERR.PARSE || code === ERR.INVALID_REQUEST) return 400;
    if (!modern) return 200;
    if (code === ERR.METHOD_NOT_FOUND) return 404;
    if ([ERR.INVALID_PARAMS, ERR.HEADER_MISMATCH, ERR.UNSUPPORTED_VERSION].includes(code)) return 400;
    if (code === ERR.INTERNAL) return 500;
    return 200;
}

/** Decode an `=?base64?…?=` header sentinel (2026 transport), else the value as sent. */
export function decodeHeaderValue(value) {
    if (typeof value !== 'string') return undefined;
    const match = /^=\?base64\?(.*)\?=$/.exec(value.trim());
    if (!match) return value.trim();
    try {
        return Buffer.from(match[1], 'base64').toString('utf8');
    } catch {
        return null;
    }
}

function header(req, name) {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

/**
 * Browsers send Origin; MCP clients do not. A browser page on another site
 * must not drive this endpoint with a key the user pasted into a local client.
 */
function originAllowed(req) {
    const origin = header(req, 'origin');
    if (!origin) return true;
    const urls = publicUrls();
    return Boolean(urls && origin === urls.appOrigin);
}

function negotiateLegacyVersion(requested) {
    return LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
}

function discoverResult() {
    return {
        resultType: 'complete',
        supportedVersions: [...SUPPORTED_VERSIONS],
        capabilities: CAPABILITIES,
        instructions: SERVER_INSTRUCTIONS,
        ttlMs: LIST_TTL_MS,
        cacheScope: 'private',
        _meta: { [META_SERVER_INFO]: SERVER_INFO },
    };
}

/**
 * 2026 requests carry the protocol version and capabilities in `_meta`, and the
 * same version, method and name in headers. Returns an error response or null.
 */
function checkModernRequest(req, message) {
    const meta = message.params?._meta || {};
    const version = meta[META_VERSION];
    if (typeof version !== 'string') return rpcError(message.id, ERR.INVALID_PARAMS, `Missing _meta["${META_VERSION}"].`);
    if (!MODERN_VERSIONS.includes(version)) {
        return rpcError(message.id, ERR.UNSUPPORTED_VERSION, 'Unsupported protocol version.', {
            supported: [...SUPPORTED_VERSIONS], requested: version,
        });
    }
    if (!meta[META_CAPABILITIES] || typeof meta[META_CAPABILITIES] !== 'object') {
        return rpcError(message.id, ERR.INVALID_PARAMS, `Missing _meta["${META_CAPABILITIES}"].`);
    }
    const headerVersion = decodeHeaderValue(header(req, 'mcp-protocol-version'));
    if (headerVersion !== version) return rpcError(message.id, ERR.HEADER_MISMATCH, 'MCP-Protocol-Version does not match the request.');
    const headerMethod = decodeHeaderValue(header(req, 'mcp-method'));
    if (headerMethod !== message.method) return rpcError(message.id, ERR.HEADER_MISMATCH, 'Mcp-Method does not match the request.');
    if (message.method === 'tools/call') {
        const headerName = decodeHeaderValue(header(req, 'mcp-name'));
        if (headerName !== message.params?.name) return rpcError(message.id, ERR.HEADER_MISMATCH, 'Mcp-Name does not match the request.');
    }
    return null;
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

function dispatch(ctx, message, modern) {
    const { id, method, params } = message;
    const complete = (result) => rpcResult(id, modern ? { resultType: 'complete', ...result } : result);

    switch (method) {
        case 'initialize':
            if (modern) return rpcError(id, ERR.METHOD_NOT_FOUND, 'initialize is not part of this protocol version; use server/discover.');
            return rpcResult(id, {
                protocolVersion: negotiateLegacyVersion(params?.protocolVersion),
                capabilities: CAPABILITIES,
                serverInfo: SERVER_INFO,
                instructions: SERVER_INSTRUCTIONS,
            });
        case 'server/discover':
            return rpcResult(id, discoverResult());
        case 'ping':
            return complete({});
        case 'tools/list':
            return complete({
                tools: listTools(ctx.agent.scope),
                ...(modern ? { ttlMs: LIST_TTL_MS, cacheScope: 'private' } : {}),
            });
        case 'tools/call': {
            const name = params?.name;
            if (typeof name !== 'string' || !hasTool(name)) return rpcError(id, ERR.INVALID_PARAMS, `Unknown tool: ${String(name).slice(0, 100)}`);
            const args = params?.arguments;
            if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
                return rpcError(id, ERR.INVALID_PARAMS, 'arguments must be an object.');
            }
            return complete(callTool(ctx, name, args));
        }
        default:
            return rpcError(id, ERR.METHOD_NOT_FOUND, `Method not found: ${String(method).slice(0, 100)}`);
    }
}

function send(res, payload, modern) {
    const status = payload.error ? statusFor(payload.error.code, modern) : 200;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json(payload);
}

mcpRoutes.post('/', (req, res) => {
    if (!originAllowed(req)) return res.status(403).json(rpcError(null, ERR.INVALID_REQUEST, 'Origin not allowed.'));

    const message = req.body;
    if (Array.isArray(message)) return res.status(400).json(rpcError(null, ERR.INVALID_REQUEST, 'Batches are not supported. Send one message per request.'));
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        return res.status(400).json(rpcError(message?.id, ERR.INVALID_REQUEST, 'Expected one JSON-RPC 2.0 message.'));
    }

    // Authenticate first, so an unauthenticated initialize gets the 401 that
    // starts an OAuth client's sign-in.
    const auth = authenticateRequest(req, { allowApps: true });
    if (!auth.ok) {
        applyRefusalHeaders(res, auth);
        if (auth.status === 401) return res.status(401).json({ error: 'invalid_token', error_description: auth.message });
        const isNotification = message.id === undefined;
        if (isNotification) return res.status(auth.status).end();
        // Authenticated but refused (switched off, rate limited): say why in a
        // form every client shows.
        return res.status(auth.status === 429 ? 429 : 200).json(rpcError(message.id, ERR.REFUSED, auth.message, { code: auth.code }));
    }

    const modern = Boolean(message.params?._meta && message.params._meta[META_VERSION] !== undefined);
    if (modern) {
        const problem = checkModernRequest(req, message);
        if (problem) return send(res, problem, true);
    } else if (message.method !== 'initialize') {
        const headerVersion = decodeHeaderValue(header(req, 'mcp-protocol-version'));
        if (headerVersion && !SUPPORTED_VERSIONS.includes(headerVersion)) {
            return res.status(400).json(rpcError(message.id, ERR.INVALID_REQUEST, 'Unsupported MCP-Protocol-Version.'));
        }
    }

    // Notifications (no id) get no body.
    if (message.id === undefined) return res.status(202).end();

    const ctx = { userId: auth.userId, agent: auth.agent, clients: req.clients };
    try {
        return send(res, dispatch(ctx, message, modern), modern);
    } catch (error) {
        console.error('[ai:mcp]', message.method, message.method === 'tools/call' ? message.params?.name : '', error?.code || error?.message || 'unknown error');
        return send(res, rpcError(message.id, ERR.INTERNAL, 'Internal error'), modern);
    }
});

// No server-initiated stream and no sessions.
mcpRoutes.all('/', (req, res) => {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(rpcError(null, ERR.INVALID_REQUEST, 'Use POST.'));
});
