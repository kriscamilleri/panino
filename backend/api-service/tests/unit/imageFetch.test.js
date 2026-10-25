import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { fetchExternalImageAsDataUri, isPublicAddress } from '../../imageFetch.js';

// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('isPublicAddress', () => {
    it('rejects loopback, private, link-local, CGNAT, benchmark, mapped and unspecified addresses', () => {
        for (const ip of [
            '127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
            '169.254.169.254', '100.64.0.1', '100.127.255.254', '198.18.0.1', '198.19.255.255',
            '0.0.0.0', '255.255.255.255', '224.0.0.1', '240.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1',
            '::1', '::', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
            'fd00::1', 'fc00::1', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:0:7f00:1::1',
            '2001:2::1',
        ]) {
            expect(isPublicAddress(ip), ip).toBe(false);
        }
    });
    it('accepts public unicast addresses', () => {
        for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:2800:220:1:248:1893:25c8:1946', '2a00:1450:4001:80b::200e']) {
            expect(isPublicAddress(ip), ip).toBe(true);
        }
    });
    it('rejects garbage', () => {
        for (const v of ['', 'localhost', '1.2.3', '1.2.3.4.5', null, undefined, 42, '::ffff:999.1.1.1']) {
            expect(isPublicAddress(v), String(v)).toBe(false);
        }
    });
});

