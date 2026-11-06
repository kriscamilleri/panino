import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
    cleanClientName,
    displayHost,
    grantedScope,
    hashSecret,
    isAllowedRedirectUri,
    isLoopbackRedirect,
    isMetadataClientId,
    looksLikeOAuthToken,
    metadataCacheMs,
    parseRequestedScope,
    randomToken,
    redirectUriMatches,
    validateClientMetadata,
    validateRegistration,
    verifyPkce,
    withQuery,
} from '../../oauthUtils.js';

const challengeFor = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

describe('tokens', () => {
    it('makes prefixed 256-bit tokens and recognises their shape', () => {
        const access = randomToken('pna_');
        const refresh = randomToken('pnr_');
        expect(looksLikeOAuthToken(access, 'pna_')).toBe(true);
        expect(looksLikeOAuthToken(refresh, 'pnr_')).toBe(true);
        expect(looksLikeOAuthToken(access, 'pnr_')).toBe(false);
        expect(looksLikeOAuthToken(`pnk_${'a'.repeat(43)}`, 'pna_')).toBe(false);
        expect(looksLikeOAuthToken(null, 'pna_')).toBe(false);
        expect(hashSecret(access)).toMatch(/^[0-9a-f]{64}$/);
        expect(randomToken()).not.toBe(randomToken());
    });
});

describe('PKCE S256', () => {
    const verifier = 'a'.repeat(20) + crypto.randomBytes(24).toString('base64url');

    it('accepts the matching verifier only', () => {
        const challenge = challengeFor(verifier);
        expect(verifyPkce(verifier, challenge)).toBe(true);
        expect(verifyPkce(`${verifier}x`, challenge)).toBe(false);
    });

    it('refuses verifiers outside 43..128 unreserved characters', () => {
        expect(verifyPkce('short', challengeFor('short'))).toBe(false);
        const long = 'b'.repeat(129);
        expect(verifyPkce(long, challengeFor(long))).toBe(false);
        const bad = `${'c'.repeat(43)}+`;
        expect(verifyPkce(bad, challengeFor(bad))).toBe(false);
        expect(verifyPkce(verifier, 'not-a-challenge')).toBe(false);
    });
});

