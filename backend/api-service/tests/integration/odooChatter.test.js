import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { createTestApp, cleanupTestUser, getTestToken, setupTestUser } from '../testHelpers.js';
import { getUserDb } from '../../db.js';
import { resetOdooRateLimits } from '../../odoo.js';
import { resetFileFieldCache } from '../../odooClient.js';
import { API_KEY, resetFakeOdoo, startFakeOdoo } from '../fakeOdoo.js';

const PDF_REQUEST = { htmlContent: '<h1>Quote</h1><p>Hello Odoo</p>', cssStyles: '', printStyles: {} };

describe('Sending a Document’s PDF to an opportunity or a sales order', () => {
    let app;
    let odoo;
    let user;
    let token;
    let noteId;
    let dbKey;
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
        resetFileFieldCache();
        user = await setupTestUser(`odoo-chatter-${Date.now()}@example.test`, 'password123');
        token = getTestToken(user.userId);
        dbKey = `user:${user.userId}`;
        noteId = uuidv4();
        const now = new Date().toISOString();
        getUserDb(user.userId).prepare(`
            INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
            VALUES (?, ?, NULL, ?, ?, ?, ?)
        `).run(noteId, user.userId, 'Quote / Acme: v1', '# Quote', now, now);
    });

    afterEach(() => {
        cleanupTestUser(user.userId);
    });

    async function connect() {
        await request(app).put('/addons/odoo/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: true });
        const response = await request(app).put('/addons/odoo').set('Authorization', `Bearer ${token}`).send({
            baseUrl: `http://127.0.0.1:${odoo.port}`, databaseName: 'panino', apiKey: API_KEY,
        });
        expect(response.status).toBe(200);
        return response.body;
    }
    const send = (body) => request(app).post('/addons/odoo/send').set('Authorization', `Bearer ${token}`)
        .send({ dbKey, noteId, title: 'Quote / Acme: v1', pdfRequest: PDF_REQUEST, ...body });
    const links = () => getUserDb(user.userId).prepare("SELECT * FROM odoo_links WHERE source_id = ? AND destination = 'chatter' ORDER BY target_key").all(noteId);
    const calls = (suffix) => odoo.state.requests.filter((r) => r.url.endsWith(suffix));
    const notesOn = (model, resId) => odoo.state.messages.filter((m) => m.model === model && m.res_id === resId);

    it('stages the PDF, posts it as an internal note, and links the attachment', async () => {
        await connect();
        const response = await send({ chatter: { resModel: 'crm.lead', resId: 1 } });
        expect(response.status).toBe(200);
        expect(response.body.chatter).toMatchObject({ ok: true, created: true, recreated: false, noteMissing: false });
        expect(response.body.chatter.url).toBe(`http://127.0.0.1:${odoo.port}/odoo/crm.lead/1`);
        expect(response.body.documents).toBeUndefined();

        const [staged] = calls('/ir.attachment/create');
        expect(staged.params.vals_list[0]).toMatchObject({ name: 'Quote Acme v1.pdf', mimetype: 'application/pdf', res_model: 'mail.compose.message', res_id: 0 });
        expect(Object.keys(staged.params.vals_list[0])).toContain('raw');

        const [note] = notesOn('crm.lead', 1);
        expect(note).toMatchObject({ body: 'Quote Acme v1.pdf (PDF from Panino)', message_type: 'comment', subtype_xmlid: 'mail.mt_note' });
        const attachmentId = note.attachment_ids[0];
        expect(odoo.state.attachments.get(attachmentId).subarray(0, 5).toString()).toBe('%PDF-');
        expect(odoo.state.attachmentMeta.get(attachmentId)).toMatchObject({ res_model: 'crm.lead', res_id: 1 });

        expect(links()).toEqual([expect.objectContaining({
            target_key: 'crm.lead:1', odoo_record_id: attachmentId, odoo_message_id: note.id,
            odoo_create_date: odoo.state.attachmentMeta.get(attachmentId).create_date, odoo_url_path: '/odoo/crm.lead/1',
            first_sent_by: user.userId, last_sent_by: user.userId,
        })]);
    });

    it('works for a sales order too, with datas on Odoo 19', async () => {
        odoo.state.version = 19;
        await connect();
        const response = await send({ chatter: { resModel: 'sale.order', resId: 1 } });
        expect(response.body.chatter).toMatchObject({ ok: true, created: true });
        expect(response.body.chatter.url).toMatch(/\/odoo\/sale\.order\/1$/);
        expect(Object.keys(calls('/ir.attachment/create')[0].params.vals_list[0])).toContain('datas');
        expect(notesOn('sale.order', 1)).toHaveLength(1);
    });

    it('always posts a note, whatever the client asks for, and never writes the record', async () => {
        await connect();
        const response = await send({ chatter: { resModel: 'crm.lead', resId: 1, subtype_xmlid: 'mail.mt_comment', message_type: 'email', body: '<b>hi</b>' } });
        expect(response.body.chatter.ok).toBe(true);
        const [note] = notesOn('crm.lead', 1);
        expect(note.subtype_xmlid).toBe('mail.mt_note');
        expect(note.message_type).toBe('comment');
        expect(note.body).toBe('Quote Acme v1.pdf (PDF from Panino)');
        expect(calls('/crm.lead/write')).toHaveLength(0);
        expect(calls('/crm.lead/unlink')).toHaveLength(0);
        expect(calls('/crm.lead/message_post')).toHaveLength(1);
        expect(calls('/crm.lead/read').map((c) => c.params)).toEqual([{ ids: [1], fields: ['name'] }]);
    });

    it('overwrites the PDF on the same record and posts one "replaced" note', async () => {
        await connect();
        await send({ chatter: { resModel: 'crm.lead', resId: 1 } });
        const [first] = links();
        const response = await send({ title: 'Quote v2', chatter: { resModel: 'crm.lead', resId: 1 } });
        expect(response.body.chatter).toMatchObject({ ok: true, created: false, recreated: false, noteMissing: false });

        expect(calls('/ir.attachment/create')).toHaveLength(1);
        expect(calls('/ir.attachment/write')).toHaveLength(1);
        expect(calls('/ir.attachment/write')[0].params.ids).toEqual([first.odoo_record_id]);
        expect(odoo.state.attachmentMeta.get(first.odoo_record_id).name).toBe('Quote v2.pdf');
        expect(calls('/crm.lead/write')).toHaveLength(0);

        const notes = notesOn('crm.lead', 1);
        expect(notes).toHaveLength(2);
        expect(notes[1]).toMatchObject({ body: 'Quote v2.pdf was replaced with a new version from Panino.', subtype_xmlid: 'mail.mt_note', attachment_ids: [] });

        const [after] = links();
        expect(after.odoo_record_id).toBe(first.odoo_record_id);
        expect(after.odoo_message_id).toBe(first.odoo_message_id);
        expect(after.last_sent_at >= first.last_sent_at).toBe(true);
    });

    it('keeps the overwrite and reports a "replaced" note that failed', async () => {
        await connect();
        await send({ chatter: { resModel: 'crm.lead', resId: 1 } });
        const [link] = links();
        odoo.state.failNotes = true;
        const response = await send({ title: 'Quote v2', chatter: { resModel: 'crm.lead', resId: 1 } });
        expect(response.body.chatter).toMatchObject({ ok: true, created: false, noteMissing: true });
        expect(calls('/ir.attachment/write')).toHaveLength(1);
        expect(odoo.state.attachmentMeta.get(link.odoo_record_id).name).toBe('Quote v2.pdf');
        expect(odoo.state.attachments.get(link.odoo_record_id).subarray(0, 5).toString()).toBe('%PDF-');
        expect(notesOn('crm.lead', 1)).toHaveLength(1);
        expect(links()[0].odoo_record_id).toBe(link.odoo_record_id);
    });

    it('posts a new note on a different record and leaves the first alone', async () => {
        await connect();
        await send({ chatter: { resModel: 'crm.lead', resId: 1 } });
        const response = await send({ chatter: { resModel: 'sale.order', resId: 2 } });
        expect(response.body.chatter).toMatchObject({ ok: true, created: true });
        expect(calls('/ir.attachment/create')).toHaveLength(2);
        expect(calls('/ir.attachment/write')).toHaveLength(0);
        expect(notesOn('crm.lead', 1)).toHaveLength(1);
        expect(notesOn('sale.order', 2)).toHaveLength(1);
        expect(links().map((l) => l.target_key)).toEqual(['crm.lead:1', 'sale.order:2']);
    });

    it('does not overwrite an attachment that was moved to another record, or replaced', async () => {
        await connect();
        await send({ chatter: { resModel: 'crm.lead', resId: 1 } });
        const [link] = links();
        const moved = odoo.state.attachmentMeta.get(link.odoo_record_id);
        moved.res_id = 3;
        const response = await send({ chatter: { resModel: 'crm.lead', resId: 1 } });
        expect(response.body.chatter).toMatchObject({ ok: true, created: true, recreated: true });
        expect(calls('/ir.attachment/write')).toHaveLength(0);
        expect(moved.res_id).toBe(3);
        expect(links()[0].odoo_record_id).not.toBe(link.odoo_record_id);

        // Same id but another attachment: a database restored behind the same URL.
        const [fresh] = links();
        odoo.state.attachmentMeta.get(fresh.odoo_record_id).create_date = '2020-01-01 00:00:00';
        const again = await send({ chatter: { resModel: 'crm.lead', resId: 1 } });
        expect(again.body.chatter).toMatchObject({ ok: true, created: true, recreated: true });
        expect(calls('/ir.attachment/write')).toHaveLength(0);
    });

    it('stages a new attachment when the earlier one was deleted in Odoo', async () => {
        await connect();
        await send({ chatter: { resModel: 'crm.lead', resId: 1 } });
        const [link] = links();
        odoo.state.attachments.delete(link.odoo_record_id);
        const response = await send({ chatter: { resModel: 'crm.lead', resId: 1 } });
        expect(response.body.chatter).toMatchObject({ ok: true, created: true, recreated: true });
        expect(notesOn('crm.lead', 1)).toHaveLength(2);
        expect(links()[0].odoo_record_id).not.toBe(link.odoo_record_id);
    });

    it('refuses other models and bad ids before touching Odoo', async () => {
        await connect();
        odoo.state.requests = [];
        for (const chatter of [
            { resModel: 'res.partner', resId: 1 },
            { resModel: 'crm.lead', resId: 0 },
            { resModel: 'crm.lead', resId: '1; DROP' },
            { resModel: 'crm.lead' },
            'crm.lead:1',
        ]) {
            const response = await send({ chatter });
            expect(response.status).toBe(400);
            expect(response.body).toEqual({ error: 'invalid', message: 'Choose an opportunity or sales order.' });
        }
        expect((await send({})).status).toBe(400);
        expect(odoo.state.requests).toHaveLength(0);
    });

    it('reports a record that is gone, an app that is missing, and a corrupt upload', async () => {
        await connect();
        const gone = await send({ chatter: { resModel: 'crm.lead', resId: 999 } });
        expect(gone.body.chatter).toEqual({ ok: false, error: 'record_gone', message: 'That opportunity or sales order no longer exists in Odoo.' });
        expect(calls('/ir.attachment/create')).toHaveLength(0);

        odoo.state.apps = ['documents', 'crm'];
        await connect();
        odoo.state.requests = [];
        const noSales = await send({ chatter: { resModel: 'sale.order', resId: 1 } });
        expect(noSales.body.chatter).toMatchObject({ ok: false, error: 'missing_app' });
        expect(odoo.state.requests).toHaveLength(0);

        odoo.state.ignoreContent = true;
        const corrupt = await send({ chatter: { resModel: 'crm.lead', resId: 1 } });
        expect(corrupt.body.chatter).toMatchObject({ ok: false, error: 'upload_corrupt' });
        expect(notesOn('crm.lead', 1)).toHaveLength(0);
        expect(links()).toHaveLength(0);
    });

    it('sends to Documents and the chatter in one go, each reporting for itself', async () => {
        await connect();
        // No folder and nothing remembered: Documents fails, the chatter still goes through.
        const response = await send({ documents: {}, chatter: { resModel: 'crm.lead', resId: 1 } });
        expect(response.status).toBe(200);
        expect(response.body.documents).toMatchObject({ ok: false, error: 'missing_folder' });
        expect(response.body.chatter).toMatchObject({ ok: true, created: true });

        const both = await send({ documents: { folderId: 41 }, chatter: { resModel: 'crm.lead', resId: 1 } });
        expect(both.body.documents).toMatchObject({ ok: true, created: true });
        expect(both.body.chatter).toMatchObject({ ok: true, created: false });
        expect(odoo.state.docs.size).toBe(1);
        const all = getUserDb(user.userId).prepare('SELECT destination FROM odoo_links WHERE source_id = ? ORDER BY destination').all(noteId);
        expect(all.map((l) => l.destination)).toEqual(['chatter', 'documents']);
    });

    it('lists opportunities and orders for the picker, the ones already sent to first', async () => {
        await connect();
        const search = await request(app).get('/addons/odoo/records?q=azure').set('Authorization', `Bearer ${token}`);
        expect(search.status).toBe(200);
        expect(search.body.records).toEqual([
            { resModel: 'crm.lead', resId: 1, name: 'Club Office Furnitures', partnerName: 'Azure Interior', status: 'Qualified', sent: false },
            { resModel: 'sale.order', resId: 1, name: 'S00001', partnerName: 'Azure Interior', status: 'Sales order', sent: false },
        ]);
        const [leadSearch] = calls('/crm.lead/search_read');
        expect(leadSearch.params.domain).toEqual([['type', '=', 'opportunity'], '|', ['name', 'ilike', 'azure'], ['partner_id', 'ilike', 'azure']]);

        await send({ chatter: { resModel: 'sale.order', resId: 2 } });
        const withSent = await request(app).get('/addons/odoo/records').query({ q: '', dbKey, noteId }).set('Authorization', `Bearer ${token}`);
        expect(withSent.body.records[0]).toEqual({ resModel: 'sale.order', resId: 2, name: 'S00002', partnerName: 'Deco Addict', status: 'Quotation', sent: true });
        expect(withSent.body.records.filter((r) => r.sent)).toHaveLength(1);
        // Leads that are not opportunities never show.
        expect(withSent.body.records.some((r) => r.name === 'Website quote request')).toBe(false);

        const linkList = await request(app).get('/addons/odoo/links').query({ dbKey, noteId }).set('Authorization', `Bearer ${token}`);
        expect(linkList.body.links).toEqual([expect.objectContaining({
            destination: 'chatter', targetKey: 'sale.order:2', sameOdoo: true, lastSentBy: 'Test User',
            url: `http://127.0.0.1:${odoo.port}/odoo/sale.order/2`,
        })]);
    });

    it('needs a connection for the picker', async () => {
        await request(app).put('/addons/odoo/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: true });
        const response = await request(app).get('/addons/odoo/records').set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(404);
        expect(response.body.error).toBe('not_connected');
    });
});
