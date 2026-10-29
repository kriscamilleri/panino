/**
 * A small client for Odoo's external JSON-2 API (Odoo 19 and later):
 * `POST /json/2/<model>/<method>` with a bearer API key.
 *
 * Every request goes through `safeRequest`, so the address policy, the pinned
 * DNS lookup and the size limit apply to every call. Odoo's error bodies carry a
 * full server traceback (`debug`); none of `message`, `arguments` or `debug` ever
 * leaves this module. Callers get an `OdooError` with a closed `code` and, for
 * server logs only, the Odoo exception class in `odooName`.
 *
 * Behaviour this relies on was verified against Odoo 19 and 20 (see
 * docs/specs/active/odoo-integration.md §4).
 */

import crypto from 'crypto';
import { safeRequest } from '../../safeFetch.js';

export const ODOO_ERROR_CODES = Object.freeze([
    'bad_url',
    'blocked',
    'unreachable',
    'not_odoo',
    'not_odoo_19',
    'key_rejected',
    'access_denied',
    'missing_app',
    'record_gone',
    'too_large',
    'upload_corrupt',
    'missing_folder',
    'odoo_error',
]);

/** A failed Odoo call. `code` is one of `ODOO_ERROR_CODES`. */
export class OdooError extends Error {
    /**
     * @param {string} code
     * @param {{ status?: number, odooName?: string }} [details]
     */
    constructor(code, { status, odooName } = {}) {
        super(code);
        this.name = 'OdooError';
        this.code = code;
        this.status = status;
        this.odooName = odooName;
    }
}

const MODEL_NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const METHOD_NAME = /^[a-z][a-z0-9_]*$/;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'Panino (Odoo integration)';

/**
 * The origin of an Odoo URL as typed or pasted by a user. Paths are dropped:
 * Odoo 17+ browser URLs look like `https://example.odoo.com/odoo/action-…`.
 *
 * @param {string} input
 * @param {{ allowHttpHosts?: Set<string> }} [options] hosts that may use plain `http:`
 * @returns {string} e.g. `https://example.odoo.com` or `https://odoo.example.com:8443`
 * @throws {OdooError} `bad_url`
 */
export function normalizeBaseUrl(input, { allowHttpHosts = new Set() } = {}) {
    const raw = String(input ?? '').trim();
    if (!raw || raw.length > 2048) throw new OdooError('bad_url');
    let url;
    try {
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        throw new OdooError('bad_url');
    }
    if (url.username || url.password) throw new OdooError('bad_url');
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'http:' && !allowHttpHosts.has(host)) throw new OdooError('bad_url');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new OdooError('bad_url');
    return url.origin;
}

/**
 * The key that ties a stored link to one Odoo database.
 *
 * @param {{ baseUrl: string, databaseName?: string }} connection
 * @returns {string}
 */
export function odooTarget({ baseUrl, databaseName = '' }) {
    return `${baseUrl}|${databaseName || ''}`;
}

/**
 * Map an Odoo HTTP error to an `OdooError`. Only the exception class is kept.
 *
 * @param {number} status
 * @param {Buffer} body
 * @returns {OdooError}
 */
export function errorFromResponse(status, body) {
    let odooName;
    try {
        const parsed = JSON.parse(body.toString('utf8'));
        if (parsed && typeof parsed.name === 'string') odooName = parsed.name.slice(0, 200);
    } catch {
        // Not JSON: an HTML error page from Odoo or a proxy in front of it.
    }
    const details = { status, odooName };
    if (status === 401) return new OdooError('key_rejected', details);
    if (status === 403 || odooName === 'odoo.exceptions.AccessError') return new OdooError('access_denied', details);
    if (status === 404 && odooName === 'werkzeug.exceptions.NotFound') return new OdooError('missing_app', details);
    if (status === 404) return new OdooError('not_odoo', details);
    if (odooName === 'odoo.exceptions.MissingError') return new OdooError('record_gone', details);
    if (status === 413) return new OdooError('too_large', details);
    if (status >= 300 && status < 400) return new OdooError('unreachable', details);
    return new OdooError('odoo_error', details);
}

