// Images in the v1 API and MCP (docs/specs/proposed/ai-api-expansion.md §4.5).
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteTestDb, getDb, getSpacesDb, getUserDb } from '../../../../db.js';
import { createSpace } from '../../../../spaces.js';
import { deleteSpaceUploads, resolveDatabaseUploadRoot, resolveSpaceUploadRoot } from '../../../../spaceStorage.js';
import { getImageUsageReport, listImages, locateImageFile, readImage } from '../../imageService.js';
import { aiUser, createKey, createTestApp, offerAiAddon, resetAiState } from '../aiTestSetup.js';

const V1 = '/addons/ai/v1';
const MCP = `${V1}/mcp`;

const PNG = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
    0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
]);
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0xFF, 0xD9]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1A, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(14)]);
const SVG = '<?xml version="1.0"?>\n<!-- drawn by hand -->\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>\n';
const b64 = (buffer) => Buffer.from(buffer).toString('base64');

describe('AI agents add-on: images', () => {
    let app;
    let server;
    let restore;
    let user;
    let stranger;
    let secret;
    let spaceIds;

    const bearer = (key = secret) => ({ Authorization: `Bearer ${key}` });
    const personalDb = () => getUserDb(user.userId);

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
        user = await aiUser('images');
        stranger = await aiUser('images-stranger');
        ({ secret } = await createKey(app, user, { name: 'Image agent' }));
        spaceIds = [];
    });
    afterEach(() => {
        const spacesDb = getSpacesDb();
        for (const spaceId of spaceIds) {
            spacesDb.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
            spacesDb.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
            deleteTestDb(`space:${spaceId}`);
            deleteSpaceUploads(spaceId);
        }
        for (const person of [user, stranger]) {
            const root = resolveDatabaseUploadRoot(`user:${person.userId}`);
            for (const row of getUserDb(person.userId).prepare('SELECT path FROM images').all()) {
                const file = path.join(root, row.path);
                if (row.path && path.dirname(file) === root && fs.existsSync(file)) fs.unlinkSync(file);
            }
            spacesDb.prepare('DELETE FROM space_user_versions WHERE user_id = ?').run(person.userId);
            person.cleanup();
        }
    });

    function newSpace(name = 'Image team') {
        const { spaceId } = createSpace({ actorUserId: user.userId, name });
        spaceIds.push(spaceId);
        return spaceId;
    }

    function insertNote(db, id, content, { title = id, personal = true } = {}) {
        const now = new Date().toISOString();
        if (personal) {
            db.prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
                VALUES (?, ?, NULL, ?, ?, ?, ?)`).run(id, user.userId, title, content, now, now);
        } else {
            db.prepare(`INSERT INTO notes (id, folder_id, title, content, created_at, updated_at)
                VALUES (?, NULL, ?, ?, ?, ?)`).run(id, title, content, now, now);
        }
    }

    function insertImageRow(db, { id = uuidv4(), filename = 'row.png', mimeType = 'image/png', relPath = `${uuidv4()}.png`, sizeBytes = 10, createdAt }) {
        db.prepare(`INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, '', ?)`).run(id, user.userId, filename, mimeType, relPath, sizeBytes, createdAt || new Date().toISOString());
        return id;
    }

    const uploadJson = (payload, { key = secret, query = '' } = {}) => request(app).post(`${V1}/images${query}`)
        .set(bearer(key)).send(payload);

    let nextId = 1;
    const mcp = (name, args, key = secret) => request(app).post(MCP)
        .set('Authorization', `Bearer ${key}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });

    describe('upload', () => {
        it('stores a JSON upload like the app does: row, UUID file in the upload root, sha256 and Markdown', async () => {
            const res = await uploadJson({ filename: 'chart.png', mimeType: 'image/png', data: b64(PNG) });
            expect(res.status).toBe(201);
            const { image } = res.body;
            expect(image).toMatchObject({
                filename: 'chart.png', mimeType: 'image/png', sizeBytes: PNG.length, usageCount: 0, space: null,
                url: `/images/${image.id}`,
                // As the app's editor writes it in production: the API path prefix, then the canonical path.
                markdown: `![chart.png](/api/images/${image.id})`,
            });
            expect(res.body.pruneAfterDays).toBe(7);

            const row = personalDb().prepare('SELECT * FROM images WHERE id = ?').get(image.id);
            expect(row).toMatchObject({ user_id: user.userId, filename: 'chart.png', mime_type: 'image/png', size_bytes: PNG.length });
            expect(row.sha256).toBe(crypto.createHash('sha256').update(PNG).digest('hex'));
            expect(row.path).toMatch(/^[0-9a-f-]{36}\.png$/);
            const file = path.join(resolveDatabaseUploadRoot(`user:${user.userId}`), row.path);
            expect(fs.readFileSync(file).equals(PNG)).toBe(true);
        });

        it('accepts a multipart upload in the field "image", like the app', async () => {
            const res = await request(app).post(`${V1}/images`).set(bearer())
                .attach('image', JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' });
            expect(res.status).toBe(201);
            expect(res.body.image).toMatchObject({ filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: JPEG.length });
            const row = personalDb().prepare('SELECT path FROM images WHERE id = ?').get(res.body.image.id);
            expect(row.path).toMatch(/\.jpg$/);

            // Multer reads the part's filename as Latin-1; a UTF-8 name is repaired, as in the app.
            const named = await request(app).post(`${V1}/images`).set(bearer())
                .attach('image', JPEG, { filename: 'Über Straße.jpg', contentType: 'image/jpeg' });
            expect(named.status).toBe(201);
            expect(named.body.image.filename).toBe('Über Straße.jpg');
            expect(named.body.image.markdown).toContain('![Über Straße.jpg]');

            const wrongField = await request(app).post(`${V1}/images`).set(bearer())
                .attach('file', JPEG, { filename: 'photo.jpg', contentType: 'image/jpeg' });
            expect(wrongField.status).toBe(400);
            expect(wrongField.body.code).toBe('INVALID_INPUT');
        });

        it('infers the type from the extension and accepts every allowed type, a data: URL and base64 line breaks', async () => {
            for (const [filename, bytes] of [['a.gif', GIF], ['a.webp', WEBP], ['a.svg', Buffer.from(SVG)], ['a.jpeg', JPEG]]) {
                const res = await uploadJson({ filename, data: b64(bytes).replace(/(.{8})/g, '$1\n') });
                expect(res.status, filename).toBe(201);
            }
            const dataUrl = await uploadJson({ filename: 'b.png', data: `data:image/png;base64,${b64(PNG)}` });
            expect(dataUrl.status).toBe(201);
            const types = personalDb().prepare('SELECT mime_type FROM images ORDER BY mime_type').all().map((r) => r.mime_type);
            expect(types).toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']);
        });

        it('refuses a type off the allow-list, a wrong extension, and bytes that are not the declared type', async () => {
            const cases = [
                [{ filename: 'notes.txt', mimeType: 'text/plain', data: b64('hello') }, 415, 'IMAGE_TYPE_NOT_ALLOWED'],
                [{ filename: 'page.html', data: b64('<html></html>') }, 415, 'IMAGE_TYPE_NOT_ALLOWED'],
                [{ filename: 'chart.jpg', mimeType: 'image/png', data: b64(PNG) }, 400, 'IMAGE_EXTENSION_MISMATCH'],
                [{ filename: 'chart.png', mimeType: 'image/png', data: b64(JPEG) }, 400, 'IMAGE_CONTENT_MISMATCH'],
                [{ filename: 'chart.gif', data: b64(PNG) }, 400, 'IMAGE_CONTENT_MISMATCH'],
                [{ filename: 'chart.webp', data: b64('RIFF0000AVI LIST') }, 400, 'IMAGE_CONTENT_MISMATCH'],
                [{ filename: 'fake.svg', data: b64('<html><script>alert(1)</script></html>') }, 400, 'IMAGE_CONTENT_MISMATCH'],
                [{ filename: 'entity.svg', data: b64('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg>&a;</svg>') }, 400, 'IMAGE_CONTENT_MISMATCH'],
                [{ filename: 'chart.png', data: 'not base64!' }, 400, 'INVALID_INPUT'],
                [{ filename: 'chart.png', data: '' }, 400, 'INVALID_INPUT'],
                [{ filename: 'dir/chart.png', data: b64(PNG) }, 400, 'INVALID_INPUT'],
                [{ data: b64(PNG) }, 400, 'INVALID_INPUT'],
            ];
            for (const [payload, status, code] of cases) {
                const res = await uploadJson(payload);
                expect([res.status, res.body.code], JSON.stringify(payload).slice(0, 80)).toEqual([status, code]);
                expect(JSON.stringify(res.body)).not.toMatch(/stack|Error:/);
            }
            expect(personalDb().prepare('SELECT COUNT(*) AS n FROM images').get().n).toBe(0);
        });

        it('refuses images over 1 MB, as JSON and as multipart', async () => {
            const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(1024 * 1024)]);
            const json = await uploadJson({ filename: 'big.png', data: b64(big) });
            expect(json.status).toBe(413);
            expect(json.body.code).toBe('IMAGE_TOO_LARGE');
            const huge = await uploadJson({ filename: 'huge.png', data: 'A'.repeat(3 * 1024 * 1024) });
            expect(huge.body.code).toBe('IMAGE_TOO_LARGE');
            const multipart = await request(app).post(`${V1}/images`).set(bearer())
                .attach('image', big, { filename: 'big.png', contentType: 'image/png' });
            expect(multipart.status).toBe(413);
            expect(multipart.body.code).toBe('IMAGE_TOO_LARGE');
            expect(personalDb().prepare('SELECT COUNT(*) AS n FROM images').get().n).toBe(0);
        });

        it('refuses an upload past the database\'s quota', async () => {
            const spaceId = newSpace();
            const db = getDb(`space:${spaceId}`);
            insertImageRow(db, { filename: 'reservation.png', sizeBytes: 1024 * 1024 * 1024 });
            const res = await uploadJson({ filename: 'chart.png', data: b64(PNG) }, { query: `?space=${spaceId}` });
            expect(res.status).toBe(413);
            expect(res.body.code).toBe('IMAGE_QUOTA_EXCEEDED');
            expect(db.prepare('SELECT COUNT(*) AS n FROM images').get().n).toBe(1);
            expect(fs.existsSync(resolveSpaceUploadRoot(spaceId)) ? fs.readdirSync(resolveSpaceUploadRoot(spaceId)) : []).toEqual([]);
        });
    });

    describe('list', () => {
        it('pages with a cursor, searches by filename, counts usage and reports totals and quota', async () => {
            const db = personalDb();
            const ids = [
                insertImageRow(db, { filename: 'alpha.png', sizeBytes: 100, createdAt: '2026-11-01T10:00:00.000Z' }),
                insertImageRow(db, { filename: 'beta.png', sizeBytes: 200, createdAt: '2026-11-02T10:00:00.000Z' }),
                insertImageRow(db, { filename: 'gamma.png', sizeBytes: 300, createdAt: '2026-11-03T10:00:00.000Z' }),
            ];
            insertNote(db, 'n-1', `![a](/api/images/${ids[0]})`);
            insertNote(db, 'n-2', `see ![a](/images/${ids[0]}) again`);

            const first = await request(app).get(`${V1}/images?limit=2`).set(bearer());
            expect(first.status).toBe(200);
            expect(first.body.images.map((image) => image.filename)).toEqual(['gamma.png', 'beta.png']);
            expect(first.body.stats).toEqual({ imageCount: 3, totalImageBytes: 600, quotaBytes: null });
            expect(first.body.space).toBeNull();
            expect(first.body.nextCursor).toBeTruthy();
            expect(first.body.images[0]).toMatchObject({
                id: ids[2], mimeType: 'image/png', sizeBytes: 300, createdAt: '2026-11-03T10:00:00.000Z', usageCount: 0,
                markdown: `![gamma.png](/api/images/${ids[2]})`, space: null,
            });

            const second = await request(app).get(`${V1}/images?limit=2&cursor=${first.body.nextCursor}`).set(bearer());
            expect(second.body.images.map((image) => [image.filename, image.usageCount])).toEqual([['alpha.png', 2]]);
            expect(second.body.nextCursor).toBeNull();

            const search = await request(app).get(`${V1}/images?search=bet`).set(bearer());
            expect(search.body.images.map((image) => image.id)).toEqual([ids[1]]);

            const bySize = await request(app).get(`${V1}/images?sort=size_asc&limit=1`).set(bearer());
            expect(bySize.body.images[0].id).toBe(ids[0]);

            const badCursor = await request(app).get(`${V1}/images?cursor=nonsense`).set(bearer());
            expect(badCursor.status).toBe(400);
            const otherSort = await request(app).get(`${V1}/images?sort=size_asc&cursor=${first.body.nextCursor}`).set(bearer());
            expect(otherSort.status).toBe(400);
            const badSort = await request(app).get(`${V1}/images?sort=name`).set(bearer());
            expect(badSort.body.code).toBe('INVALID_INPUT');
        });

        it('lists through MCP with the totals in the text', async () => {
            await uploadJson({ filename: 'chart.png', data: b64(PNG) });
            const res = await mcp('list_images', {});
            expect(res.body.result.isError).toBeUndefined();
            expect(res.body.result.content[0].text).toMatch(/Personal database: 1 image, 67 bytes used of unlimited storage\./);
            expect(res.body.result.content[0].text).toContain('![chart.png](/api/images/');
            expect(res.body.result.structuredContent).toMatchObject({ next_cursor: null, stats: { imageCount: 1 }, space: null });
        });
    });

    describe('get', () => {
        it('serves the bytes with the app\'s safe headers and no caching', async () => {
            const { body } = await uploadJson({ filename: 'chart.png', data: b64(PNG) });
            const res = await request(app).get(`${V1}/images/${body.image.id}`).set(bearer())
                .buffer(true).parse((response, done) => {
                    const chunks = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => done(null, Buffer.concat(chunks)));
                });
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('image/png');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
            expect(res.headers['cache-control']).toBe('private, no-store');
            expect(res.body.equals(PNG)).toBe(true);
        });

        it('sends an SVG as an inert sandboxed document', async () => {
            const { body } = await uploadJson({ filename: 'icon.svg', data: b64(SVG) });
            const res = await request(app).get(`${V1}/images/${body.image.id}`).set(bearer());
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
            expect(res.headers['content-security-policy']).toContain('sandbox');
            expect(res.headers['cache-control']).toBe('private, no-store');
        });

        it('sends a stored type off the allow-list as a download, never a page', async () => {
            const root = resolveDatabaseUploadRoot(`user:${user.userId}`);
            const relPath = `${uuidv4()}.png`;
            fs.writeFileSync(path.join(root, relPath), '<script>alert(1)</script>');
            const id = insertImageRow(personalDb(), { filename: 'evil.html', mimeType: 'text/html', relPath });
            const res = await request(app).get(`${V1}/images/${id}`).set(bearer());
            expect(res.headers['content-type']).toBe('application/octet-stream');
            expect(res.headers['content-disposition']).toBe('attachment');
            const viaMcp = await mcp('get_image', { id });
            expect(viaMcp.body.result.isError).toBe(true);
        });

        it('returns MCP image content with a short text', async () => {
            const { body } = await uploadJson({ filename: 'chart.png', data: b64(PNG) });
            const res = await mcp('get_image', { id: body.image.id });
            const { content, structuredContent, isError } = res.body.result;
            expect(isError).toBeUndefined();
            expect(content[0].type).toBe('text');
            expect(content[0].text).toContain('Image: chart.png');
            expect(content[0].text).toContain(`Markdown: ![chart.png](/api/images/${body.image.id})`);
            expect(content[1]).toEqual({ type: 'image', data: b64(PNG), mimeType: 'image/png' });
            expect(structuredContent.image).toMatchObject({ id: body.image.id, mimeType: 'image/png', usageCount: 0 });
        });

        it('returns an SVG to MCP as an embedded text resource, and says so', async () => {
            const { body } = await uploadJson({ filename: 'icon.svg', data: b64(SVG) });
            const res = await mcp('get_image', { id: body.image.id });
            const { content } = res.body.result;
            expect(content[0].text).toMatch(/SVG text \(an embedded resource\)/);
            expect(content[1]).toEqual({
                type: 'resource',
                resource: { uri: `https://panino.test/api/addons/ai/v1/images/${body.image.id}`, mimeType: 'image/svg+xml', text: SVG },
            });
        });

        it('answers a closed code when the file is missing, and for unknown ids', async () => {
            const id = insertImageRow(personalDb(), { filename: 'gone.png' });
            const rest = await request(app).get(`${V1}/images/${id}`).set(bearer());
            expect(rest.status).toBe(404);
            expect(rest.body).toEqual({ error: 'The image\'s file is not on the server.', code: 'IMAGE_FILE_MISSING' });
            expect(rest.headers['content-type']).toMatch(/application\/json/);
            const viaMcp = await mcp('get_image', { id });
            expect(viaMcp.body.result.isError).toBe(true);
            expect(viaMcp.body.result.content[0].text).toMatch(/file is not on the server/);

            const unknown = await request(app).get(`${V1}/images/${uuidv4()}`).set(bearer());
            expect(unknown.body.code).toBe('IMAGE_NOT_FOUND');
            const notUuid = await request(app).get(`${V1}/images/..%2F..%2Fetc`).set(bearer());
            expect(notUuid.body.code).toBe('IMAGE_NOT_FOUND');
            const traversal = insertImageRow(personalDb(), { relPath: '../../etc/passwd' });
            const escaped = await request(app).get(`${V1}/images/${traversal}`).set(bearer());
            expect(escaped.body.code).toBe('IMAGE_FILE_MISSING');
        });
    });

    describe('usage and delete', () => {
        it('lists the referencing Documents and refuses to delete while any remains', async () => {
            const { body } = await uploadJson({ filename: 'chart.png', data: b64(PNG) });
            const id = body.image.id;
            insertNote(personalDb(), 'doc-1', `# Report\n\n${body.image.markdown}`, { title: 'Report' });

            const usage = await request(app).get(`${V1}/images/${id}/usage`).set(bearer());
            expect(usage.status).toBe(200);
            expect(usage.body).toMatchObject({ usageCount: 1, truncated: false, image: { id, usageCount: 1 } });
            expect(usage.body.documents).toEqual([{ id: 'doc-1', title: 'Report', updatedAt: expect.any(String) }]);

            const refused = await request(app).delete(`${V1}/images/${id}`).set(bearer());
            expect(refused.status).toBe(409);
            expect(refused.body).toMatchObject({ code: 'IMAGE_IN_USE', details: { usageCount: 1, documents: [{ id: 'doc-1', title: 'Report' }] } });
            expect(personalDb().prepare('SELECT 1 FROM images WHERE id = ?').get(id)).toBeTruthy();

            const viaMcp = await mcp('delete_image', { id });
            expect(viaMcp.body.result.isError).toBe(true);
            expect(viaMcp.body.result.content[0].text).toContain('get_image_usage');
            const usageViaMcp = await mcp('get_image_usage', { id });
            expect(usageViaMcp.body.result.content[0].text).toContain('1. Report — id doc-1');
        });

        it('counts a template that shows the image as a use, and refuses to delete it', async () => {
            // The review case: only Documents were counted, so a template's image could be deleted.
            const { body } = await uploadJson({ filename: 'logo.png', data: b64(PNG) });
            const id = body.image.id;
            personalDb().prepare(`INSERT INTO templates (id, name, content, title_pattern, created_at, updated_at)
                VALUES ('t-1', 'Letterhead', ?, '', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`).run(`# {{input:To}}\n\n${body.image.markdown}`);

            const usage = await request(app).get(`${V1}/images/${id}/usage`).set(bearer());
            expect(usage.body).toMatchObject({ usageCount: 1, documentCount: 0, templateCount: 1, documents: [], truncated: false });
            expect(usage.body.templates).toEqual([{ id: 't-1', name: 'Letterhead', updatedAt: '2026-11-01T00:00:00.000Z' }]);
            const listed = await request(app).get(`${V1}/images`).set(bearer());
            expect(listed.body.images.find((image) => image.id === id).usageCount).toBe(1);

            const refused = await request(app).delete(`${V1}/images/${id}`).set(bearer());
            expect(refused.status).toBe(409);
            expect(refused.body.details).toMatchObject({ usageCount: 1, templates: [{ id: 't-1', name: 'Letterhead' }] });
            const usageViaMcp = await mcp('get_image_usage', { id });
            expect(usageViaMcp.body.result.content[0].text).toContain('used by 0 Documents and 1 template');
            expect(usageViaMcp.body.result.content[0].text).toContain('1. Letterhead — template id t-1');
        });

        it('deletes an unused image: row and file gone', async () => {
            const { body } = await uploadJson({ filename: 'chart.png', data: b64(PNG) });
            const id = body.image.id;
            const row = personalDb().prepare('SELECT path FROM images WHERE id = ?').get(id);
            const file = path.join(resolveDatabaseUploadRoot(`user:${user.userId}`), row.path);
            expect(fs.existsSync(file)).toBe(true);

            const res = await request(app).delete(`${V1}/images/${id}`).set(bearer());
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ deleted: true, image: { id, filename: 'chart.png' } });
            expect(personalDb().prepare('SELECT 1 FROM images WHERE id = ?').get(id)).toBeUndefined();
            expect(fs.existsSync(file)).toBe(false);

            const again = await request(app).delete(`${V1}/images/${id}`).set(bearer());
            expect(again.body.code).toBe('IMAGE_NOT_FOUND');
        });

        it('uploads and deletes through MCP', async () => {
            const uploaded = await mcp('upload_image', { data: b64(PNG), filename: 'from-mcp.png', mime_type: 'image/png' });
            const { result } = uploaded.body;
            expect(result.isError).toBeUndefined();
            const { image } = result.structuredContent;
            expect(result.content[0].text).toContain(`insert this Markdown into a Document in the same database: ${image.markdown}`);
            expect(result.content[0].text).toMatch(/removed after 7 days/);

            const deleted = await mcp('delete_image', { id: image.id });
            expect(deleted.body.result.content[0].text).toMatch(/permanently/);
            expect(personalDb().prepare('SELECT COUNT(*) AS n FROM images').get().n).toBe(0);

            const refused = await mcp('upload_image', { data: b64(JPEG), filename: 'x.png' });
            expect(refused.body.result.isError).toBe(true);
            expect(refused.body.result.content[0].text).toMatch(/not an image of the type given/);
        });
    });

    describe('access', () => {
        it('checks read access on every read, like the other areas', () => {
            // No credential lacks read today; the check keeps one rule for every area.
            const ctx = { userId: user.userId, agent: { kind: 'key', scope: 'none' } };
            const id = insertImageRow(personalDb(), {});
            for (const read of [
                () => listImages(ctx, {}),
                () => locateImageFile(ctx, { id }),
                () => readImage(ctx, { id }),
                () => getImageUsageReport(ctx, { id }),
            ]) {
                expect(read).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' }));
            }
        });

        it('a read-only key reads images but cannot upload or delete', async () => {
            const { body } = await uploadJson({ filename: 'chart.png', data: b64(PNG) });
            const { secret: readKey } = await createKey(app, user, { name: 'Reader', scope: 'read' });

            expect((await request(app).get(`${V1}/images`).set(bearer(readKey))).status).toBe(200);
            const upload = await uploadJson({ filename: 'b.png', data: b64(PNG) }, { key: readKey });
            expect([upload.status, upload.body.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
            const multipart = await request(app).post(`${V1}/images`).set(bearer(readKey))
                .attach('image', PNG, { filename: 'b.png', contentType: 'image/png' });
            expect([multipart.status, multipart.body.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
            const remove = await request(app).delete(`${V1}/images/${body.image.id}`).set(bearer(readKey));
            expect([remove.status, remove.body.code]).toEqual([403, 'INSUFFICIENT_SCOPE']);
            expect(personalDb().prepare('SELECT COUNT(*) AS n FROM images').get().n).toBe(1);

            const list = await request(app).post(MCP).set(bearer(readKey)).set('Accept', 'application/json, text/event-stream')
                .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/list' });
            const names = list.body.result.tools.map((tool) => tool.name);
            expect(names).toEqual(expect.arrayContaining(['list_images', 'get_image', 'get_image_usage']));
            expect(names).not.toContain('upload_image');
            expect(names).not.toContain('delete_image');
            const forced = await mcp('upload_image', { data: b64(PNG), filename: 'c.png' }, readKey);
            expect(forced.body.result.isError).toBe(true);
            expect(forced.body.result.content[0].text).toContain('read-only');
        });

        it('stores space images in the space\'s upload root and finds them by id alone', async () => {
            const spaceId = newSpace();
            const res = await uploadJson({ filename: 'team.png', data: b64(PNG) }, { query: `?space=${spaceId}` });
            expect(res.status).toBe(201);
            const { image } = res.body;
            expect(image).toMatchObject({ space: spaceId, url: `/images/${image.id}?space=${spaceId}`, markdown: `![team.png](/api/images/${image.id}?space=${spaceId})` });

            const db = getDb(`space:${spaceId}`);
            const row = db.prepare('SELECT user_id, path FROM images WHERE id = ?').get(image.id);
            expect(row.user_id).toBe(user.userId);
            expect(fs.existsSync(path.join(resolveSpaceUploadRoot(spaceId), row.path))).toBe(true);
            expect(personalDb().prepare('SELECT COUNT(*) AS n FROM images').get().n).toBe(0);

            const list = await request(app).get(`${V1}/images?space=${spaceId}`).set(bearer());
            expect(list.body).toMatchObject({ space: spaceId, stats: { imageCount: 1, quotaBytes: 1024 * 1024 * 1024 } });
            const personalList = await request(app).get(`${V1}/images`).set(bearer());
            expect(personalList.body.images).toEqual([]);

            const byId = await mcp('get_image', { id: image.id });
            expect(byId.body.result.structuredContent.image.space).toBe(spaceId);

            const multipart = await request(app).post(`${V1}/images?space=${spaceId}`).set(bearer())
                .attach('image', GIF, { filename: 'team.gif', contentType: 'image/gif' });
            expect(multipart.body.image.space).toBe(spaceId);
            insertNote(db, 'space-doc', multipart.body.image.markdown, { personal: false });
            const usage = await request(app).get(`${V1}/images/${multipart.body.image.id}/usage`).set(bearer());
            expect(usage.body.documents.map((doc) => doc.id)).toEqual(['space-doc']);
        });

        it('a space the key cannot reach looks missing', async () => {
            const spaceId = newSpace();
            const { body } = await uploadJson({ filename: 'team.png', data: b64(PNG) }, { query: `?space=${spaceId}` });
            const id = body.image.id;

            const { secret: personalOnly } = await createKey(app, user, { name: 'Personal only', spaceAccess: 'personal' });
            const strangerKey = (await createKey(app, stranger, { name: 'Stranger' })).secret;
            for (const key of [personalOnly, strangerKey]) {
                const list = await request(app).get(`${V1}/images?space=${spaceId}`).set(bearer(key));
                expect([list.status, list.body.code]).toEqual([404, 'SPACE_NOT_FOUND']);
                const upload = await uploadJson({ filename: 'x.png', data: b64(PNG) }, { key, query: `?space=${spaceId}` });
                expect(upload.body.code).toBe('SPACE_NOT_FOUND');
                const multipart = await request(app).post(`${V1}/images?space=${spaceId}`).set(bearer(key))
                    .attach('image', PNG, { filename: 'x.png', contentType: 'image/png' });
                expect(multipart.body.code).toBe('SPACE_NOT_FOUND');
                for (const [method, url] of [['get', `/images/${id}`], ['get', `/images/${id}/usage`], ['delete', `/images/${id}`]]) {
                    const res = await request(app)[method](`${V1}${url}`).set(bearer(key));
                    expect([res.status, res.body.code], `${method} ${url}`).toEqual([404, 'IMAGE_NOT_FOUND']);
                    const qualified = await request(app)[method](`${V1}${url}?space=${spaceId}`).set(bearer(key));
                    expect(qualified.body.code).toBe('SPACE_NOT_FOUND');
                }
                const viaMcp = await mcp('get_image', { id }, key);
                expect(viaMcp.body.result.isError).toBe(true);
            }
            expect(getDb(`space:${spaceId}`).prepare('SELECT COUNT(*) AS n FROM images').get().n).toBe(1);
        });
    });
});
