import { describe, it, expect } from 'vitest';
import {
    OdooError,
    createOdooClient,
    errorFromResponse,
    normalizeBaseUrl,
    odooTarget,
    verifyConnection,
} from '../../odooClient.js';

const json = (value) => Buffer.from(JSON.stringify(value));
// Error bodies as Odoo 19/20 sent them in Phase 0, with a traceback that must never surface.
const odooErrorBody = (name, message, status) => json({
    name, message, arguments: [message, status], context: {}, debug: 'Traceback (most recent call last):\n  File "/opt/odoo/odoo/http.py"…',
});

describe('normalizeBaseUrl', () => {
    it('keeps only the origin and defaults to https', () => {
        expect(normalizeBaseUrl('https://acme.odoo.com/odoo/action-123?debug=1')).toBe('https://acme.odoo.com');
        expect(normalizeBaseUrl('acme.odoo.com')).toBe('https://acme.odoo.com');
        expect(normalizeBaseUrl('  https://ERP.Example.com:8443/  ')).toBe('https://erp.example.com:8443');
    });

    it('refuses http except for allowed hosts, other schemes, credentials and junk', () => {
        expect(() => normalizeBaseUrl('http://acme.odoo.com')).toThrow(OdooError);
        expect(normalizeBaseUrl('http://odoo:8069', { allowHttpHosts: new Set(['odoo']) })).toBe('http://odoo:8069');
        for (const bad of ['', 'ftp://acme.com', 'https://user:pw@acme.com', 'javascript:alert(1)', 'https://', 'x'.repeat(3000)]) {
            expect(() => normalizeBaseUrl(bad), bad).toThrow(OdooError);
        }
    });
});

describe('odooTarget', () => {
    it('ties a link to the URL and database', () => {
        expect(odooTarget({ baseUrl: 'https://a.com', databaseName: 'prod' })).toBe('https://a.com|prod');
        expect(odooTarget({ baseUrl: 'https://a.com' })).toBe('https://a.com|');
    });
});

describe('errorFromResponse', () => {
    it('maps the responses Odoo actually sends', () => {
        const cases = [
            [401, odooErrorBody('werkzeug.exceptions.Unauthorized', 'Invalid apikey', 401), 'key_rejected'],
            [404, odooErrorBody('werkzeug.exceptions.NotFound', "the model 'documents.document' does not exist", 404), 'missing_app'],
            [404, Buffer.from('<!DOCTYPE html><title>Not Found</title>'), 'not_odoo'],
            [403, odooErrorBody('odoo.exceptions.AccessError', 'Private methods…', 403), 'access_denied'],
            [500, odooErrorBody('odoo.exceptions.MissingError', 'Record does not exist', 500), 'record_gone'],
            [422, odooErrorBody('werkzeug.exceptions.UnprocessableEntity', "got an unexpected keyword argument 'x'", 422), 'odoo_error'],
            [413, Buffer.from('Request Entity Too Large'), 'too_large'],
            [303, Buffer.from(''), 'unreachable'],
        ];
        for (const [status, body, code] of cases) {
            const error = errorFromResponse(status, body);
            expect(error.code, `${status}`).toBe(code);
            expect(error.message).toBe(code);
            expect(JSON.stringify(error)).not.toContain('Traceback');
        }
    });

    it('keeps only the exception class, for logs', () => {
        const error = errorFromResponse(401, odooErrorBody('werkzeug.exceptions.Unauthorized', 'Invalid apikey', 401));
        expect(error.odooName).toBe('werkzeug.exceptions.Unauthorized');
        expect(error.status).toBe(401);
    });
});

/** A transport that answers from a table keyed by path. */
function fakeTransport(routes, calls = []) {
    return async (url, options) => {
        const { pathname } = new URL(url);
        calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
        const route = routes[pathname];
        if (!route) return { status: 404, body: odooErrorBody('werkzeug.exceptions.NotFound', 'the model does not exist', 404) };
        const [status, value] = typeof route === 'function' ? route(options) : route;
        return { status, body: Buffer.isBuffer(value) ? value : json(value) };
    };
}