describe('redirect URIs', () => {
    it.each([
        'https://claude.ai/api/mcp/auth_callback',
        'https://chatgpt.com/connector_platform_oauth_redirect',
        'http://localhost:33418/callback',
        'http://127.0.0.1/callback',
        'http://[::1]:8080/cb',
        'cursor://anysphere.cursor-mcp/oauth/callback',
        'com.example.app:/oauth2redirect',
    ])('allows %s', (uri) => {
        expect(isAllowedRedirectUri(uri)).toBe(true);
    });

    it.each([
        'http://example.com/callback',
        'https://example.com/cb#frag',
        'https://user:pass@example.com/cb',
        'javascript:alert(1)',
        'data:text/html,hi',
        'file:///etc/passwd',
        'mailto:a@b.c',
        'ws://localhost/x',
        'not a uri',
        42,
    ])('refuses %s', (uri) => {
        expect(isAllowedRedirectUri(uri)).toBe(false);
    });

    it('matches exactly, except loopback on any port', () => {
        const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback', 'http://127.0.0.1:9000/cb?x=1'];
        expect(redirectUriMatches('https://claude.ai/api/mcp/auth_callback', registered)).toBe(true);
        expect(redirectUriMatches('https://claude.ai/api/mcp/auth_callback/', registered)).toBe(false);
        expect(redirectUriMatches('http://localhost:55123/callback', registered)).toBe(true);
        expect(redirectUriMatches('http://localhost:55123/other', registered)).toBe(false);
        expect(redirectUriMatches('http://127.0.0.1:1234/cb?x=1', registered)).toBe(true);
        expect(redirectUriMatches('http://127.0.0.1:1234/cb?x=2', registered)).toBe(false);
        // Loopback names are not interchangeable.
        expect(redirectUriMatches('http://127.0.0.1:5000/callback', registered)).toBe(false);
        expect(redirectUriMatches('https://evil.example/cb', registered)).toBe(false);
    });

    it('tells loopback redirects apart and shows hosts', () => {
        expect(isLoopbackRedirect('http://localhost:3000/cb')).toBe(true);
        expect(isLoopbackRedirect('https://claude.ai/cb')).toBe(false);
        expect(displayHost('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai');
        expect(displayHost('cursor://anysphere.cursor-mcp/x')).toBe('anysphere.cursor-mcp');
        expect(displayHost('nope')).toBe('');
    });
});

describe('scopes', () => {
    it('reads write, read, and an empty scope as read & write to offer', () => {
        expect(parseRequestedScope(undefined)).toEqual({ ok: true, access: 'write', scopes: [] });
        expect(parseRequestedScope('documents:read')).toMatchObject({ ok: true, access: 'read' });
        expect(parseRequestedScope('documents:read documents:write offline_access')).toMatchObject({ ok: true, access: 'write' });
        expect(parseRequestedScope('openid email')).toMatchObject({ ok: true, access: 'read', scopes: [] });
        expect(parseRequestedScope('x'.repeat(600)).ok).toBe(false);
    });

    it('returns the granted scope string', () => {
        expect(grantedScope('read')).toBe('documents:read');
        expect(grantedScope('write')).toBe('documents:read documents:write');
    });
});

describe('client metadata documents', () => {
    const url = 'https://chatgpt.com/oauth/client.json';

    it('recognises metadata client ids', () => {
        expect(isMetadataClientId(url)).toBe(true);
        expect(isMetadataClientId('https://chatgpt.com')).toBe(false);
        expect(isMetadataClientId('https://chatgpt.com/')).toBe(false);
        expect(isMetadataClientId('http://chatgpt.com/client.json')).toBe(false);
        expect(isMetadataClientId('0b0e6c1e-2d4e-4d0e-9d3e-1a2b3c4d5e6f')).toBe(false);
    });

    it('validates a document', () => {
        const ok = validateClientMetadata({ client_id: url, client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/cb'] }, url);
        expect(ok).toEqual({ ok: true, client: { clientId: url, name: 'ChatGPT', redirectUris: ['https://chatgpt.com/cb'] } });
        expect(validateClientMetadata({ client_id: 'https://other/x', redirect_uris: ['https://a/cb'] }, url).ok).toBe(false);
        expect(validateClientMetadata({ client_id: url, redirect_uris: [] }, url).ok).toBe(false);
        expect(validateClientMetadata({ client_id: url, redirect_uris: ['javascript:x'] }, url).ok).toBe(false);
        expect(validateClientMetadata({ client_id: url, redirect_uris: ['https://a/cb'], token_endpoint_auth_method: 'client_secret_basic' }, url).ok).toBe(false);
        expect(validateClientMetadata([], url).ok).toBe(false);
    });

    it('falls back to the host when the name cannot be shown', () => {
        const result = validateClientMetadata({ client_id: url, client_name: 'bad\nname', redirect_uris: ['https://chatgpt.com/cb'] }, url);
        expect(result.client.name).toBe('chatgpt.com');
    });

    it('caches 5 minutes to 24 hours', () => {
        expect(metadataCacheMs(undefined)).toBe(5 * 60 * 1000);
        expect(metadataCacheMs('public, max-age=3600')).toBe(3600 * 1000);
        expect(metadataCacheMs('max-age=1')).toBe(5 * 60 * 1000);
        expect(metadataCacheMs('max-age=999999')).toBe(24 * 60 * 60 * 1000);
    });
});

describe('dynamic registration', () => {
    it('accepts a public client and cleans its name', () => {
        const result = validateRegistration({ client_name: '  Gemini CLI ', redirect_uris: ['http://localhost:7777/oauth/callback'] });
        expect(result).toEqual({ ok: true, value: { name: 'Gemini CLI', redirectUris: ['http://localhost:7777/oauth/callback'] } });
        expect(validateRegistration({ redirect_uris: ['https://x.example/cb'] }).value.name).toBe('x.example');
    });

    it.each([
        [null, 'invalid_client_metadata'],
        [{}, 'invalid_redirect_uri'],
        [{ redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri'],
        [{ redirect_uris: ['https://a.example/cb'], grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
        [{ redirect_uris: ['https://a.example/cb'], response_types: ['token'] }, 'invalid_client_metadata'],
    ])('refuses %j', (body, error) => {
        expect(validateRegistration(body)).toMatchObject({ ok: false, error });
    });
});

describe('small helpers', () => {
    it('cleans names and adds query parameters', () => {
        expect(cleanClientName('x'.repeat(100))).toHaveLength(60);
        expect(cleanClientName(5)).toBeNull();
        expect(withQuery('https://a.example/cb?keep=1', { code: 'c', state: undefined, iss: 'https://p' }))
            .toBe('https://a.example/cb?keep=1&code=c&iss=https%3A%2F%2Fp');
    });
});