/**
 * The default transport: one `safeRequest`, with failures turned into `OdooError`s.
 *
 * @param {string} url
 * @param {object} options passed to `safeRequest`
 * @returns {Promise<{ status: number, body: Buffer }>}
 */
async function defaultTransport(url, options) {
    const result = await safeRequest(url, options);
    if (!result.ok) {
        if (result.reason === 'blocked') throw new OdooError('blocked');
        if (/exceeds/.test(result.detail)) throw new OdooError('too_large');
        throw new OdooError('unreachable');
    }
    return { status: result.status, body: result.body };
}

/**
 * @typedef {object} OdooConnection
 * @property {string} baseUrl from `normalizeBaseUrl`
 * @property {string} [databaseName] sent as `X-Odoo-Database` when set
 * @property {string} apiKey
 */

/**
 * @param {OdooConnection} connection
 * @param {object} [options]
 * @param {(ip: string, hostname: string) => boolean} [options.isAllowedAddress] address policy
 * @param {Set<string>} [options.allowHttpHosts] hosts that may use plain `http:`
 * @param {Function} [options.transport] `(url, options) => Promise<{status, body}>` (test seam)
 */
export function createOdooClient(connection, options = {}) {
    const { baseUrl, databaseName = '', apiKey } = connection;
    const transport = options.transport || defaultTransport;
    const allowedProtocols = options.allowHttpHosts?.has(new URL(baseUrl).hostname.toLowerCase())
        ? ['https:', 'http:']
        : ['https:'];
    const requestOptions = {
        allowedProtocols,
        isAllowedAddress: options.isAllowedAddress,
    };

    function headers(extra = {}) {
        return {
            'User-Agent': USER_AGENT,
            ...(databaseName ? { 'X-Odoo-Database': databaseName } : {}),
            ...extra,
        };
    }

    function parseJson(body) {
        try {
            return JSON.parse(body.toString('utf8'));
        } catch {
            throw new OdooError('not_odoo');
        }
    }

    /**
     * `GET /web/version`: no key needed.
     *
     * @returns {Promise<{ major: number, version: string }>}
     */
    async function version() {
        const { status, body } = await transport(`${baseUrl}/web/version`, {
            ...requestOptions,
            method: 'GET',
            headers: headers({ Accept: 'application/json' }),
            timeoutMs: DEFAULT_TIMEOUT_MS,
            maxBytes: 64 * 1024,
        });
        if (status !== 200) throw errorFromResponse(status, body);
        const data = parseJson(body);
        const major = Number(Array.isArray(data?.version_info) ? data.version_info[0] : NaN);
        if (!Number.isInteger(major)) throw new OdooError('not_odoo');
        return { major, version: String(data.version || major).slice(0, 50) };
    }

    /**
     * Call a public model method.
     *
     * @param {string} model e.g. `knowledge.article`
     * @param {string} method e.g. `search_read`; never private (`_…`)
     * @param {object} [params] named parameters, `ids` and `context`
     * @param {{ timeoutMs?: number, maxBytes?: number }} [limits]
     * @returns {Promise<any>} the method's JSON result
     */
    async function call(model, method, params = {}, limits = {}) {
        if (!MODEL_NAME.test(model) || !METHOD_NAME.test(method)) {
            throw new Error(`Invalid Odoo model or method: ${model}/${method}`);
        }
        const { status, body } = await transport(`${baseUrl}/json/2/${model}/${method}`, {
            ...requestOptions,
            method: 'POST',
            headers: headers({
                Authorization: `bearer ${apiKey}`,
                'Content-Type': 'application/json; charset=utf-8',
                Accept: 'application/json',
            }),
            body: JSON.stringify(params),
            timeoutMs: limits.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxBytes: limits.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
        });
        if (status !== 200) throw errorFromResponse(status, body);
        return parseJson(body);
    }

    return { version, call };
}

const fileFieldCache = new Map();
const FILE_FIELD_TTL_MS = 60 * 60 * 1000;

