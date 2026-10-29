import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OdooError, resetFileFieldCache } from '../../odooClient.js';
import { IMAGE_PLACEHOLDER, internalImageSources, uploadArticleImages } from '../../odooArticleImages.js';

const sha1 = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex');

/** A client remembering every call, with a few attachments "already in Odoo". */
function fakeClient({ existing = new Map(), failCreate = null } = {}) {
    const calls = [];
    const stored = new Map();
    let nextId = 500;
    return {
        calls,
        stored,
        async call(model, method, params) {
            calls.push({ model, method, params });
            if (model === 'ir.attachment' && method === 'fields_get') return { raw: { type: 'binary' } };
            if (model === 'ir.attachment' && method === 'search_read') {
                const checksum = params.domain.find((t) => t[0] === 'checksum')[2];
                const id = existing.get(checksum);
                return id ? [{ id }] : [];
            }
            if (model === 'ir.attachment' && method === 'create') {
                if (failCreate) throw new OdooError(failCreate);
                const [vals] = params.vals_list;
                const id = nextId++;
                stored.set(id, { ...vals, bytes: Buffer.from(vals.raw, 'base64') });
                return [id];
            }
            if (model === 'ir.attachment' && method === 'read') {
                return params.ids.filter((id) => stored.has(id)).map((id) => ({ id, checksum: sha1(stored.get(id).bytes) }));
            }
            throw new Error(`unexpected ${model}/${method}`);
        },
    };
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG = Buffer.from('ffd8ffe000104a464946', 'hex');
const images = {
    '/images/11111111-1111-4111-8111-111111111111': { imageId: '11111111-1111-4111-8111-111111111111', mimeType: 'image/png', buffer: PNG },
    '/api/images/22222222-2222-4222-8222-222222222222?space=abc': { imageId: '22222222-2222-4222-8222-222222222222', mimeType: 'image/jpeg', buffer: JPG },
};
const readImage = (src) => images[src] || null;

describe('internalImageSources', () => {
    it('lists Panino image links once each, ignoring external ones', () => {
        const body = '<p><img src="/images/11111111-1111-4111-8111-111111111111"></p>'
            + '<p><img src="https://example.com/x.png"><img src="/images/11111111-1111-4111-8111-111111111111">'
            + '<img src="/api/images/22222222-2222-4222-8222-222222222222?space=abc"></p>';
        expect(internalImageSources(body)).toEqual([
            '/images/11111111-1111-4111-8111-111111111111',
            '/api/images/22222222-2222-4222-8222-222222222222?space=abc',
        ]);
        expect(internalImageSources('<p>none</p>')).toEqual([]);
    });
});

describe('uploadArticleImages', () => {
    beforeEach(() => resetFileFieldCache());

    it('uploads each image once onto the article and rewrites every use of it', async () => {
        const client = fakeClient();
        const body = '<p><img src="/images/11111111-1111-4111-8111-111111111111" alt="A"></p>'
            + '<p><img src="/images/11111111-1111-4111-8111-111111111111"><img src="/api/images/22222222-2222-4222-8222-222222222222?space=abc"></p>'
            + '<p><img src="https://example.com/x.png"></p>';
        const result = await uploadArticleImages({ client, odooTarget: 'https://acme.odoo.com|', articleId: 42, body, readImage });
        expect(result).toMatchObject({ uploaded: 2, reused: 0, missing: 0 });
        expect(result.body).toBe(
            '<p><img src="/web/image/500" alt="A"></p>'
            + '<p><img src="/web/image/500"><img src="/web/image/501"></p>'
            + '<p><img src="https://example.com/x.png"></p>',
        );
        const created = client.calls.filter((c) => c.method === 'create');
        expect(created).toHaveLength(2);
        expect(created[0].params.vals_list[0]).toMatchObject({
            name: '11111111-1111-4111-8111-111111111111.png', mimetype: 'image/png', res_model: 'knowledge.article', res_id: 42,
        });
        expect(created[0].params.vals_list[0].raw).toBe(PNG.toString('base64'));
        expect(created[1].params.vals_list[0].name).toBe('22222222-2222-4222-8222-222222222222.jpg');
    });

    it('reuses an attachment the article already has for the same bytes', async () => {
        const client = fakeClient({ existing: new Map([[sha1(PNG), 77]]) });
        const result = await uploadArticleImages({
            client, odooTarget: 't', articleId: 42, body: '<img src="/images/11111111-1111-4111-8111-111111111111">', readImage,
        });
        expect(result).toMatchObject({ uploaded: 0, reused: 1, missing: 0, body: '<img src="/web/image/77">' });
        expect(client.calls.some((c) => c.method === 'create')).toBe(false);
    });

    it('turns an image it cannot read or store into a placeholder, and keeps going', async () => {
        const client = fakeClient();
        const body = '<p><img src="/images/33333333-3333-4333-8333-333333333333" alt="Lost"></p>'
            + '<p><img src="/images/11111111-1111-4111-8111-111111111111"></p>';
        const result = await uploadArticleImages({ client, odooTarget: 't', articleId: 42, body, readImage });
        expect(result).toMatchObject({ uploaded: 1, missing: 1, failed: 0 });
        expect(result.body).toBe(
            `<p><span class="o_panino_image_placeholder">${IMAGE_PLACEHOLDER}: Lost</span></p><p><img src="/web/image/500"></p>`,
        );

        const refusing = fakeClient({ failCreate: 'upload_corrupt' });
        const again = await uploadArticleImages({ client: refusing, odooTarget: 't', articleId: 42, body, readImage });
        // One could not be read, one Odoo refused: only the refused one counts as failed.
        expect(again).toMatchObject({ uploaded: 0, missing: 2, failed: 1 });
        expect(again.body).not.toContain('<img');
    });

    it('fails the send on a rejected key rather than losing every image quietly', async () => {
        const client = fakeClient({ failCreate: 'key_rejected' });
        await expect(uploadArticleImages({
            client, odooTarget: 't', articleId: 42, body: '<img src="/images/11111111-1111-4111-8111-111111111111">', readImage,
        })).rejects.toMatchObject({ code: 'key_rejected' });
    });

    it('leaves a body without Panino images untouched, without calling Odoo', async () => {
        const client = fakeClient();
        const body = '<p>Text <img src="https://example.com/x.png"></p>';
        expect(await uploadArticleImages({ client, odooTarget: 't', articleId: 42, body, readImage })).toEqual({ body, uploaded: 0, reused: 0, missing: 0, failed: 0 });
        expect(client.calls).toHaveLength(0);
    });
});
