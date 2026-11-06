// /backend/api-service/apiKeyUtils.js
// Pure helpers for API keys and the v1 API (docs/specs/active/llm-api.md).
// No database or Express access here, so every rule can be unit tested.
import crypto from 'crypto';

export const API_KEY_PREFIX = 'pnk_';
/** Characters of the key kept in clear for display: `pnk_` plus eight. */
export const API_KEY_DISPLAY_LENGTH = API_KEY_PREFIX.length + 8;
export const API_KEY_SCOPES = Object.freeze(['read', 'write']);
export const API_KEY_SPACE_ACCESS = Object.freeze(['all', 'personal']);
export const API_KEY_EXPIRY_DAYS = Object.freeze([30, 90, 365]);
export const MAX_ACTIVE_API_KEYS = 10;
export const API_KEY_NAME_MAX = 60;

const KEY_PATTERN = /^pnk_[A-Za-z0-9_-]{43}$/;
// C0 controls except tab/newline/carriage return, plus DEL and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const ANY_LINE_BREAK = /[\r\n\t]/;

/**
 * Create a new API key. The full key is returned once and never stored.
 * @returns {{ key: string, hash: string, prefix: string }}
 */
export function generateApiKey() {
    const key = API_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
    return { key, hash: hashApiKey(key), prefix: key.slice(0, API_KEY_DISPLAY_LENGTH) };
}

/**
 * SHA-256 of the full key, as lowercase hex. A 256-bit random secret needs no
 * slow hash: guessing it is infeasible either way.
 * @param {string} key
 * @returns {string}
 */
export function hashApiKey(key) {
    return crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');
}

/**
 * True when the value has the exact shape of a Panino API key.
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikeApiKey(value) {
    return typeof value === 'string' && KEY_PATTERN.test(value);
}

/**
 * The bearer credential from an Authorization header, or null.
 * @param {string|undefined} header
 * @returns {string|null}
 */
export function bearerFromHeader(header) {
    if (typeof header !== 'string') return null;
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    return match ? match[1] : null;
}

/**
 * Validate the body of `POST /api-keys`.
 * @param {object} body
 * @returns {{ ok: true, value: { name: string, scope: string, spaceAccess: string, expiresInDays: number|null } } | { ok: false, error: string }}
 */
export function validateCreateKeyInput(body) {
    const input = body && typeof body === 'object' ? body : {};
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) return { ok: false, error: 'Give the key a name.' };
    if (name.length > API_KEY_NAME_MAX) return { ok: false, error: `Use at most ${API_KEY_NAME_MAX} characters for the name.` };
    if (CONTROL_CHARS.test(name) || ANY_LINE_BREAK.test(name)) return { ok: false, error: 'The name contains characters that are not allowed.' };

    const scope = input.scope ?? 'read';
    if (!API_KEY_SCOPES.includes(scope)) return { ok: false, error: 'Access must be "read" or "write".' };

    const spaceAccess = input.spaceAccess ?? 'all';
    if (!API_KEY_SPACE_ACCESS.includes(spaceAccess)) return { ok: false, error: 'Spaces must be "all" or "personal".' };

    const rawExpiry = input.expiresInDays === undefined ? 90 : input.expiresInDays;
    if (rawExpiry !== null && !API_KEY_EXPIRY_DAYS.includes(rawExpiry)) {
        return { ok: false, error: 'Expiry must be 30, 90 or 365 days, or never.' };
    }
    return { ok: true, value: { name, scope, spaceAccess, expiresInDays: rawExpiry } };
}

/**
 * ISO expiry timestamp for a key created at `now`, or null for "never".
 * @param {number|null} days
 * @param {Date} [now]
 * @returns {string|null}
 */
export function expiryFromDays(days, now = new Date()) {
    if (days === null) return null;
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * True when an ISO expiry is set and not after `now`.
 * @param {string|null} expiresAt
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isExpired(expiresAt, now = new Date()) {
    if (!expiresAt) return false;
    const at = Date.parse(expiresAt);
    return Number.isFinite(at) && at <= now.getTime();
}

/**
 * A key may perform an action needing `required` scope. `write` implies `read`.
 * @param {string} keyScope
 * @param {'read'|'write'} required
 * @returns {boolean}
 */
export function scopeAllows(keyScope, required) {
    if (required === 'read') return keyScope === 'read' || keyScope === 'write';
    return keyScope === 'write';
}

/**
 * Fixed-window rate limiter, in memory. One process serves Panino, so a Map is
 * enough; a restart forgets the counts, which only ever errs towards allowing.
 * @param {{ limit: number, windowMs: number, now?: () => number }} options
 */
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
    const windows = new Map();
    return {
        /**
         * Count one request for `id`.
         * @param {string} id
         * @returns {{ allowed: boolean, retryAfterSeconds: number }}
         */
        hit(id) {
            const at = now();
            let window = windows.get(id);
            if (!window || at - window.start >= windowMs) {
                window = { start: at, count: 0 };
                windows.set(id, window);
            }
            window.count += 1;
            if (windows.size > 10_000) {
                for (const [key, value] of windows) {
                    if (at - value.start >= windowMs) windows.delete(key);
                }
            }
            if (window.count <= limit) return { allowed: true, retryAfterSeconds: 0 };
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.start + windowMs - at) / 1000)) };
        },
        reset() {
            windows.clear();
        },
    };
}

