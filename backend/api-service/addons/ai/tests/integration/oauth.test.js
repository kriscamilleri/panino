// OAuth 2.1 for MCP clients, end to end (docs/specs/active/ai-integration.md §6).
import crypto from 'crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getAuthDb, getUserDb } from '../../../../db.js';
import { setAddonEnabled } from '../../../registry.js';
import { setMetadataFetcher } from '../../oauthClients.js';
import { aiUser, createTestApp, offerAiAddon, resetAiState } from '../aiTestSetup.js';

const ISSUER = 'https://panino.test';
const RESOURCE = 'https://panino.test/api/addons/ai/v1/mcp';
const CONSENT = 'https://panino.test/#/addons/ai/authorize';
const METADATA_URL = 'https://chat.example/oauth/client.json';
const CALLBACK = 'https://chat.example/oauth/callback';

const pkce = () => {
    const verifier = crypto.randomBytes(48).toString('base64url');
    return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

describe('AI agents add-on: OAuth', () => {
    let app;
    let server;
    let restore;
    let user;
    let fetched;

    beforeAll(() => {
        restore = offerAiAddon();
        ({ app, server } = createTestApp());
    });
    afterAll(() => {
        restore();
        return new Promise((resolve) => server.close(resolve));
    });
    beforeEach(async () => {
        resetAiState();
        fetched = [];
        setMetadataFetcher(async (url) => {
            fetched.push(url);
            if (url !== METADATA_URL) return { ok: false };
            return {
                ok: true,
                cacheControl: 'max-age=600',
                body: JSON.stringify({ client_id: METADATA_URL, client_name: 'Chat Example', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' }),
            };
        });
        user = await aiUser('oauth');
    });
    afterEach(() => user.cleanup());

    const session = (req) => req.set('Authorization', `Bearer ${user.jwt}`);

    function authorizeUrl(params) {
        const query = new URLSearchParams({
            response_type: 'code', client_id: METADATA_URL, redirect_uri: CALLBACK, state: 'st-1',
            code_challenge_method: 'S256', resource: RESOURCE, scope: 'documents:read documents:write', ...params,
        });
        return `/addons/ai/oauth/authorize?${query}`;
    }

    /** authorize → consent → approve; returns the code and the redirect it came back on. */
    async function signIn({ clientId = METADATA_URL, redirectUri = CALLBACK, access = 'write', spaceAccess = 'all', challenge } = {}) {
        const start = await request(app).get(authorizeUrl({ client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge }));
        expect(start.status).toBe(302);
        expect(start.headers.location.startsWith(`${CONSENT}?request=`)).toBe(true);
        const requestId = new URL(start.headers.location.replace('#/', '')).searchParams.get('request');
        const approved = await session(request(app).post(`/addons/ai/oauth/requests/${requestId}/approve`)).send({ access, spaceAccess });
        expect(approved.status).toBe(200);
        const back = new URL(approved.body.redirectTo);
        return { requestId, code: back.searchParams.get('code'), back };
    }

    const token = (form) => request(app).post('/addons/ai/oauth/token').type('form').send(form);
    const mcp = (accessToken, method = 'tools/list', params) => request(app).post('/addons/ai/v1/mcp')
        .set('Authorization', `Bearer ${accessToken}`).send({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) });

    describe('discovery', () => {
        it('publishes protected-resource metadata at the root and the resource path', async () => {
            for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/addons/ai/v1/mcp']) {
                const res = await request(app).get(path);
                expect(res.status).toBe(200);
                expect(res.body).toMatchObject({ resource: RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ['header'] });
            }
        });

        it('publishes authorization-server metadata clients rely on', async () => {
            const res = await request(app).get('/.well-known/oauth-authorization-server');
            expect(res.body).toMatchObject({
                issuer: ISSUER,
                authorization_endpoint: 'https://panino.test/api/addons/ai/oauth/authorize',
                token_endpoint: 'https://panino.test/api/addons/ai/oauth/token',
                registration_endpoint: 'https://panino.test/api/addons/ai/oauth/register',
                code_challenge_methods_supported: ['S256'],
                token_endpoint_auth_methods_supported: ['none'],
                client_id_metadata_document_supported: true,
                authorization_response_iss_parameter_supported: true,
                scopes_supported: expect.arrayContaining(['documents:read', 'documents:write', 'offline_access']),
            });
        });

        it('answers 503 when production lacks the public URLs', async () => {
            const saved = { api: process.env.PUBLIC_API_BASE_URL, env: process.env.NODE_ENV };
            delete process.env.PUBLIC_API_BASE_URL;
            process.env.NODE_ENV = 'production';
            try {
                expect((await request(app).get('/.well-known/oauth-authorization-server')).status).toBe(503);
            } finally {
                process.env.PUBLIC_API_BASE_URL = saved.api;
                process.env.NODE_ENV = saved.env;
            }
        });
    });

    describe('a metadata-document client, start to finish', () => {
        it('signs in, uses MCP, refreshes with rotation, and is disconnected', async () => {
            const { verifier, challenge } = pkce();
            const { code, back } = await signIn({ challenge });
            expect(back.origin + back.pathname).toBe(CALLBACK);
            expect(back.searchParams.get('state')).toBe('st-1');
            expect(back.searchParams.get('iss')).toBe(ISSUER);
            expect(fetched).toEqual([METADATA_URL]);

            const issued = await token({ grant_type: 'authorization_code', code, client_id: METADATA_URL, redirect_uri: CALLBACK, code_verifier: verifier, resource: RESOURCE });
            expect(issued.status).toBe(200);
            expect(issued.headers['cache-control']).toBe('no-store');
            expect(issued.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'documents:read documents:write' });
            expect(issued.body.access_token).toMatch(/^pna_/);
            expect(issued.body.refresh_token).toMatch(/^pnr_/);

            const tools = await mcp(issued.body.access_token);
            expect(tools.status).toBe(200);
            expect(tools.body.result.tools).toHaveLength(14);

            getUserDb(user.userId).prepare(`INSERT INTO notes (id, user_id, title, content, created_at, updated_at)
                VALUES ('o-1', ?, 'Log', 'x', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`).run(user.userId);
            await mcp(issued.body.access_token, 'tools/call', { name: 'append_to_document', arguments: { id: 'o-1', content: 'y' } });
            const revision = getUserDb(user.userId).prepare("SELECT actor_kind, actor_label FROM note_revisions WHERE note_id = 'o-1' AND actor_kind IS NOT NULL").get();
            expect(revision).toEqual({ actor_kind: 'app', actor_label: 'Chat Example' });

            // Access tokens are for MCP only.
            expect((await request(app).get('/addons/ai/v1/me').set('Authorization', `Bearer ${issued.body.access_token}`)).status).toBe(401);

            const listed = await session(request(app).get('/addons/ai/connections'));
            expect(listed.body.connections).toEqual([expect.objectContaining({ name: 'Chat Example', host: 'chat.example', scope: 'write', spaceAccess: 'all' })]);

            const refreshed = await token({ grant_type: 'refresh_token', refresh_token: issued.body.refresh_token, client_id: METADATA_URL });
            expect(refreshed.status).toBe(200);
            expect(refreshed.body.refresh_token).not.toBe(issued.body.refresh_token);
            expect((await mcp(issued.body.access_token)).status).toBe(401);
            expect((await mcp(refreshed.body.access_token)).status).toBe(200);

            const id = listed.body.connections[0].id;
            expect((await session(request(app).delete(`/addons/ai/connections/${id}`))).status).toBe(200);
            expect((await mcp(refreshed.body.access_token)).status).toBe(401);
            const afterDisconnect = await token({ grant_type: 'refresh_token', refresh_token: refreshed.body.refresh_token });
            expect(afterDisconnect.body.error).toBe('invalid_grant');
        });

        it('ends the connection when a rotated refresh token is replayed', async () => {
            const { verifier, challenge } = pkce();
            const { code } = await signIn({ challenge });
            const issued = await token({ grant_type: 'authorization_code', code, client_id: METADATA_URL, redirect_uri: CALLBACK, code_verifier: verifier });
            const rotated = await token({ grant_type: 'refresh_token', refresh_token: issued.body.refresh_token });
            expect(rotated.status).toBe(200);
            const replay = await token({ grant_type: 'refresh_token', refresh_token: issued.body.refresh_token });
            expect(replay.body.error).toBe('invalid_grant');
            expect((await mcp(rotated.body.access_token)).status).toBe(401);
            expect((await token({ grant_type: 'refresh_token', refresh_token: rotated.body.refresh_token })).body.error).toBe('invalid_grant');
        });

        it('honours read-only, personal-only consent', async () => {
            const { verifier, challenge } = pkce();
            const { code } = await signIn({ challenge, access: 'read', spaceAccess: 'personal' });
            const issued = await token({ grant_type: 'authorization_code', code, client_id: METADATA_URL, redirect_uri: CALLBACK, code_verifier: verifier });
            expect(issued.body.scope).toBe('documents:read');
            const tools = await mcp(issued.body.access_token);
            expect(tools.body.result.tools.map((tool) => tool.name)).not.toContain('append_to_document');
        });
    });

    describe('the code exchange', () => {
        async function codeFor() {
            const { verifier, challenge } = pkce();
            const { code } = await signIn({ challenge });
            return { verifier, code };
        }

        it('refuses a wrong verifier, client, redirect URI or resource', async () => {
            for (const change of [
                { code_verifier: crypto.randomBytes(48).toString('base64url') },
                { client_id: 'https://other.example/client.json' },
                { redirect_uri: 'https://chat.example/other' },
                { resource: 'https://panino.test/api/elsewhere' },
            ]) {
                const { verifier, code } = await codeFor();
                const res = await token({ grant_type: 'authorization_code', code, client_id: METADATA_URL, redirect_uri: CALLBACK, code_verifier: verifier, ...change });
                expect(res.status, JSON.stringify(change)).toBe(400);
                expect(['invalid_grant', 'invalid_target']).toContain(res.body.error);
            }
        });

        it('lets a client retry after a wrong parameter, without spending the code', async () => {
            const { verifier, code } = await codeFor();
            const form = { grant_type: 'authorization_code', code, client_id: METADATA_URL, redirect_uri: CALLBACK, code_verifier: verifier };
            expect((await token({ ...form, redirect_uri: 'https://chat.example/other' })).body.error).toBe('invalid_grant');
            expect((await token({ ...form, code_verifier: crypto.randomBytes(48).toString('base64url') })).body.error).toBe('invalid_grant');
            const retried = await token(form);
            expect(retried.status).toBe(200);
            expect((await mcp(retried.body.access_token)).status).toBe(200);
        });

        it('accepts an omitted redirect_uri, since PKCE binds the code', async () => {
            const { verifier, code } = await codeFor();
            const res = await token({ grant_type: 'authorization_code', code, client_id: METADATA_URL, code_verifier: verifier });
            expect(res.status).toBe(200);
        });

        it('uses a code once; a second use ends the connection', async () => {
            const { verifier, code } = await codeFor();
            const form = { grant_type: 'authorization_code', code, client_id: METADATA_URL, redirect_uri: CALLBACK, code_verifier: verifier };
            const first = await token(form);
            expect(first.status).toBe(200);
            const second = await token(form);
            expect(second.body.error).toBe('invalid_grant');
            expect((await mcp(first.body.access_token)).status).toBe(401);
        });

        it('refuses an expired code', async () => {
            const { verifier, code } = await codeFor();
            getAuthDb().prepare('UPDATE ai_oauth_codes SET expires_at = ?').run('2020-01-01T00:00:00.000Z');
            const res = await token({ grant_type: 'authorization_code', code, client_id: METADATA_URL, redirect_uri: CALLBACK, code_verifier: verifier });
            expect(res.body.error).toBe('invalid_grant');
        });

        it('accepts JSON bodies too and refuses other grants', async () => {
            const { verifier, code } = await codeFor();
            const res = await request(app).post('/addons/ai/oauth/token')
                .send({ grant_type: 'authorization_code', code, client_id: METADATA_URL, redirect_uri: CALLBACK, code_verifier: verifier });
            expect(res.status).toBe(200);
            expect((await token({ grant_type: 'client_credentials' })).body.error).toBe('unsupported_grant_type');
        });
    });

    describe('the authorization request', () => {
        it('shows its own error page for an unknown client or an unregistered redirect', async () => {
            const unknown = await request(app).get(authorizeUrl({ client_id: 'https://nobody.example/c.json', code_challenge: pkce().challenge }));
            expect(unknown.headers.location).toBe(`${CONSENT}?error=invalid_client`);
            const wrongRedirect = await request(app).get(authorizeUrl({ redirect_uri: 'https://evil.example/cb', code_challenge: pkce().challenge }));
            expect(wrongRedirect.headers.location).toBe(`${CONSENT}?error=invalid_redirect_uri`);
        });

        it('never fetches a metadata document from a private address', async () => {
            setMetadataFetcher(null); // the real fetcher, through safeFetch.js
            const pending = () => getAuthDb().prepare('SELECT count(*) AS n FROM ai_oauth_requests').get().n;
            const before = pending();
            for (const clientId of ['https://127.0.0.1/client.json', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/client.json']) {
                const res = await request(app).get(authorizeUrl({ client_id: clientId, code_challenge: pkce().challenge }));
                expect(res.headers.location, clientId).toBe(`${CONSENT}?error=invalid_client`);
            }
            expect(pending()).toBe(before);
        });

        it('sends other errors back to the client with state and iss', async () => {
            const noPkce = await request(app).get(authorizeUrl({ code_challenge: '' }));
            const back = new URL(noPkce.headers.location);
            expect(back.origin + back.pathname).toBe(CALLBACK);
            expect(back.searchParams.get('error')).toBe('invalid_request');
            expect(back.searchParams.get('state')).toBe('st-1');
            expect(back.searchParams.get('iss')).toBe(ISSUER);
            const wrongResource = await request(app).get(authorizeUrl({ code_challenge: pkce().challenge, resource: 'https://elsewhere.example/mcp' }));
            expect(new URL(wrongResource.headers.location).searchParams.get('error')).toBe('invalid_target');
            const implicit = await request(app).get(authorizeUrl({ code_challenge: pkce().challenge, response_type: 'token' }));
            expect(new URL(implicit.headers.location).searchParams.get('error')).toBe('unsupported_response_type');
        });

        it('belongs to the first user who opens it, and can be denied', async () => {
            const start = await request(app).get(authorizeUrl({ code_challenge: pkce().challenge }));
            const requestId = new URL(start.headers.location.replace('#/', '')).searchParams.get('request');
            const view = await session(request(app).get(`/addons/ai/oauth/requests/${requestId}`));
            expect(view.body.request).toMatchObject({
                client: { name: 'Chat Example', kind: 'metadata', host: 'chat.example' },
                redirectHost: 'chat.example',
                redirectIsLoopback: false,
                requestedAccess: 'write',
            });

            const intruder = await aiUser('intruder');
            try {
                const stolen = await request(app).post(`/addons/ai/oauth/requests/${requestId}/approve`)
                    .set('Authorization', `Bearer ${intruder.jwt}`).send({ access: 'write', spaceAccess: 'all' });
                expect(stolen.status).toBe(404);
            } finally {
                intruder.cleanup();
            }

            const denied = await session(request(app).post(`/addons/ai/oauth/requests/${requestId}/deny`));
            const back = new URL(denied.body.redirectTo);
            expect(back.searchParams.get('error')).toBe('access_denied');
            expect(back.searchParams.get('iss')).toBe(ISSUER);
            expect((await session(request(app).post(`/addons/ai/oauth/requests/${requestId}/approve`)).send({ access: 'read', spaceAccess: 'all' })).status).toBe(404);
        });

        it('keeps the request open when the app limit refuses, so Connect can be pressed again', async () => {
            const db = getAuthDb();
            const insert = db.prepare(`
                INSERT INTO ai_oauth_grants (id, user_id, client_id, client_name, client_kind, redirect_uri, scope, space_access, resource, created_at)
                VALUES (?, ?, ?, 'Other app', 'registered', 'https://other.example/cb', 'write', 'all', ?, ?)
            `);
            for (let i = 0; i < 20; i += 1) insert.run(`limit-${i}`, user.userId, `client-${i}`, RESOURCE, '2026-11-01T00:00:00.000Z');

            const start = await request(app).get(authorizeUrl({ code_challenge: pkce().challenge }));
            const requestId = new URL(start.headers.location.replace('#/', '')).searchParams.get('request');
            const refused = await session(request(app).post(`/addons/ai/oauth/requests/${requestId}/approve`)).send({ access: 'write', spaceAccess: 'all' });
            expect(refused.status).toBe(409);
            expect(refused.body.code).toBe('APP_LIMIT');
            expect(db.prepare('SELECT completed_at FROM ai_oauth_requests WHERE id = ?').get(requestId).completed_at).toBeNull();

            await session(request(app).delete('/addons/ai/connections/limit-0')).expect(200);
            const approved = await session(request(app).post(`/addons/ai/oauth/requests/${requestId}/approve`)).send({ access: 'write', spaceAccess: 'all' });
            expect(approved.status).toBe(200);
            expect(new URL(approved.body.redirectTo).searchParams.get('code')).toBeTruthy();
        });

        it('needs the add-on on to consent', async () => {
            const start = await request(app).get(authorizeUrl({ code_challenge: pkce().challenge }));
            const requestId = new URL(start.headers.location.replace('#/', '')).searchParams.get('request');
            await setAddonEnabled(user.userId, 'ai', false);
            const view = await session(request(app).get(`/addons/ai/oauth/requests/${requestId}`));
            expect(view.status).toBe(403);
            expect(view.body.error).toBe('addon_disabled');
        });
    });

    describe('dynamic registration', () => {
        it('registers a public client that signs in on any loopback port', async () => {
            const reg = await request(app).post('/addons/ai/oauth/register')
                .send({ client_name: 'Gemini CLI', redirect_uris: ['http://localhost:7777/oauth/callback'], grant_types: ['authorization_code', 'refresh_token'] });
            expect(reg.status).toBe(201);
            expect(reg.body).toMatchObject({ client_name: 'Gemini CLI', token_endpoint_auth_method: 'none' });
            expect(reg.body.client_secret).toBeUndefined();

            const { verifier, challenge } = pkce();
            const start = await request(app).get(authorizeUrl({
                client_id: reg.body.client_id, redirect_uri: 'http://localhost:51234/oauth/callback', code_challenge: challenge,
            }));
            const requestId = new URL(start.headers.location.replace('#/', '')).searchParams.get('request');
            const view = await session(request(app).get(`/addons/ai/oauth/requests/${requestId}`));
            expect(view.body.request).toMatchObject({ client: { name: 'Gemini CLI', kind: 'registered', host: null }, redirectIsLoopback: true });
            const approved = await session(request(app).post(`/addons/ai/oauth/requests/${requestId}/approve`)).send({ access: 'write', spaceAccess: 'all' });
            const code = new URL(approved.body.redirectTo).searchParams.get('code');
            const issued = await token({ grant_type: 'authorization_code', code, client_id: reg.body.client_id, redirect_uri: 'http://localhost:51234/oauth/callback', code_verifier: verifier });
            expect(issued.status).toBe(200);
        });

        it('keeps a client that was ever approved, or is still signing in; prunes idle unapproved ones', async () => {
            const db = getAuthDb();
            const register = async (name) => (await request(app).post('/addons/ai/oauth/register')
                .send({ client_name: name, redirect_uris: ['http://127.0.0.1/cb'] }).expect(201)).body.client_id;
            const age = (clientId) => db.prepare('UPDATE ai_oauth_clients SET created_at = ?, last_used_at = NULL WHERE client_id = ?')
                .run('2020-01-01T00:00:00.000Z', clientId);
            const exists = (clientId) => Boolean(db.prepare('SELECT 1 FROM ai_oauth_clients WHERE client_id = ?').get(clientId));

            // Approved once, then disconnected: the app still holds this client_id.
            const disconnected = await register('Hosted app');
            const { requestId } = await signIn({ clientId: disconnected, redirectUri: 'http://127.0.0.1/cb', challenge: pkce().challenge });
            const grant = db.prepare('SELECT g.id FROM ai_oauth_grants g JOIN ai_oauth_requests r ON r.client_id = g.client_id WHERE r.id = ?').get(requestId);
            await session(request(app).delete(`/addons/ai/connections/${grant.id}`)).expect(200);
            age(disconnected);
            // Never approved, but started a sign-in just now.
            const signingIn = await register('Busy app');
            age(signingIn);
            await request(app).get(authorizeUrl({ client_id: signingIn, redirect_uri: 'http://127.0.0.1/cb', code_challenge: pkce().challenge })).expect(302);
            // Never approved and idle for over 30 days.
            const abandoned = await register('Abandoned app');
            age(abandoned);

            await register('Newcomer');
            expect(exists(disconnected)).toBe(true);
            expect(exists(signingIn)).toBe(true);
            expect(exists(abandoned)).toBe(false);

            // The disconnected app can reconnect with the client_id it kept.
            const again = await request(app).get(authorizeUrl({ client_id: disconnected, redirect_uri: 'http://127.0.0.1/cb', code_challenge: pkce().challenge }));
            expect(again.headers.location.startsWith(`${CONSENT}?request=`)).toBe(true);
        });

        it('refuses unsafe redirect URIs', async () => {
            const res = await request(app).post('/addons/ai/oauth/register').send({ redirect_uris: ['http://evil.example/cb'] });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('invalid_redirect_uri');
        });
    });

    describe('revocation and reconnection', () => {
        it('revokes by token and replaces a connection when the same app signs in again', async () => {
            const first = pkce();
            const one = await signIn({ challenge: first.challenge });
            const tokensOne = await token({ grant_type: 'authorization_code', code: one.code, client_id: METADATA_URL, redirect_uri: CALLBACK, code_verifier: first.verifier });
            const second = pkce();
            const two = await signIn({ challenge: second.challenge });
            const tokensTwo = await token({ grant_type: 'authorization_code', code: two.code, client_id: METADATA_URL, redirect_uri: CALLBACK, code_verifier: second.verifier });
            expect((await mcp(tokensOne.body.access_token)).status).toBe(401);
            expect((await session(request(app).get('/addons/ai/connections'))).body.connections).toHaveLength(1);

            const revoked = await request(app).post('/addons/ai/oauth/revoke').type('form').send({ token: tokensTwo.body.refresh_token });
            expect(revoked.status).toBe(200);
            expect((await mcp(tokensTwo.body.access_token)).status).toBe(401);
            expect((await request(app).post('/addons/ai/oauth/revoke').type('form').send({ token: 'junk' })).status).toBe(200);
        });
    });
});
