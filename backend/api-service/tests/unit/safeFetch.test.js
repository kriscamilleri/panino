import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { safeRequest } from '../../safeFetch.js';

describe('safeRequest', () => {
    let server;
    let port;
    let handler;
    let received;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                received.push({ method: req.method, url: req.url, headers: req.headers, body });
                handler(req, res);
            });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
    });

    afterAll(() => new Promise((resolve) => server.close(resolve)));

    beforeEach(() => {
        received = [];
        handler = (req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        };
    });

    // The local server is loopback, so these tests allow it explicitly.
    const local = { allowedProtocols: ['http:'], isAllowedAddress: () => true };

    it('sends the method, headers and body and returns the response', async () => {
        const result = await safeRequest(`http://127.0.0.1:${port}/json/2/res.users/context_get`, {
            ...local,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'bearer k' },
            body: '{"a":1}',
        });
        expect(result).toMatchObject({ ok: true, status: 200 });
        expect(JSON.parse(result.body.toString())).toEqual({ ok: true });
        expect(received[0]).toMatchObject({ method: 'POST', url: '/json/2/res.users/context_get', body: '{"a":1}' });
        expect(received[0].headers.authorization).toBe('bearer k');
    });

    it('allows only https by default', async () => {
        const result = await safeRequest(`http://127.0.0.1:${port}/`, { isAllowedAddress: () => true });
        expect(result).toEqual({ ok: false, reason: 'blocked', detail: 'unsupported scheme http:' });
        expect(received).toHaveLength(0);
    });

    it('refuses private addresses by default, before connecting', async () => {
        const result = await safeRequest(`http://127.0.0.1:${port}/`, { allowedProtocols: ['http:'] });
        expect(result).toMatchObject({ ok: false, reason: 'blocked' });
        expect(received).toHaveLength(0);
    });

    it('passes the hostname to the address policy, so a named host can be allowed', async () => {
        const seen = [];
        const result = await safeRequest(`http://odoo.internal:${port}/`, {
            allowedProtocols: ['http:'],
            lookup: async () => [{ address: '127.0.0.1', family: 4 }],
            isAllowedAddress: (ip, hostname) => { seen.push([ip, hostname]); return hostname === 'odoo.internal'; },
        });
        expect(result.ok).toBe(true);
        expect(seen).toEqual([['127.0.0.1', 'odoo.internal']]);
        expect(received[0].headers.host).toBe(`odoo.internal:${port}`);
    });

    it('does not follow redirects', async () => {
        handler = (req, res) => {
            res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
            res.end();
        };
        const result = await safeRequest(`http://127.0.0.1:${port}/`, local);
        expect(result).toMatchObject({ ok: true, status: 302 });
        expect(received).toHaveLength(1);
    });

    it('cuts off a body larger than the limit', async () => {
        handler = (req, res) => {
            res.writeHead(200);
            res.end('x'.repeat(5000));
        };
        const result = await safeRequest(`http://127.0.0.1:${port}/`, { ...local, maxBytes: 1000 });
        expect(result).toMatchObject({ ok: false, reason: 'failed' });
        expect(result.detail).toMatch(/exceeds 1000 bytes/);
    });

    it('refuses credentials in the URL and invalid URLs', async () => {
        expect(await safeRequest(`http://user:pass@127.0.0.1:${port}/`, local)).toMatchObject({ ok: false, reason: 'blocked' });
        expect(await safeRequest('not a url', local)).toMatchObject({ ok: false, reason: 'failed' });
        expect(received).toHaveLength(0);
    });

    it('times out a server that never answers', async () => {
        handler = () => {};
        const result = await safeRequest(`http://127.0.0.1:${port}/`, { ...local, timeoutMs: 200 });
        expect(result).toMatchObject({ ok: false, reason: 'failed' });
    });
});