/**
 * Validate a Document title or folder name.
 * @param {unknown} value
 * @param {string} label  What to call it in the message ("title", "folder name")
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateName(value, label) {
    if (typeof value !== 'string') return { ok: false, error: `The ${label} must be text.` };
    const trimmed = value.trim();
    if (!trimmed) return { ok: false, error: `The ${label} cannot be empty.` };
    if (trimmed.length > 255) return { ok: false, error: `The ${label} can be at most 255 characters.` };
    if (CONTROL_CHARS.test(trimmed) || ANY_LINE_BREAK.test(trimmed)) {
        return { ok: false, error: `The ${label} contains characters that are not allowed.` };
    }
    return { ok: true, value: trimmed };
}

/**
 * A short excerpt of `content` around the first case-insensitive match of
 * `query`, or the opening of the content when the match is only in the title.
 * @param {string} content
 * @param {string} query
 * @param {number} [width]
 * @returns {string}
 */
export function makeSnippet(content, query, width = 160) {
    const text = String(content || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const index = query ? text.toLowerCase().indexOf(String(query).toLowerCase()) : -1;
    if (index < 0) return text.length > width ? `${text.slice(0, width).trimEnd()}…` : text;
    const half = Math.floor((width - query.length) / 2);
    const start = Math.max(0, index - Math.max(half, 0));
    const end = Math.min(text.length, start + width);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * Build lookups over a database's folders: each folder's slash-joined path
 * from the root, and the set of folders inside a root "Trash" folder.
 * Cycles in corrupted data stop the walk instead of looping.
 * @param {Array<{ id: string, name: string|null, parent_id: string|null, created_at?: string|null }>} folders
 * @returns {{ pathOf: (folderId: string|null) => string, trashFolderId: string|null, isInTrash: (folderId: string|null) => boolean }}
 */
export function buildFolderIndex(folders) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const pathCache = new Map();

    function chain(folderId) {
        const seen = new Set();
        const out = [];
        let current = folderId ? byId.get(folderId) : null;
        while (current && !seen.has(current.id)) {
            seen.add(current.id);
            out.push(current);
            current = current.parent_id ? byId.get(current.parent_id) : null;
        }
        return out;
    }

    const trashFolderId = findTrashFolderId(folders);

    return {
        pathOf(folderId) {
            if (!folderId) return '';
            if (!pathCache.has(folderId)) {
                pathCache.set(folderId, chain(folderId).reverse().map((folder) => folder.name || 'Untitled').join('/'));
            }
            return pathCache.get(folderId);
        },
        trashFolderId,
        isInTrash(folderId) {
            if (!trashFolderId || !folderId) return false;
            return chain(folderId).some((folder) => folder.id === trashFolderId);
        },
    };
}

/** Name of the folder API deletes move Documents into. */
export const TRASH_FOLDER_NAME = 'Trash';

/**
 * The oldest root folder named "Trash" (any case), or null.
 * @param {Array<{ id: string, name: string|null, parent_id: string|null, created_at?: string|null }>} folders
 * @returns {string|null}
 */
export function findTrashFolderId(folders) {
    const candidates = folders
        .filter((folder) => !folder.parent_id && String(folder.name || '').trim().toLowerCase() === 'trash')
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || a.id.localeCompare(b.id));
    return candidates[0]?.id ?? null;
}

/**
 * Encode and decode the opaque pagination cursor of `GET /v1/documents`.
 * @param {{ updated_at: string|null, id: string }} row
 * @returns {string}
 */
export function encodeDocumentCursor(row) {
    return Buffer.from(JSON.stringify([row.updated_at ?? '', row.id]), 'utf8').toString('base64url');
}

/**
 * @param {unknown} value
 * @returns {{ updatedAt: string, id: string } | null}
 */
export function decodeDocumentCursor(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
        const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (!Array.isArray(decoded) || decoded.length !== 2) return null;
        if (typeof decoded[0] !== 'string' || typeof decoded[1] !== 'string') return null;
        return { updatedAt: decoded[0], id: decoded[1] };
    } catch {
        return null;
    }
}

/**
 * Parse a positive integer limit with a default and a ceiling.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
export function parseLimit(value, fallback, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.floor(parsed), max);
}
