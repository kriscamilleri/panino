import { describe, it, expect } from 'vitest';
import {
    API_KEY_DISPLAY_LENGTH,
    bearerFromHeader,
    buildFolderIndex,
    clientAddress,
    createRateLimiter,
    decodeDocumentCursor,
    encodeDocumentCursor,
    expiryFromDays,
    findTrashFolderId,
    generateApiKey,
    hashApiKey,
    isExpired,
    looksLikeApiKey,
    makeSnippet,
    parseLimit,
    scopeAllows,
    validateCreateKeyInput,
    validateName,
} from '../../keyUtils.js';

describe('API key generation', () => {
    it('makes a pnk_ key with 256 random bits, its hash and display prefix', () => {
        const { key, hash, prefix } = generateApiKey();
        expect(key).toMatch(/^pnk_[A-Za-z0-9_-]{43}$/);
        expect(looksLikeApiKey(key)).toBe(true);
        expect(hash).toBe(hashApiKey(key));
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(prefix).toBe(key.slice(0, API_KEY_DISPLAY_LENGTH));
        expect(prefix).toHaveLength(12);
    });

    it('never repeats', () => {
        const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().key));
        expect(keys.size).toBe(200);
    });

    it('does not take a JWT or junk for a key', () => {
        expect(looksLikeApiKey('eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiYSJ9.sig')).toBe(false);
        expect(looksLikeApiKey('pnk_short')).toBe(false);
        expect(looksLikeApiKey(`pnk_${'a'.repeat(43)}x`)).toBe(false);
        expect(looksLikeApiKey(null)).toBe(false);
    });

    it('reads a bearer credential', () => {
        expect(bearerFromHeader('Bearer abc')).toBe('abc');
        expect(bearerFromHeader('bearer   abc  ')).toBe('abc');
        expect(bearerFromHeader('Basic abc')).toBeNull();
        expect(bearerFromHeader('Bearer a b')).toBeNull();
        expect(bearerFromHeader(undefined)).toBeNull();
    });
});

describe('validateCreateKeyInput', () => {
    it('applies defaults: read, all spaces, 90 days', () => {
        expect(validateCreateKeyInput({ name: '  Claude  ' })).toEqual({
            ok: true, value: { name: 'Claude', scope: 'read', spaceAccess: 'all', expiresInDays: 90 },
        });
    });

    it('accepts write, personal and never', () => {
        const result = validateCreateKeyInput({ name: 'x', scope: 'write', spaceAccess: 'personal', expiresInDays: null });
        expect(result.value).toMatchObject({ scope: 'write', spaceAccess: 'personal', expiresInDays: null });
    });

    it.each([
        [{}, 'name'],
        [{ name: '   ' }, 'name'],
        [{ name: 'a'.repeat(61) }, '60'],
        [{ name: 'bad\nname' }, 'not allowed'],
        [{ name: 'x', scope: 'admin' }, 'Access'],
        [{ name: 'x', spaceAccess: 'some' }, 'Spaces'],
        [{ name: 'x', expiresInDays: 7 }, 'Expiry'],
        [{ name: 'x', expiresInDays: '90' }, 'Expiry'],
    ])('refuses %j', (body, fragment) => {
        const result = validateCreateKeyInput(body);
        expect(result.ok).toBe(false);
        expect(result.error).toContain(fragment);
    });
});

describe('expiry and scope', () => {
    const now = new Date('2026-11-06T10:00:00.000Z');

    it('computes and checks expiry', () => {
        expect(expiryFromDays(null, now)).toBeNull();
        expect(expiryFromDays(30, now)).toBe('2026-12-06T10:00:00.000Z');
        expect(isExpired(null, now)).toBe(false);
        expect(isExpired('2026-11-06T09:59:59.000Z', now)).toBe(true);
        expect(isExpired('2026-11-06T10:00:00.000Z', now)).toBe(true);
        expect(isExpired('2026-11-07T00:00:00.000Z', now)).toBe(false);
    });

    it('write implies read, read does not imply write', () => {
        expect(scopeAllows('write', 'read')).toBe(true);
        expect(scopeAllows('write', 'write')).toBe(true);
        expect(scopeAllows('read', 'read')).toBe(true);
        expect(scopeAllows('read', 'write')).toBe(false);
        expect(scopeAllows(undefined, 'read')).toBe(false);
    });
});

describe('createRateLimiter', () => {
    it('allows the limit per window, then reports the wait', () => {
        let clock = 0;
        const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => clock });
        expect(limiter.hit('k').allowed).toBe(true);
        expect(limiter.hit('k').allowed).toBe(true);
        clock = 15_000;
        expect(limiter.hit('k')).toEqual({ allowed: false, retryAfterSeconds: 45 });
        expect(limiter.hit('other').allowed).toBe(true);
        clock = 60_000;
        expect(limiter.hit('k').allowed).toBe(true);
    });

    it('checks without counting', () => {
        let clock = 0;
        const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => clock });
        expect(limiter.check('k').allowed).toBe(true);
        limiter.hit('k');
        expect(limiter.check('k').allowed).toBe(true);
        expect(limiter.check('k').allowed).toBe(true);
        limiter.hit('k');
        clock = 20_000;
        expect(limiter.check('k')).toEqual({ allowed: false, retryAfterSeconds: 40 });
        clock = 60_000;
        expect(limiter.check('k').allowed).toBe(true);
    });
});

