import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../../../../tests/testHelpers.js';
import { resetOdooRateLimits } from '../../routes.js';
import { resetSaleOrderCatalogCache } from '../../saleOrderBlocks.js';
import { API_KEY, resetFakeOdoo, startFakeOdoo } from '../fakeOdoo.js';

describe('Sales order blocks', () => {
    let app;
    let odoo;
    let user;
    let token;
    const saved = {};

    beforeAll(async () => {
        for (const name of ['ODOO_INTEGRATION_ENABLED', 'ODOO_CREDENTIAL_ENCRYPTION_KEY', 'ODOO_ALLOWED_PRIVATE_HOSTS']) saved[name] = process.env[name];
        ({ app } = createTestApp());
        odoo = await startFakeOdoo();
    });

    afterAll(async () => {
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
        await new Promise((resolve) => odoo.server.close(resolve));
    });

    beforeEach(async () => {
        process.env.ODOO_INTEGRATION_ENABLED = 'true';
        process.env.ODOO_CREDENTIAL_ENCRYPTION_KEY = 'test-odoo-credential-key-0123456789abcdef';
        process.env.ODOO_ALLOWED_PRIVATE_HOSTS = '127.0.0.1';
        resetFakeOdoo(odoo.state);
        resetOdooRateLimits();
        resetSaleOrderCatalogCache();
        user = await setupTestUser(`odoo-blocks-${Date.now()}@example.test`, 'password123');
        token = getTestToken(user.userId);
    });

    afterEach(() => {
        cleanupTestUser(user.userId);
    });

    const get = (path) => request(app).get(path).set('Authorization', `Bearer ${token}`);
    const calls = (suffix) => odoo.state.requests.filter((r) => r.url.endsWith(suffix));

    async function connect() {
        await request(app).put('/addons/odoo/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: true });
        const response = await request(app).put('/addons/odoo').set('Authorization', `Bearer ${token}`).send({
            baseUrl: `http://127.0.0.1:${odoo.port}`, databaseName: 'panino', apiKey: API_KEY,
        });
        expect(response.status).toBe(200);
    }

    it('searches sales orders only', async () => {
        await connect();
        const response = await get('/addons/odoo/sale-orders?q=deco');
        expect(response.status).toBe(200);
        expect(response.body.orders).toEqual([{ id: 2, name: 'S00002', partnerName: 'Deco Addict', status: 'Quotation' }]);
        expect(calls('/crm.lead/search_read')).toHaveLength(0);
    });

    it('lists the fields that may be shown, with the defaults this Odoo has', async () => {
        await connect();
        const response = await get('/addons/odoo/sale-orders/fields');
        expect(response.status).toBe(200);
        const orderNames = response.body.order.map((field) => field.name);
        expect(orderNames).toContain('partner_id');
        expect(orderNames).not.toContain('note');
        expect(orderNames).not.toContain('order_line');
        expect(orderNames).not.toContain('access_token');
        expect(response.body.line.map((field) => field.name)).not.toContain('product_image');
        expect(response.body.order.find((field) => field.name === 'amount_total')).toEqual({ name: 'amount_total', label: 'Total', type: 'monetary' });
        expect(response.body.defaults).toEqual({
            fields: ['partner_id', 'date_order', 'validity_date', 'user_id', 'state', 'amount_untaxed', 'amount_tax', 'amount_total'],
            columns: ['name', 'product_uom_qty', 'price_unit', 'discount', 'tax_ids', 'price_subtotal'],
        });
    });

    it('reads an order with the default values and columns', async () => {
        await connect();
        const response = await get('/addons/odoo/sale-orders/1');
        expect(response.status).toBe(200);
        const { order, fields, columns, lines, truncated } = response.body;
        expect(order).toEqual({ id: 1, name: 'S00001', url: `http://127.0.0.1:${odoo.port}/odoo/sale.order/1` });
        expect(truncated).toBe(false);
        expect(fields.map((field) => [field.label, field.cell])).toEqual([
            ['Customer', { type: 'text', value: 'Azure Interior' }],
            ['Order Date', { type: 'datetime', value: '2026-09-26T21:41:22Z' }],
            ['Expiration', { type: 'date', value: '2026-11-25' }],
            ['Salesperson', { type: 'text', value: 'Mitchell Admin' }],
            ['Status', { type: 'text', value: 'Sales Order' }],
            ['Untaxed Amount', { type: 'monetary', value: 1186.5, currency: { code: 'USD', symbol: '$', position: 'before', decimals: 2 } }],
            ['Taxes', expect.objectContaining({ type: 'monetary', value: 177.98 })],
            ['Total', expect.objectContaining({ type: 'monetary', value: 1364.48 })],
        ]);
        expect(columns.map((column) => column.label)).toEqual(['Description', 'Quantity', 'Unit Price', 'Discount (%)', 'Taxes', 'Subtotal']);
        expect(lines).toHaveLength(4);
        expect(lines[0].kind).toBe('line');
        expect(lines[0].cells[0]).toEqual({ type: 'text', value: '[FURN_6667] Acoustic Bloc Screens\nNoise-reducing panels' });
        expect(lines[0].cells[4]).toEqual({ type: 'text', value: '15%' });
        expect(lines[1]).toEqual({ kind: 'section', text: 'Services' });
        expect(lines[2].cells[4]).toEqual({ type: 'text', value: '15%, Eco tax' });
        expect(lines[3]).toEqual({ kind: 'note', text: 'Delivered <b>Monday</b>' });
    });

    it('reads only the chosen fields, in the chosen order, and never an unlisted one', async () => {
        await connect();
        const response = await get('/addons/odoo/sale-orders/1?fields=amount_total,note,tag_ids&columns=price_subtotal,product_image,product_id');
        expect(response.status).toBe(200);
        expect(response.body.fields.map((field) => field.name)).toEqual(['amount_total', 'tag_ids']);
        expect(response.body.fields[1].cell).toEqual({ type: 'text', value: 'Office' });
        expect(response.body.columns.map((column) => column.name)).toEqual(['price_subtotal', 'product_id']);
        const [orderRead] = calls('/sale.order/read');
        expect(orderRead.params.fields).not.toContain('note');
        const [lineRead] = calls('/sale.order.line/read');
        expect(lineRead.params.fields).not.toContain('product_image');
    });

    it('skips reading lines when no column is chosen', async () => {
        await connect();
        const response = await get('/addons/odoo/sale-orders/1?fields=&columns=');
        expect(response.status).toBe(200);
        expect(response.body.fields).toEqual([]);
        expect(response.body.lines).toEqual([]);
        expect(calls('/sale.order.line/read')).toHaveLength(0);
    });

    it('says when the order is gone', async () => {
        await connect();
        const response = await get('/addons/odoo/sale-orders/999');
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'record_gone', message: expect.stringContaining('no longer exists') });
    });

    it('refuses an order id that is not a positive number', async () => {
        await connect();
        for (const id of ['0', '-1', 'abc', '1.5', '99999999999999']) {
            const response = await get(`/addons/odoo/sale-orders/${id}`);
            expect(response.status).toBe(400);
        }
    });

    it('says when Sales is not available', async () => {
        odoo.state.apps = ['documents', 'knowledge'];
        await connect();
        const response = await get('/addons/odoo/sale-orders/fields');
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('missing_app');
    });

    it('needs a connection', async () => {
        await request(app).put('/addons/odoo/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: true });
        const response = await get('/addons/odoo/sale-orders/1');
        expect(response.status).toBe(404);
        expect(response.body.error).toBe('not_connected');
    });

    describe('saved layouts', () => {
        const send = (method, path, body) => request(app)[method](path).set('Authorization', `Bearer ${token}`).send(body);
        const enable = () => request(app).put('/addons/odoo/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: true });

        it('saves, lists, renames and deletes a layout, without an Odoo connection', async () => {
            await enable();
            const created = await send('post', '/addons/odoo/sale-order-layouts', { name: '  Short quote ', body: '## {{order.name}}\r\nTotal {{order.amount_total}}' });
            expect(created.status).toBe(201);
            expect(created.body).toMatchObject({ name: 'Short quote', body: '## {{order.name}}\nTotal {{order.amount_total}}' });
            await send('post', '/addons/odoo/sale-order-layouts', { name: 'another', body: 'x' });
            expect((await get('/addons/odoo/sale-order-layouts')).body.layouts.map((l) => l.name)).toEqual(['another', 'Short quote']);

            const updated = await send('put', `/addons/odoo/sale-order-layouts/${created.body.id}`, { name: 'Quote', body: 'y' });
            expect(updated.status).toBe(200);
            expect(updated.body).toMatchObject({ id: created.body.id, name: 'Quote', body: 'y' });

            expect((await send('delete', `/addons/odoo/sale-order-layouts/${created.body.id}`)).status).toBe(204);
            expect((await get('/addons/odoo/sale-order-layouts')).body.layouts.map((l) => l.name)).toEqual(['another']);
            expect((await send('put', `/addons/odoo/sale-order-layouts/${created.body.id}`, { name: 'Gone', body: 'z' })).status).toBe(404);
        });

        it('refuses a missing name, an empty or oversized body, and HTML comments', async () => {
            await enable();
            for (const body of [
                { name: '', body: 'x' },
                { name: 'n'.repeat(81), body: 'x' },
                { name: 'Empty', body: '   ' },
                { name: 'Big', body: 'x'.repeat(8001) },
                { name: 'Comment', body: 'a <!-- b' },
                { name: 'Closer', body: 'a --> b' },
            ]) {
                const response = await send('post', '/addons/odoo/sale-order-layouts', body);
                expect(response.status).toBe(400);
                expect(response.body.error).toBe('invalid');
            }
        });

        it('keeps one person’s layouts from another', async () => {
            await enable();
            await send('post', '/addons/odoo/sale-order-layouts', { name: 'Mine', body: 'x' });
            const other = await setupTestUser(`odoo-blocks-other-${Date.now()}@example.test`, 'password123');
            const otherToken = getTestToken(other.userId);
            await request(app).put('/addons/odoo/enabled').set('Authorization', `Bearer ${otherToken}`).send({ enabled: true });
            const theirs = await request(app).get('/addons/odoo/sale-order-layouts').set('Authorization', `Bearer ${otherToken}`);
            expect(theirs.body.layouts).toEqual([]);
            cleanupTestUser(other.userId);
        });
    });

    it('keeps Odoo’s error details to itself', async () => {
        await connect();
        odoo.state.keyValid = false;
        const response = await get('/addons/odoo/sale-orders/1');
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('key_rejected');
        expect(JSON.stringify(response.body)).not.toContain('Traceback');
    });
});