describe('fetchExternalImageAsDataUri', () => {
    let server;
    let port;
    let requests;
    let handler;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            requests.push({ url: req.url, host: req.headers.host });
            handler(req, res);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
    });

    afterAll(() => new Promise(resolve => server.close(resolve)));

    beforeEach(() => {
        requests = [];
        handler = (req, res) => {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(PNG);
        };
    });

    // Resolve every test hostname to the loopback server, and let the policy decide by
    // hostname-derived address so the redirect checks can be exercised locally.
    const ADDRESSES = { 'cdn.test': '127.0.0.1', 'internal.test': '127.0.0.2' };
    const lookup = async (hostname) => {
        if (!(hostname in ADDRESSES)) { const e = new Error('ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
        return [{ address: ADDRESSES[hostname], family: 4 }];
    };
    const isAllowedAddress = (ip) => ip === '127.0.0.1';
    const deps = { lookup, isAllowedAddress, timeoutMs: 3000 };

    it('connects to the checked address and keeps the hostname for the Host header', async () => {
        const result = await fetchExternalImageAsDataUri(`http://cdn.test:${port}/a.png`, deps);
        expect(result.ok).toBe(true);
        expect(result.dataUri).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
        expect(result.bytes).toBe(PNG.length);
        expect(requests).toEqual([{ url: '/a.png', host: `cdn.test:${port}` }]);
    });

    it('blocks a host that resolves to a disallowed address without connecting', async () => {
        const result = await fetchExternalImageAsDataUri(`http://internal.test:${port}/a.png`, deps);
        expect(result).toMatchObject({ ok: false, reason: 'blocked' });
        expect(requests).toEqual([]);
    });

    it('blocks a disallowed IP literal without a DNS lookup', async () => {
        let lookups = 0;
        const result = await fetchExternalImageAsDataUri(`http://127.0.0.1:${port}/a.png`, {
            lookup: async (...args) => { lookups += 1; return lookup(...args); },
        });
        expect(result).toMatchObject({ ok: false, reason: 'blocked' });
        expect(lookups).toBe(0);
        expect(requests).toEqual([]);
        const v6 = await fetchExternalImageAsDataUri(`http://[::ffff:127.0.0.1]:${port}/a.png`, {});
        expect(v6).toMatchObject({ ok: false, reason: 'blocked' });
    });

    it('blocks when any resolved address is disallowed', async () => {
        const result = await fetchExternalImageAsDataUri(`http://cdn.test:${port}/a.png`, {
            ...deps,
            lookup: async () => [{ address: '127.0.0.1', family: 4 }, { address: '127.0.0.2', family: 4 }],
        });
        expect(result).toMatchObject({ ok: false, reason: 'blocked' });
        expect(requests).toEqual([]);
    });

    it('re-checks the address on redirect and blocks a redirect to a private host', async () => {
        handler = (req, res) => {
            if (req.url === '/redirect') {
                res.writeHead(302, { Location: `http://internal.test:${port}/secret` });
                res.end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(PNG);
        };
        const result = await fetchExternalImageAsDataUri(`http://cdn.test:${port}/redirect`, deps);
        expect(result).toMatchObject({ ok: false, reason: 'blocked' });
        expect(requests.map(r => r.url)).toEqual(['/redirect']);
    });

    it('follows an allowed redirect, relative or absolute', async () => {
        handler = (req, res) => {
            if (req.url === '/r1') { res.writeHead(301, { Location: '/r2' }); res.end(); return; }
            if (req.url === '/r2') { res.writeHead(307, { Location: `http://cdn.test:${port}/final.png` }); res.end(); return; }
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(PNG);
        };
        const result = await fetchExternalImageAsDataUri(`http://cdn.test:${port}/r1`, deps);
        expect(result.ok).toBe(true);
        expect(requests.map(r => r.url)).toEqual(['/r1', '/r2', '/final.png']);
    });

    it('gives up after three redirect hops', async () => {
        handler = (req, res) => {
            const n = Number(req.url.slice(2) || 0);
            res.writeHead(302, { Location: `/r${n + 1}` });
            res.end();
        };
        const result = await fetchExternalImageAsDataUri(`http://cdn.test:${port}/r0`, deps);
        expect(result).toMatchObject({ ok: false, reason: 'failed' });
        expect(result.detail).toMatch(/redirects/);
        expect(requests.length).toBe(4);
    });

    it('rejects a redirect to a non-http scheme', async () => {
        handler = (req, res) => { res.writeHead(302, { Location: 'file:///etc/passwd' }); res.end(); };
        const result = await fetchExternalImageAsDataUri(`http://cdn.test:${port}/r`, deps);
        expect(result).toMatchObject({ ok: false, reason: 'failed' });
    });

    it('rejects non-image content types and non-200 statuses', async () => {
        handler = (req, res) => {
            if (req.url === '/html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<p>x</p>'); return; }
            res.writeHead(404); res.end();
        };
        expect(await fetchExternalImageAsDataUri(`http://cdn.test:${port}/html`, deps)).toMatchObject({ ok: false, reason: 'failed' });
        expect(await fetchExternalImageAsDataUri(`http://cdn.test:${port}/missing`, deps)).toMatchObject({ ok: false, reason: 'failed' });
    });

    it('stops reading once the body exceeds the limit, before it is fully sent', async () => {
        let sent = 0;
        handler = (req, res) => {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            const chunk = Buffer.alloc(64 * 1024, 1);
            const push = () => {
                if (res.destroyed) return;
                sent += chunk.length;
                if (sent >= 64 * 1024 * 200) { res.end(); return; }
                if (res.write(chunk)) setImmediate(push);
                else res.once('drain', push);
            };
            push();
        };
        const result = await fetchExternalImageAsDataUri(`http://cdn.test:${port}/big.png`, { ...deps, maxBytes: 200 * 1024 });
        expect(result).toMatchObject({ ok: false, reason: 'failed' });
        expect(result.detail).toMatch(/exceeds/);
        expect(sent).toBeLessThan(64 * 1024 * 200);
    });

    it('rejects a declared length over the limit without reading the body', async () => {
        handler = (req, res) => {
            res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(10 * 1024 * 1024) });
            res.write(PNG);
        };
        const result = await fetchExternalImageAsDataUri(`http://cdn.test:${port}/declared.png`, { ...deps, maxBytes: 1024 });
        expect(result).toMatchObject({ ok: false, reason: 'failed' });
        expect(result.detail).toMatch(/declared length/);
    });

    it('times out a server that never answers', async () => {
        handler = () => { /* hold the request open */ };
        const result = await fetchExternalImageAsDataUri(`http://cdn.test:${port}/slow.png`, { ...deps, timeoutMs: 300 });
        expect(result).toMatchObject({ ok: false, reason: 'failed' });
    });

    it('times out a server that trickles header bytes forever (no idle gap)', async () => {
        const trickler = net.createServer((socket) => {
            // The client destroys the connection at its deadline; a late write then fails
            // with EPIPE, which must not surface as an unhandled error.
            socket.on('error', () => {});
            socket.write('HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nX-Pad: ');
            const tick = setInterval(() => { if (!socket.destroyed) socket.write('x'); }, 20);
            socket.on('close', () => clearInterval(tick));
        });
        await new Promise(resolve => trickler.listen(0, '127.0.0.1', resolve));
        try {
            const started = Date.now();
            const result = await fetchExternalImageAsDataUri(`http://cdn.test:${trickler.address().port}/trickle.png`, { ...deps, timeoutMs: 400 });
            expect(result).toMatchObject({ ok: false, reason: 'failed' });
            expect(Date.now() - started).toBeLessThan(2000);
        } finally {
            await new Promise(resolve => trickler.close(resolve));
        }
    });

    it('reports an unknown host and an invalid URL as failures', async () => {
        expect(await fetchExternalImageAsDataUri('http://nope.test/x.png', deps)).toMatchObject({ ok: false, reason: 'failed' });
        expect(await fetchExternalImageAsDataUri('not a url', deps)).toMatchObject({ ok: false, reason: 'failed' });
        expect(await fetchExternalImageAsDataUri('ftp://cdn.test/x.png', deps)).toMatchObject({ ok: false, reason: 'failed' });
    });
});