describe('clientAddress', () => {
    it('prefers the address nginx saw, then the socket address', () => {
        expect(clientAddress({ headers: { 'x-real-ip': '203.0.113.9' }, ip: '127.0.0.1' })).toBe('203.0.113.9');
        expect(clientAddress({ headers: {}, ip: '127.0.0.1' })).toBe('127.0.0.1');
        expect(clientAddress({ headers: { 'x-real-ip': 'x'.repeat(64) }, ip: '127.0.0.1' })).toBe('127.0.0.1');
        expect(clientAddress({ headers: {} })).toBe('unknown');
    });
});

describe('validateName', () => {
    it('trims and accepts ordinary names', () => {
        expect(validateName('  Meeting notes ', 'title')).toEqual({ ok: true, value: 'Meeting notes' });
        expect(validateName('Résumé — 2026 📄', 'title').ok).toBe(true);
    });

    it.each([[42], [''], ['  '], ['a'.repeat(256)], ['a\u0000b'], ['two\nlines']])('refuses %j', (value) => {
        expect(validateName(value, 'title').ok).toBe(false);
    });
});

describe('makeSnippet', () => {
    it('centres on the first match and marks cuts', () => {
        const content = `${'lorem '.repeat(50)}the INVOICE is due ${'ipsum '.repeat(50)}`;
        const snippet = makeSnippet(content, 'invoice', 60);
        expect(snippet.toLowerCase()).toContain('invoice');
        expect(snippet.startsWith('…')).toBe(true);
        expect(snippet.endsWith('…')).toBe(true);
        expect(snippet.length).toBeLessThanOrEqual(62);
    });

    it('falls back to the opening when only the title matched', () => {
        expect(makeSnippet('Short body', 'nothing')).toBe('Short body');
        expect(makeSnippet(null, 'x')).toBe('');
    });
});

describe('buildFolderIndex', () => {
    const folders = [
        { id: 'a', name: 'Clients', parent_id: null, created_at: '1' },
        { id: 'b', name: 'Acme', parent_id: 'a', created_at: '2' },
        { id: 't2', name: 'trash', parent_id: null, created_at: '9' },
        { id: 't', name: 'Trash', parent_id: null, created_at: '3' },
        { id: 'tc', name: 'Old', parent_id: 't', created_at: '4' },
        { id: 'nested-trash', name: 'Trash', parent_id: 'a', created_at: '0' },
        { id: 'loop1', name: 'L1', parent_id: 'loop2' },
        { id: 'loop2', name: 'L2', parent_id: 'loop1' },
    ];

    it('builds slash paths', () => {
        const index = buildFolderIndex(folders);
        expect(index.pathOf('b')).toBe('Clients/Acme');
        expect(index.pathOf(null)).toBe('');
        expect(index.pathOf('missing')).toBe('');
    });

    it('takes the oldest root Trash and its descendants', () => {
        const index = buildFolderIndex(folders);
        expect(findTrashFolderId(folders)).toBe('t');
        expect(index.trashFolderId).toBe('t');
        expect(index.isInTrash('t')).toBe(true);
        expect(index.isInTrash('tc')).toBe(true);
        expect(index.isInTrash('t2')).toBe(false);
        expect(index.isInTrash('nested-trash')).toBe(false);
        expect(index.isInTrash(null)).toBe(false);
    });

    it('survives a parent cycle', () => {
        const index = buildFolderIndex(folders);
        expect(index.pathOf('loop1')).toBe('L2/L1');
        expect(index.isInTrash('loop1')).toBe(false);
    });

    it('has no Trash when none exists', () => {
        expect(buildFolderIndex([{ id: 'x', name: 'X', parent_id: null }]).trashFolderId).toBeNull();
    });
});

describe('cursor and limits', () => {
    it('round-trips the cursor and refuses junk', () => {
        const cursor = encodeDocumentCursor({ updated_at: '2026-11-06T10:00:00.000Z', id: 'n1' });
        expect(decodeDocumentCursor(cursor)).toEqual({ updatedAt: '2026-11-06T10:00:00.000Z', id: 'n1' });
        expect(decodeDocumentCursor('not-a-cursor')).toBeNull();
        expect(decodeDocumentCursor(Buffer.from('[1,2]').toString('base64url'))).toBeNull();
        expect(decodeDocumentCursor(undefined)).toBeNull();
    });

    it('parses limits', () => {
        expect(parseLimit(undefined, 20, 100)).toBe(20);
        expect(parseLimit('5', 20, 100)).toBe(5);
        expect(parseLimit('500', 20, 100)).toBe(100);
        expect(parseLimit('-1', 20, 100)).toBe(20);
    });
});