const connection = { baseUrl: 'https://acme.odoo.com', databaseName: 'acme', apiKey: 'k'.repeat(40) };

describe('createOdooClient', () => {
    it('posts named parameters with the bearer key and database header', async () => {
        const calls = [];
        const client = createOdooClient(connection, {
            transport: fakeTransport({ '/json/2/res.partner/search_read': [200, [{ id: 1 }]] }, calls),
        });
        expect(await client.call('res.partner', 'search_read', { domain: [], fields: ['name'] })).toEqual([{ id: 1 }]);
        const [call] = calls;
        expect(call.url).toBe('https://acme.odoo.com/json/2/res.partner/search_read');
        expect(call.options.method).toBe('POST');
        expect(call.options.headers.Authorization).toBe(`bearer ${'k'.repeat(40)}`);
        expect(call.options.headers['X-Odoo-Database']).toBe('acme');
        expect(call.options.allowedProtocols).toEqual(['https:']);
        expect(call.body).toEqual({ domain: [], fields: ['name'] });
    });

    it('never calls private methods or odd model names', async () => {
        const client = createOdooClient(connection, { transport: fakeTransport({}) });
        await expect(client.call('res.users', '_compute_display_name')).rejects.toThrow(/Invalid Odoo model or method/);
        await expect(client.call('res.users/../x', 'read')).rejects.toThrow(/Invalid Odoo model or method/);
        await expect(client.call('Res.Users', 'read')).rejects.toThrow(/Invalid Odoo model or method/);
    });

    it('allows http only for allowed hosts', async () => {
        const calls = [];
        const allowed = createOdooClient({ ...connection, baseUrl: 'http://odoo:8069' }, {
            allowHttpHosts: new Set(['odoo']),
            transport: fakeTransport({ '/json/2/res.users/context_get': [200, {}] }, calls),
        });
        await allowed.call('res.users', 'context_get');
        expect(calls[0].options.allowedProtocols).toEqual(['https:', 'http:']);
    });

    it('treats a non-JSON success as not Odoo', async () => {
        const client = createOdooClient(connection, {
            transport: fakeTransport({ '/web/version': [200, Buffer.from('<html>hello</html>')] }),
        });
        await expect(client.version()).rejects.toMatchObject({ code: 'not_odoo' });
    });
});

function odooServer({ major = 20, apps = ['crm.lead', 'sale.order', 'documents.document', 'knowledge.article'], forbidden = [] } = {}) {
    const routes = {
        '/web/version': [200, { version_info: [major, 0, 0, 'final', 0, 'e'], version: `${major}.0+e` }],
        '/json/2/res.users/context_get': [200, { lang: 'en_US', tz: 'Europe/Malta', uid: 2 }],
        '/json/2/res.users/read': [200, [{ id: 2, name: 'Mitchell Admin' }]],
    };
    for (const model of apps) {
        routes[`/json/2/${model}/search_count`] = forbidden.includes(model)
            ? [403, odooErrorBody('odoo.exceptions.AccessError', 'no', 403)]
            : [200, 0];
    }
    return routes;
}

describe('verifyConnection', () => {
    it('reports version, user and the apps this user can use', async () => {
        const client = createOdooClient(connection, {
            transport: fakeTransport(odooServer({ apps: ['crm.lead', 'sale.order', 'knowledge.article'], forbidden: ['sale.order'] })),
        });
        expect(await verifyConnection(client)).toEqual({
            version: '20.0+e', uid: 2, userName: 'Mitchell Admin', apps: ['knowledge', 'crm'],
        });
    });

    it('refuses Odoo before 19', async () => {
        const client = createOdooClient(connection, { transport: fakeTransport(odooServer({ major: 18 })) });
        await expect(verifyConnection(client)).rejects.toMatchObject({ code: 'not_odoo_19' });
    });

    it('stops at a rejected key', async () => {
        const routes = odooServer();
        routes['/json/2/res.users/context_get'] = [401, odooErrorBody('werkzeug.exceptions.Unauthorized', 'Invalid apikey', 401)];
        const client = createOdooClient(connection, { transport: fakeTransport(routes) });
        await expect(verifyConnection(client)).rejects.toMatchObject({ code: 'key_rejected' });
    });
});

