// Templates, global variables and PDF export in the v1 API, on REST and MCP
// (docs/specs/proposed/ai-api-expansion.md §4.3).
//
// renderPdf is wrapped in a spy that calls the real renderer (Chromium is in the
// test image), so the happy path makes a real PDF; failure cases replace one call
// with the renderer's own refusal shapes.
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assignmentId } from '@panino/content-merge/style-presets';

vi.mock('../../../../pdf.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, renderPdf: vi.fn((...args) => actual.renderPdf(...args)) };
});

const { renderPdf } = await import('../../../../pdf.js');
const { deleteTestDb, getDb, getSpacesDb, getUserDb } = await import('../../../../db.js');
const { createSpace } = await import('../../../../spaces.js');
const { buildOpenApiDocument } = await import('../../openapi.js');
const { MCP_PDF_MAX_BYTES, pdfFilename } = await import('../../libraryService.js');
const { aiUser, createKey, createTestApp, offerAiAddon, resetAiState } = await import('../aiTestSetup.js');

const V1 = '/addons/ai/v1';
const MCP = `${V1}/mcp`;
const T0 = '2026-11-01T10:00:00.000Z';

describe('AI agents add-on: templates, variables and PDF export', () => {
    let app;
    let server;
    let restore;
    let user;
    let secret;
    let db;
    let spaceId;

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
        renderPdf.mockClear();
        user = await aiUser('library');
        ({ secret } = await createKey(app, user, { name: 'Claude Code' }));
        db = getUserDb(user.userId);
        spaceId = null;
    });
    afterEach(() => {
        if (spaceId) {
            const spacesDb = getSpacesDb();
            spacesDb.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
            spacesDb.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
            deleteTestDb(`space:${spaceId}`);
        }
        getSpacesDb().prepare('DELETE FROM space_user_versions WHERE user_id = ?').run(user.userId);
        user.cleanup();
    });

    const bearer = (key = secret) => ({ Authorization: `Bearer ${key}` });

    function folder(target, name, parentId = null) {
        const id = uuidv4();
        target.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)').run(id, user.userId, name, parentId, T0);
        return id;
    }
    function template(target, { id = uuidv4(), name, content = '', titlePattern = '', defaultFolderId = null, updatedAt = T0 }) {
        target.prepare(`INSERT INTO templates (id, name, content, title_pattern, default_folder_id, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, name, content, titlePattern, defaultFolderId, T0, updatedAt);
        return id;
    }
    function note(target, { id = uuidv4(), title, content, folderId = null }) {
        target.prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, user.userId, folderId, title, content, T0, T0);
        return id;
    }
    function variable(target, displayKey, value, updatedAt = T0) {
        const key = displayKey.trim().replace(/\s+/g, ' ').toLowerCase();
        target.prepare('INSERT INTO globals (key, id, value, created_at, updated_at, display_key) VALUES (?, ?, ?, ?, ?, ?)')
            .run(key, uuidv4(), value, T0, updatedAt, displayKey);
    }
    function preset(target, kind, name, values) {
        const id = uuidv4();
        target.prepare('INSERT INTO style_presets (id, kind, name, styles, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, kind, name, JSON.stringify(values), T0, T0);
        return id;
    }
    function assign(target, targetType, targetId, kind, presetId) {
        target.prepare('INSERT INTO style_assignments (id, target_type, target_id, kind, preset_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(assignmentId(targetType, targetId, kind), targetType, targetId, kind, presetId, T0);
    }
    function makeSpace() {
        spaceId = createSpace({ actorUserId: user.userId, name: 'Team' }).spaceId;
        return getDb(`space:${spaceId}`);
    }

    let nextId = 1;
    const call = (name, args = {}, key = secret) => request(app).post(MCP)
        .set(bearer(key))
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
    const text = (res) => res.body.result.content[0].text;

    describe('templates', () => {
        it('lists templates of every reachable database without bodies, newest first', async () => {
            const clients = folder(db, 'Clients');
            const acme = folder(db, 'Acme', clients);
            const bug = template(db, { name: 'Bug report', content: '# {{input:Bug Title}}\n{{input:Steps}}', titlePattern: 'Bug: {{input:Bug Title}}', defaultFolderId: acme, updatedAt: '2026-11-03T00:00:00.000Z' });
            const gone = template(db, { name: 'Orphan', content: 'x', defaultFolderId: 'missing-folder', updatedAt: '2026-11-02T00:00:00.000Z' });
            const spaceDb = makeSpace();
            const shared = template(spaceDb, { name: 'Team minutes', content: '# Minutes', updatedAt: '2026-11-04T00:00:00.000Z' });

            const res = await request(app).get(`${V1}/templates`).set(bearer());
            expect(res.status).toBe(200);
            expect(res.body.templates.map((t) => t.id)).toEqual([shared, bug, gone]);
            expect(res.body.templates[1]).toEqual({
                id: bug,
                name: 'Bug report',
                titlePattern: 'Bug: {{input:Bug Title}}',
                defaultFolderId: acme,
                defaultFolderPath: 'Clients/Acme',
                inputs: ['Bug Title', 'Steps'],
                space: null,
                spaceName: 'Personal',
                updatedAt: '2026-11-03T00:00:00.000Z',
            });
            expect(res.body.templates[2].defaultFolderPath).toBeNull();
            expect(res.body.templates[0]).toMatchObject({ space: spaceId, spaceName: 'Team' });
            expect(res.body.templates[0]).not.toHaveProperty('content');
            expect(res.body.truncated).toBe(false);

            const personal = await request(app).get(`${V1}/templates?space=personal`).set(bearer());
            expect(personal.body.templates.map((t) => t.id)).toEqual([bug, gone]);

            const { secret: personalOnly } = await createKey(app, user, { name: 'Personal only', scope: 'read', spaceAccess: 'personal' });
            const limited = await request(app).get(`${V1}/templates`).set(bearer(personalOnly));
            expect(limited.body.templates.map((t) => t.id)).toEqual([bug, gone]);
        });

        it('reads one template with its body, from any reachable database by id', async () => {
            const id = template(db, { name: 'Meeting', content: '# Meeting {{today}}\n\nWith {{ company }}' });
            const res = await request(app).get(`${V1}/templates/${id}`).set(bearer());
            expect(res.status).toBe(200);
            expect(res.body.template).toMatchObject({ id, name: 'Meeting', content: '# Meeting {{today}}\n\nWith {{ company }}', inputs: [], space: null });

            const spaceDb = makeSpace();
            const shared = template(spaceDb, { name: 'Shared', content: 'team' });
            const found = await request(app).get(`${V1}/templates/${shared}`).set(bearer());
            expect(found.body.template.space).toBe(spaceId);

            const missing = await request(app).get(`${V1}/templates/${uuidv4()}`).set(bearer());
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('TEMPLATE_NOT_FOUND');

            // A space the key cannot reach looks like a missing template.
            const { secret: personalOnly } = await createKey(app, user, { name: 'Personal only', scope: 'read', spaceAccess: 'personal' });
            const hidden = await request(app).get(`${V1}/templates/${shared}`).set(bearer(personalOnly));
            expect(hidden.status).toBe(404);
            expect(hidden.body.code).toBe('TEMPLATE_NOT_FOUND');
        });

        it('creates a Document like "New from template": title pattern, inputs, dates, styles, default folder', async () => {
            const target = folder(db, 'Bugs');
            const id = template(db, {
                name: 'Bug report',
                titlePattern: 'Bug: {{input:Bug Title}} ({{today:yyyy}})',
                content: '# {{input:Bug Title}}\n\nSteps: {{input:Steps}}\nCost: {{input:Cost}}\nFor {{ company }}',
                defaultFolderId: target,
            });
            const memo = preset(db, 'print', 'Memo', { h1: 'color: green' });
            assign(db, 'template', id, 'print', memo);

            const res = await request(app).post(`${V1}/templates/${id}/documents`).set(bearer())
                .send({ inputs: { 'Bug Title': 'Login fails', Cost: '$& 5' } });
            expect(res.status).toBe(201);
            const year = String(new Date().getFullYear());
            const { document } = res.body;
            expect(document).toMatchObject({ title: `Bug: Login fails (${year})`, folderId: target, folderPath: 'Bugs', space: null });
            expect(document.content).toBe('---\nprint-style: Memo\n---\n\n# Login fails\n\nSteps: \nCost: $& 5\nFor {{ company }}');
            expect(res.body.template).toEqual({ id, name: 'Bug report' });
            expect(res.body.unfilledInputs).toEqual(['Steps']);

            const stored = db.prepare('SELECT title, content, folder_id FROM notes WHERE id = ?').get(document.id);
            expect(stored).toEqual({ title: document.title, content: document.content, folder_id: target });
            const revisions = db.prepare('SELECT actor_kind, actor_label FROM note_revisions WHERE note_id = ?').all(document.id);
            expect(revisions).toEqual([{ actor_kind: 'api', actor_label: 'Claude Code' }]);
        });

        it('uses the template name without a pattern, a given title and folder, and the top level when the default folder is gone', async () => {
            const id = template(db, { name: 'Plain', content: 'Body', defaultFolderId: 'no-such-folder' });
            const plain = await request(app).post(`${V1}/templates/${id}/documents`).set(bearer()).send({});
            expect(plain.status).toBe(201);
            expect(plain.body.document).toMatchObject({ title: 'Plain', content: 'Body', folderId: null });

            const elsewhere = folder(db, 'Elsewhere');
            const given = await request(app).post(`${V1}/templates/${id}/documents`).set(bearer())
                .send({ title: 'My own title', folderId: elsewhere });
            expect(given.body.document).toMatchObject({ title: 'My own title', folderId: elsewhere });

            const badFolder = await request(app).post(`${V1}/templates/${id}/documents`).set(bearer()).send({ folderId: 'nope' });
            expect(badFolder.status).toBe(400);
            expect(badFolder.body.code).toBe('FOLDER_NOT_FOUND');

            // Labels named like Object properties are ordinary labels.
            const odd = template(db, { name: 'Odd', content: '[{{input:constructor}}][{{input:toString}}]' });
            const oddDoc = await request(app).post(`${V1}/templates/${odd}/documents`).set(bearer()).send({ inputs: { toString: 'x' } });
            expect(oddDoc.body.document.content).toBe('[][x]');
            expect(oddDoc.body.unfilledInputs).toEqual(['constructor']);

            const badInputs = await request(app).post(`${V1}/templates/${id}/documents`).set(bearer()).send({ inputs: ['x'] });
            expect(badInputs.status).toBe(400);
            expect(badInputs.body.code).toBe('INVALID_INPUT');
        });

        it('creates a space template\'s Document in that space', async () => {
            const spaceDb = makeSpace();
            const id = template(spaceDb, { name: 'Team minutes', content: '# Minutes' });
            const res = await request(app).post(`${V1}/templates/${id}/documents`).set(bearer()).send({});
            expect(res.status).toBe(201);
            expect(res.body.document.space).toBe(spaceId);
            expect(spaceDb.prepare('SELECT title FROM notes WHERE id = ?').get(res.body.document.id)).toEqual({ title: 'Team minutes' });
            expect(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n).toBe(0);
        });

        it('refuses a read-only key, on REST and MCP, and writes nothing', async () => {
            const id = template(db, { name: 'Plain', content: 'Body' });
            const { secret: reader } = await createKey(app, user, { name: 'Reader', scope: 'read' });
            const res = await request(app).post(`${V1}/templates/${id}/documents`).set(bearer(reader)).send({});
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('INSUFFICIENT_SCOPE');

            const listed = await request(app).post(MCP).set(bearer(reader)).set('Accept', 'application/json, text/event-stream')
                .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/list' });
            const names = listed.body.result.tools.map((tool) => tool.name);
            expect(names).toEqual(expect.arrayContaining(['list_templates', 'get_template', 'list_variables', 'export_pdf']));
            expect(names).not.toContain('create_document_from_template');
            const forced = await call('create_document_from_template', { id }, reader);
            expect(forced.body.result.isError).toBe(true);
            expect(text(forced)).toContain('read-only');
            expect(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n).toBe(0);
        });

        it('lists, reads and uses templates over MCP', async () => {
            const target = folder(db, 'Bugs');
            const id = template(db, { name: 'Bug report', titlePattern: 'Bug: {{input:Bug Title}}', content: '# {{input:Bug Title}}', defaultFolderId: target });

            const list = await call('list_templates');
            expect(text(list)).toBe(`1. Bug report — id ${id} — title pattern "Bug: {{input:Bug Title}}" — inputs: Bug Title — default folder Bugs`);
            expect(list.body.result.structuredContent.templates[0].id).toBe(id);

            const read = await call('get_template', { id });
            expect(text(read)).toContain('inputs: Bug Title');
            expect(text(read)).toContain('---\n# {{input:Bug Title}}');

            const created = await call('create_document_from_template', { id, inputs: '{"Bug Title": "Crash"}' });
            expect(created.body.result.isError).toBeUndefined();
            expect(text(created)).toMatch(/^Created "Bug: Crash" from the template "Bug report" — folder Bugs \(id [0-9a-f-]+\)\. updated_at is /);
            expect(created.body.result.structuredContent.document.content).toBe('# Crash');

            const badJson = await call('create_document_from_template', { id, inputs: '{not json' });
            expect(badJson.body.result.isError).toBe(true);

            const missing = await call('get_template', { id: uuidv4() });
            expect(missing.body.result.isError).toBe(true);
            expect(text(missing)).toContain('list_templates');
        });
    });

    describe('global variables', () => {
        it('lists one database\'s variables by display name, on REST and MCP', async () => {
            variable(db, 'Company Name', 'Acme BV', '2026-11-02T00:00:00.000Z');
            variable(db, 'address', 'Main St 1');
            const spaceDb = makeSpace();
            variable(spaceDb, 'Team', 'Blue');

            const res = await request(app).get(`${V1}/variables`).set(bearer());
            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                space: null,
                variables: [
                    { key: 'address', displayKey: 'address', value: 'Main St 1', updatedAt: T0 },
                    { key: 'company name', displayKey: 'Company Name', value: 'Acme BV', updatedAt: '2026-11-02T00:00:00.000Z' },
                ],
                truncated: false,
            });

            const shared = await request(app).get(`${V1}/variables?space=${spaceId}`).set(bearer());
            expect(shared.body.variables.map((v) => v.value)).toEqual(['Blue']);

            const mcp = await call('list_variables');
            expect(text(mcp)).toBe('1. {{address}} = "Main St 1"\n2. {{Company Name}} = "Acme BV"');
            const tools = await request(app).post(MCP).set(bearer()).set('Accept', 'application/json, text/event-stream')
                .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/list' });
            expect(tools.body.result.tools.find((tool) => tool.name === 'list_variables').description).toContain('{{name}}');

            const empty = await call('list_variables', { space: 'personal' });
            expect(empty.body.result.isError).toBeUndefined();
        });
    });

    describe('PDF export', () => {
        it('renders like Export: print style, variables, sanitized HTML, the owner\'s images; inline PDF over REST', async () => {
            const clients = folder(db, 'Clients');
            const memo = preset(db, 'print', 'Memo', { h1: 'color: green' });
            assign(db, 'folder', clients, 'print', memo);
            variable(db, 'Company', 'Acme BV');
            const imageId = uuidv4();
            const id = note(db, {
                title: 'Q3 / Report: "final"',
                folderId: clients,
                content: `# Report for {{ company }}\n\n<script>alert(1)</script><img src="x" onerror="alert(2)">\n\n![logo](/api/images/${imageId})\n`,
            });

            const res = await request(app).get(`${V1}/documents/${id}/pdf`).set(bearer())
                .buffer(true).parse((response, done) => {
                    const chunks = [];
                    response.on('data', (chunk) => chunks.push(chunk));
                    response.on('end', () => done(null, Buffer.concat(chunks)));
                });
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('application/pdf');
            expect(res.headers['content-disposition']).toBe('inline; filename="Q3 Report final.pdf"; filename*=UTF-8\'\'Q3%20Report%20final.pdf');
            expect(res.headers['cache-control']).toBe('private, no-store');
            expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
            expect(Number(res.headers['x-panino-pdf-pages'])).toBeGreaterThanOrEqual(1);

            expect(renderPdf).toHaveBeenCalledTimes(1);
            const [payload, options] = renderPdf.mock.calls[0];
            expect(options).toEqual({ userId: user.userId });
            expect(payload.htmlContent).toContain('<h1 style="color: green">Report for Acme BV</h1>');
            expect(payload.htmlContent).not.toContain('<script');
            expect(payload.htmlContent).not.toContain('onerror');
            expect(payload.htmlContent).toContain(`src="/api/images/${imageId}"`);
            expect(payload.cssStyles).toContain('h1 { color: green }');
            expect(payload.printStyles).toMatchObject({ h1: 'color: green', pageSize: 'A4' });
        });

        it('takes a page size, and refuses a bad one', async () => {
            const id = note(db, { title: 'Memo', content: '# Memo' });
            renderPdf.mockResolvedValueOnce({ ok: true, pdf: Buffer.from('%PDF-1.4 tiny') });
            const res = await request(app).get(`${V1}/documents/${id}/pdf?pageSize=Letter`).set(bearer());
            expect(res.status).toBe(200);
            expect(renderPdf.mock.calls[0][0].printStyles.pageSize).toBe('Letter');

            const bad = await request(app).get(`${V1}/documents/${id}/pdf?pageSize=A3`).set(bearer());
            expect(bad.status).toBe(400);
            expect(bad.body.code).toBe('INVALID_INPUT');
        });

        it('maps renderer refusals to closed codes', async () => {
            const id = note(db, { title: 'Memo', content: '# Memo' });
            const get = () => request(app).get(`${V1}/documents/${id}/pdf`).set(bearer());

            renderPdf.mockResolvedValueOnce({ ok: false, status: 503, message: 'PDF service busy, try again shortly', retryAfterSeconds: 10 });
            const busy = await get();
            expect(busy.status).toBe(503);
            expect(busy.headers['retry-after']).toBe('10');
            expect(busy.body).toEqual({ error: 'The PDF service is busy. Try again shortly.', code: 'PDF_BUSY', details: { retryAfterSeconds: 10 } });

            renderPdf.mockResolvedValueOnce({ ok: false, status: 504, message: 'PDF generation timed out' });
            expect((await get()).body.code).toBe('PDF_TIMEOUT');
            renderPdf.mockResolvedValueOnce({ ok: false, status: 413, message: 'CSS too large' });
            const large = await get();
            expect([large.status, large.body.code]).toEqual([413, 'PDF_INPUT_TOO_LARGE']);
            renderPdf.mockResolvedValueOnce({ ok: false, status: 500, message: 'PDF generation failed' });
            const failed = await get();
            expect([failed.status, failed.body.code]).toEqual([500, 'PDF_FAILED']);
            expect(JSON.stringify(failed.body)).not.toContain('generation failed');
        });

        it('refuses an empty Document without rendering, and a missing one with NOT_FOUND', async () => {
            const id = note(db, { title: 'Empty', content: '' });
            const empty = await request(app).get(`${V1}/documents/${id}/pdf`).set(bearer());
            expect([empty.status, empty.body.code]).toEqual([422, 'PDF_NOTHING_TO_RENDER']);
            expect(renderPdf).not.toHaveBeenCalled();
            const missing = await request(app).get(`${V1}/documents/${uuidv4()}/pdf`).set(bearer());
            expect([missing.status, missing.body.code]).toEqual([404, 'NOT_FOUND']);
        });

        it('keeps space images out of a PDF made with a personal-only key', async () => {
            makeSpace();
            const personalImage = uuidv4();
            const spaceImage = uuidv4();
            const id = note(db, { title: 'Mixed', content: `# Mixed\n\n![a](/api/images/${personalImage})\n\n![b](/api/images/${spaceImage}?space=${spaceId})` });
            const { secret: personalOnly } = await createKey(app, user, { name: 'Personal only', scope: 'read', spaceAccess: 'personal' });
            renderPdf.mockResolvedValue({ ok: true, pdf: Buffer.from('%PDF-1.4 tiny') });
            try {
                await request(app).get(`${V1}/documents/${id}/pdf`).set(bearer(personalOnly)).expect(200);
                const limited = renderPdf.mock.calls[0][0].htmlContent;
                expect(limited).toContain(`/api/images/${personalImage}`);
                expect(limited).not.toContain(spaceImage);

                await request(app).get(`${V1}/documents/${id}/pdf`).set(bearer()).expect(200);
                expect(renderPdf.mock.calls[1][0].htmlContent).toContain(spaceImage);
            } finally {
                renderPdf.mockReset();
                const actual = await vi.importActual('../../../../pdf.js');
                renderPdf.mockImplementation((...args) => actual.renderPdf(...args));
            }
        });

        it('returns an embedded PDF resource over MCP, within a size cap', async () => {
            const id = note(db, { title: 'Memo', content: '# Memo\n\nHello' });
            const res = await call('export_pdf', { id });
            expect(res.body.result.isError).toBeUndefined();
            const [summary, block] = res.body.result.content;
            expect(summary.text).toMatch(/^PDF of "Memo": 1 page, \d+ KB \(A4\)\. It is attached as the resource panino:\/\/documents\/.+\.pdf\.$/);
            expect(block.type).toBe('resource');
            expect(block.resource).toMatchObject({ uri: `panino://documents/${id}.pdf`, mimeType: 'application/pdf' });
            const bytes = Buffer.from(block.resource.blob, 'base64');
            expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
            expect(res.body.result.structuredContent).toMatchObject({ uri: `panino://documents/${id}.pdf`, bytes: bytes.length, pages: 1, filename: 'Memo.pdf', pageSize: 'A4' });

            renderPdf.mockResolvedValueOnce({ ok: true, pdf: Buffer.alloc(MCP_PDF_MAX_BYTES + 1) });
            const big = await call('export_pdf', { id });
            expect(big.body.result.isError).toBe(true);
            expect(text(big)).toContain('larger than 10 MB');

            renderPdf.mockResolvedValueOnce({ ok: false, status: 503, message: 'busy', retryAfterSeconds: 10 });
            const busy = await call('export_pdf', { id });
            expect(text(busy)).toContain('Wait about 10 seconds');

            const badSize = await call('export_pdf', { id, page_size: 'A5' });
            expect(badSize.body.result.isError).toBe(true);
        });
    });

    it('answers every path it describes', async () => {
        const described = Object.keys(buildOpenApiDocument().paths);
        expect(described).toEqual(expect.arrayContaining(['/templates', '/templates/{id}', '/templates/{id}/documents', '/variables', '/documents/{id}/pdf']));
    });

    it('makes safe filenames', () => {
        expect(pdfFilename('Café: plan / v2')).toEqual({ ascii: 'Cafe plan v2.pdf', unicode: 'Café plan v2.pdf' });
        expect(pdfFilename('\u0000\n')).toEqual({ ascii: 'Document.pdf', unicode: 'Document.pdf' });
        expect(pdfFilename('日本語')).toEqual({ ascii: 'Document.pdf', unicode: '日本語.pdf' });
    });
});