/**
 * The field that takes a file's base64 content on `model`. Odoo 19 has `datas`
 * (`raw` there stores the base64 text itself); Odoo 20 removed `datas` (a create
 * that uses it succeeds and stores nothing) and takes base64 in `raw`. So the
 * field is read from the model, never assumed, and cached per database.
 *
 * @param {ReturnType<typeof createOdooClient>} client
 * @param {string} target from `odooTarget`
 * @param {string} model `ir.attachment` or `documents.document`
 * @returns {Promise<'datas'|'raw'>}
 */
export async function fileField(client, target, model) {
    const key = `${target}|${model}`;
    const cached = fileFieldCache.get(key);
    if (cached && Date.now() - cached.at < FILE_FIELD_TTL_MS) return cached.field;
    const fields = await client.call(model, 'fields_get', { allfields: ['datas', 'raw'], attributes: ['type'] });
    let field;
    if (fields?.datas?.type === 'binary') field = 'datas';
    else if (fields?.raw?.type === 'binary') field = 'raw';
    else throw new OdooError('odoo_error');
    fileFieldCache.set(key, { field, at: Date.now() });
    return field;
}

/** Test seam: forget detected file fields. */
export function resetFileFieldCache() {
    fileFieldCache.clear();
}

/**
 * Check that an attachment holds exactly `bytes`, by Odoo's own `checksum` (SHA-1
 * of the stored content).
 *
 * @param {ReturnType<typeof createOdooClient>} client
 * @param {number} attachmentId
 * @param {Buffer} bytes
 * @throws {OdooError} `upload_corrupt` on a mismatch, `record_gone` if it vanished
 */
export async function verifyAttachment(client, attachmentId, bytes) {
    const rows = await client.call('ir.attachment', 'read', { ids: [attachmentId], fields: ['checksum'] });
    if (!Array.isArray(rows) || rows.length === 0) throw new OdooError('record_gone');
    const expected = crypto.createHash('sha1').update(bytes).digest('hex');
    if (rows[0].checksum !== expected) throw new OdooError('upload_corrupt');
}

/**
 * Put an Odoo URL's path on the connection's own address. Odoo builds `access_url`
 * and `article_url` from its `web.base.url`, which can be an internal address.
 *
 * @param {string} odooUrl e.g. `http://localhost:8069/odoo/documents/abc`
 * @returns {string|null} the path, query and hash, e.g. `/odoo/documents/abc`
 */
export function odooUrlPath(odooUrl) {
    if (typeof odooUrl !== 'string' || !odooUrl) return null;
    try {
        const url = new URL(odooUrl, 'http://placeholder.invalid');
        return `${url.pathname}${url.search}${url.hash}`.slice(0, 1000);
    } catch {
        return null;
    }
}

/** The models behind each destination, by the name Panino stores. */
export const ODOO_APPS = Object.freeze({
    documents: 'documents.document',
    knowledge: 'knowledge.article',
    crm: 'crm.lead',
    sales: 'sale.order',
});

/**
 * Check a connection the way Settings does before saving it: Odoo 19 or later,
 * a working key, and which destinations' apps this user can use.
 *
 * @param {ReturnType<typeof createOdooClient>} client
 * @returns {Promise<{ version: string, uid: number|null, userName: string|null, apps: string[] }>}
 * @throws {OdooError}
 */
export async function verifyConnection(client) {
    const { major, version } = await client.version();
    if (major < 19) throw new OdooError('not_odoo_19');

    const context = await client.call('res.users', 'context_get');
    const uid = Number.isInteger(context?.uid) ? context.uid : null;
    let userName = null;
    if (uid) {
        const rows = await client.call('res.users', 'read', { ids: [uid], fields: ['name'] });
        userName = typeof rows?.[0]?.name === 'string' ? rows[0].name.slice(0, 200) : null;
    }

    // An app counts when its model exists and this user may read it.
    const apps = [];
    for (const [app, model] of Object.entries(ODOO_APPS)) {
        try {
            await client.call(model, 'search_count', { domain: [['id', '=', 0]] });
            apps.push(app);
        } catch (error) {
            if (!(error instanceof OdooError) || !['missing_app', 'access_denied'].includes(error.code)) throw error;
        }
    }
    return { version, uid, userName, apps };
}