describe('upload helpers', () => {
    it('picks datas on Odoo 19 and raw on Odoo 20, and caches per database and model', async () => {
        const { fileField, resetFileFieldCache } = await import('../../odooClient.js');
        resetFileFieldCache();
        const calls = [];
        const v19 = createOdooClient(connection, { transport: fakeTransport({ '/json/2/documents.document/fields_get': [200, { datas: { type: 'binary' }, raw: { type: 'binary' } }] }, calls) });
        const v20 = createOdooClient(connection, { transport: fakeTransport({ '/json/2/documents.document/fields_get': [200, { raw: { type: 'binary' } }] }) });
        expect(await fileField(v19, 'https://a|19', 'documents.document')).toBe('datas');
        expect(await fileField(v19, 'https://a|19', 'documents.document')).toBe('datas');
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toEqual({ allfields: ['datas', 'raw'], attributes: ['type'] });
        expect(await fileField(v20, 'https://a|20', 'documents.document')).toBe('raw');
        const neither = createOdooClient(connection, { transport: fakeTransport({ '/json/2/documents.document/fields_get': [200, {}] }) });
        await expect(fileField(neither, 'https://a|x', 'documents.document')).rejects.toMatchObject({ code: 'odoo_error' });
    });

    it('checks an attachment by SHA-1', async () => {
        const { verifyAttachment } = await import('../../odooClient.js');
        const crypto = await import('node:crypto');
        const bytes = Buffer.from('%PDF-1.4 hello');
        const good = createOdooClient(connection, { transport: fakeTransport({ '/json/2/ir.attachment/read': [200, [{ id: 7, checksum: crypto.createHash('sha1').update(bytes).digest('hex') }]] }) });
        await expect(verifyAttachment(good, 7, bytes)).resolves.toBeUndefined();
        const empty = createOdooClient(connection, { transport: fakeTransport({ '/json/2/ir.attachment/read': [200, [{ id: 7, checksum: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' }]] }) });
        await expect(verifyAttachment(empty, 7, bytes)).rejects.toMatchObject({ code: 'upload_corrupt' });
        const gone = createOdooClient(connection, { transport: fakeTransport({ '/json/2/ir.attachment/read': [200, []] }) });
        await expect(verifyAttachment(gone, 7, bytes)).rejects.toMatchObject({ code: 'record_gone' });
    });

    it('keeps only the path of Odoo’s own URLs', async () => {
        const { odooUrlPath } = await import('../../odooClient.js');
        expect(odooUrlPath('http://localhost:8069/odoo/documents/tok1')).toBe('/odoo/documents/tok1');
        expect(odooUrlPath('/knowledge/article/41')).toBe('/knowledge/article/41');
        expect(odooUrlPath('')).toBeNull();
        expect(odooUrlPath(false)).toBeNull();
    });

    it('names PDFs safely', async () => {
        const { pdfFileName } = await import('../../odooDocuments.js');
        expect(pdfFileName('Quote / Acme: v1')).toBe('Quote Acme v1.pdf');
        expect(pdfFileName('../../etc/passwd')).toBe('.. .. etc passwd.pdf');
        expect(pdfFileName('Report.PDF')).toBe('Report.pdf');
        expect(pdfFileName('  ')).toBe('Untitled.pdf');
        expect(pdfFileName('x'.repeat(500))).toHaveLength(204);
    });
});
