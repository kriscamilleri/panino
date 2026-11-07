// The MCP endpoint end to end, in both protocol eras
// (docs/specs/active/ai-integration.md §5).
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getUserDb } from '../../../../db.js';
import { aiUser, createKey, createTestApp, offerAiAddon, resetAiState } from '../aiTestSetup.js';

const MCP = '/addons/ai/v1/mcp';
const MODERN = '2026-07-28';

describe('AI agents add-on: MCP endpoint', () => {
    let app;
    let server;
    let restore;
    let user;
    let secret;

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
        user = await aiUser('mcp');
        ({ secret } = await createKey(app, user, { name: 'Gemini CLI' }));
    });
    afterEach(() => user.cleanup());

    let nextId = 1;
    const legacy = (method, params, key = secret) => request(app).post(MCP)
        .set('Authorization', `Bearer ${key}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) });

    const modern = (method, params = {}, { headers = {}, key = secret } = {}) => {
        const body = {
            jsonrpc: '2.0',
            id: nextId++,
            method,
            params: {
                ...params,
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': MODERN,
                    'io.modelcontextprotocol/clientCapabilities': {},
                    'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
                },
            },
        };
        return request(app).post(MCP)
            .set('Authorization', `Bearer ${key}`)
            .set('Accept', 'application/json, text/event-stream')
            .set('MCP-Protocol-Version', MODERN)
            .set('Mcp-Method', method)
            .set(method === 'tools/call' ? { 'Mcp-Name': params.name } : {})
            .set(headers)
            .send(body);
    };

    function insertNote(id, title, content, updatedAt = '2026-11-01T10:00:00.000Z') {
        getUserDb(user.userId).prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
            VALUES (?, ?, NULL, ?, ?, ?, ?)`).run(id, user.userId, title, content, updatedAt, updatedAt);
    }

    describe('transport', () => {
        it('401s without a credential, pointing at the resource metadata', async () => {
            const res = await request(app).post(MCP).send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
            expect(res.status).toBe(401);
            expect(res.headers['www-authenticate']).toBe(
                'Bearer resource_metadata="https://panino.test/.well-known/oauth-protected-resource/api/addons/ai/v1/mcp"',
            );
            const bad = await request(app).post(MCP).set('Authorization', `Bearer pnk_${'x'.repeat(43)}`).send({ jsonrpc: '2.0', id: 1, method: 'ping' });
            expect(bad.status).toBe(401);
            expect(bad.headers['www-authenticate']).toContain('error="invalid_token"');
        });

        it('refuses a session JWT', async () => {
            const res = await legacy('tools/list', undefined, user.jwt);
            expect(res.status).toBe(401);
        });

        it('answers GET and DELETE with 405, and refuses batches', async () => {
            const get = await request(app).get(MCP).set('Authorization', `Bearer ${secret}`);
            expect(get.status).toBe(405);
            expect(get.headers.allow).toBe('POST');
            expect((await request(app).delete(MCP).set('Authorization', `Bearer ${secret}`)).status).toBe(405);
            const batch = await request(app).post(MCP).set('Authorization', `Bearer ${secret}`)
                .send([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
            expect(batch.status).toBe(400);
            expect(batch.body.error.code).toBe(-32600);
        });

        it('refuses a browser page from another origin, allows the app and non-browser clients', async () => {
            const foreign = await legacy('ping').set('Origin', 'https://evil.example');
            expect(foreign.status).toBe(403);
            expect((await legacy('ping').set('Origin', 'https://panino.test')).status).toBe(200);
            expect((await legacy('ping')).status).toBe(200);
        });

        it('acknowledges notifications with 202 and no body', async () => {
            const res = await request(app).post(MCP).set('Authorization', `Bearer ${secret}`)
                .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            expect(res.status).toBe(202);
            expect(res.text).toBe('');
        });

        it('never issues a session id', async () => {
            const res = await legacy('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
            expect(res.headers['mcp-session-id']).toBeUndefined();
        });
    });

    describe('2025 clients', () => {
        it('negotiates the version and describes the server', async () => {
            const res = await legacy('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
            expect(res.status).toBe(200);
            expect(res.body.result).toMatchObject({
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'panino' },
                instructions: expect.stringContaining('search_documents'),
            });
            const newer = await legacy('initialize', { protocolVersion: '2025-11-25', capabilities: {} });
            expect(newer.body.result.protocolVersion).toBe('2025-11-25');
            const unknown = await legacy('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
            expect(unknown.body.result.protocolVersion).toBe('2025-11-25');
        });

        it('lists tools without 2026 fields, and answers unknown methods with -32601', async () => {
            const res = await legacy('tools/list');
            expect(res.body.result.tools).toHaveLength(11);
            expect(res.body.result.resultType).toBeUndefined();
            const unknown = await legacy('resources/list');
            expect(unknown.status).toBe(200);
            expect(unknown.body.error.code).toBe(-32601);
        });

        it('refuses an unsupported MCP-Protocol-Version header after initialize', async () => {
            const res = await legacy('tools/list').set('MCP-Protocol-Version', '1999-01-01');
            expect(res.status).toBe(400);
        });
    });

    describe('2026 clients', () => {
        it('discovers the server', async () => {
            const res = await modern('server/discover');
            expect(res.status).toBe(200);
            expect(res.body.result).toMatchObject({
                resultType: 'complete',
                supportedVersions: expect.arrayContaining([MODERN, '2025-11-25', '2025-06-18']),
                capabilities: { tools: {} },
                cacheScope: 'private',
                _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'panino' } },
            });
        });

        it('lists tools with cache hints', async () => {
            const res = await modern('tools/list');
            expect(res.body.result).toMatchObject({ resultType: 'complete', cacheScope: 'private', ttlMs: expect.any(Number) });
            expect(res.body.result.tools).toHaveLength(11);
        });

        it('checks the headers against the body', async () => {
            const wrongVersion = await modern('tools/list', {}, { headers: { 'MCP-Protocol-Version': '2025-11-25' } });
            expect(wrongVersion.status).toBe(400);
            expect(wrongVersion.body.error.code).toBe(-32020);
            const wrongMethod = await modern('tools/list', {}, { headers: { 'Mcp-Method': 'ping' } });
            expect(wrongMethod.body.error.code).toBe(-32020);
            const wrongName = await modern('tools/call', { name: 'get_account', arguments: {} }, { headers: { 'Mcp-Name': 'list_spaces' } });
            expect(wrongName.body.error.code).toBe(-32020);
            const encoded = await modern('tools/call', { name: 'get_account', arguments: {} },
                { headers: { 'Mcp-Name': `=?base64?${Buffer.from('get_account').toString('base64')}?=` } });
            expect(encoded.status).toBe(200);
            expect(encoded.body.result.isError).toBeUndefined();
        });

        it('refuses an unsupported version with the supported list', async () => {
            const res = await request(app).post(MCP).set('Authorization', `Bearer ${secret}`)
                .set('MCP-Protocol-Version', '2099-01-01').set('Mcp-Method', 'tools/list')
                .send({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: { _meta: {
                    'io.modelcontextprotocol/protocolVersion': '2099-01-01',
                    'io.modelcontextprotocol/clientCapabilities': {},
                } } });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatchObject({ code: -32022, data: { requested: '2099-01-01', supported: expect.arrayContaining([MODERN]) } });
        });

        it('maps unknown methods to 404 and missing capabilities to -32602', async () => {
            const unknown = await modern('resources/list');
            expect(unknown.status).toBe(404);
            expect(unknown.body.error.code).toBe(-32601);
            const res = await request(app).post(MCP).set('Authorization', `Bearer ${secret}`)
                .set('MCP-Protocol-Version', MODERN).set('Mcp-Method', 'tools/list')
                .send({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } } });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe(-32602);
        });
    });

    describe('tools', () => {
        const call = (name, args) => legacy('tools/call', { name, arguments: args });
        const text = (res) => res.body.result.content[0].text;

        it('finds, reads, appends and trashes, with model-readable text', async () => {
            insertNote('n-1', 'Weekly meeting log', '# Weekly\n\n- kickoff');

            const found = await call('search_documents', { query: 'weekly' });
            expect(text(found)).toContain('1. Weekly meeting log');
            expect(text(found)).toContain('id n-1');
            expect(found.body.result.structuredContent.results[0].id).toBe('n-1');

            const read = await call('get_document', { id: 'n-1' });
            expect(text(read)).toMatch(/^Title: Weekly meeting log\nid: n-1\n/);
            expect(text(read)).toContain('updated_at: 2026-11-01T10:00:00.000Z');
            expect(text(read)).toContain('- kickoff');

            const appended = await call('append_to_document', { id: 'n-1', content: '- decided X', expected_updated_at: '2026-11-01T10:00:00.000Z' });
            expect(appended.body.result.isError).toBeUndefined();
            expect(text(appended)).toMatch(/Appended to "Weekly meeting log"/);
            expect(getUserDb(user.userId).prepare('SELECT content FROM notes WHERE id = ?').get('n-1').content).toBe('# Weekly\n\n- kickoff\n\n- decided X');

            const label = getUserDb(user.userId).prepare("SELECT actor_kind, actor_label FROM note_revisions WHERE note_id = 'n-1' AND actor_kind IS NOT NULL").get();
            expect(label).toEqual({ actor_kind: 'api', actor_label: 'Gemini CLI' });

            const trashed = await call('move_document_to_trash', { id: 'n-1' });
            expect(text(trashed)).toContain('It can be moved back');
        });

        it('creates folders and Documents and lists the tree', async () => {
            const folder = await call('create_folder', { name: 'Projects' });
            const folderId = folder.body.result.structuredContent.folder.id;
            const created = await call('create_document', { title: 'Plan', content: '# Plan', folder_id: folderId });
            expect(text(created)).toMatch(/^Created "Plan" — folder Projects \(id /);
            const tree = await call('list_folders', {});
            expect(text(tree)).toContain('+ Projects/ (folder id');
            expect(text(tree)).toContain('  - Plan (id');
            const listed = await call('list_documents', { folder_id: folderId });
            expect(listed.body.result.structuredContent.documents).toHaveLength(1);
            const account = await call('get_account', {});
            expect(text(account)).toContain('Access: read and write (API key "Gemini CLI")');
        });

        it('turns rule failures into tool errors that say what to do next', async () => {
            insertNote('n-2', 'Doc', 'body');
            const conflict = await call('update_document', { id: 'n-2', content: 'new', expected_updated_at: '2020-01-01T00:00:00.000Z' });
            expect(conflict.status).toBe(200);
            expect(conflict.body.result.isError).toBe(true);
            expect(text(conflict)).toMatch(/Call get_document again.*Its updated_at is now 2026-11-01T10:00:00.000Z/);

            const missing = await call('get_document', { id: 'nope' });
            expect(missing.body.result.isError).toBe(true);
            expect(text(missing)).toContain('search_documents');

            const wrongType = await call('search_documents', { query: 42 });
            expect(text(wrongType)).toBe('The argument "query" must be text.');
            const absent = await call('get_document', {});
            expect(text(absent)).toBe('The argument "id" is required.');
            const loose = await call('list_documents', { limit: '2', include_trash: 'true' });
            expect(loose.body.result.isError).toBeUndefined();
        });

        it('answers an unknown tool or bad arguments with a protocol error', async () => {
            const unknown = await call('drop_database', {});
            expect(unknown.body.error.code).toBe(-32602);
            const badArgs = await legacy('tools/call', { name: 'get_account', arguments: [] });
            expect(badArgs.body.error.code).toBe(-32602);
        });

        it('hides write tools from a read-only key and refuses a forced write', async () => {
            const { secret: readKey } = await createKey(app, user, { name: 'Reader', scope: 'read' });
            const tools = await legacy('tools/list', undefined, readKey);
            expect(tools.body.result.tools.map((tool) => tool.name)).not.toContain('create_document');
            const forced = await legacy('tools/call', { name: 'create_document', arguments: { title: 'x' } }, readKey);
            expect(forced.body.result.isError).toBe(true);
            expect(forced.body.result.content[0].text).toContain('read-only');
        });
    });
});
