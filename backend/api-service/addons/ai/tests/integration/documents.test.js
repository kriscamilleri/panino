// The Documents area of the v1 API on REST and MCP (docs/specs/proposed/ai-api-expansion.md
// §4.1): metadata, partial reads, outline, exact edits, insertion, search and list options.
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteTestDb, getDb, getSpacesDb, getUserDb } from '../../../../db.js';
import { createSpace } from '../../../../spaces.js';
import { aiUser, createKey, createTestApp, offerAiAddon, resetAiState } from '../aiTestSetup.js';

const V1 = '/addons/ai/v1';
const IMAGE_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const T0 = '2026-11-01T10:00:00.000Z';

const LONG = [
    '# Project',
    '',
    'Intro text.',
    '',
    '## Budget',
    '',
    `Money ![chart](/images/${IMAGE_ID}) here.`,
    '',
    '```bash',
    '# not a heading',
    '```',
    '',
    '### Detail',
    '',
    'Fine print.',
    '',
    '## Notes',
    '',
    'One note.',
    '',
    '## Notes',
    '',
    'Another note.',
].join('\n');

describe('AI agents add-on: Documents area', () => {
    let app;
    let server;
    let restore;
    let user;
    let secret;
    let readSecret;
    let spaceId;

    const bearer = (key = secret) => ({ Authorization: `Bearer ${key}` });
    const db = () => getUserDb(user.userId);

    function insertNote(id, title, content, {
        folderId = null, updatedAt = T0, createdAt = updatedAt, pinned = 0, target = null,
    } = {}) {
        if (target) {
            target.prepare(`INSERT INTO notes (id, folder_id, title, content, pinned, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, folderId, title, content, pinned, createdAt, updatedAt);
            return;
        }
        db().prepare(`INSERT INTO notes (id, user_id, folder_id, title, content, pinned, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, user.userId, folderId, title, content, pinned, createdAt, updatedAt);
    }

    function insertFolder(id, name, parentId = null) {
        db().prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(id, user.userId, name, parentId, '2026-10-01T00:00:00.000Z');
    }

    function contentOf(id, target = db()) {
        return target.prepare('SELECT content FROM notes WHERE id = ?').get(id).content;
    }

    function revisions(id, target = db()) {
        return target.prepare('SELECT actor_kind, actor_label FROM note_revisions WHERE note_id = ? ORDER BY created_at, rowid').all(id);
    }

    let nextId = 1;
    const mcp = (name, args, key = secret) => request(app).post(`${V1}/mcp`)
        .set('Authorization', `Bearer ${key}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
    const text = (res) => res.body.result.content[0].text;

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
        spaceId = null;
        user = await aiUser('documents');
        ({ secret } = await createKey(app, user, { name: 'Claude Code' }));
        ({ secret: readSecret } = await createKey(app, user, { name: 'Reader', scope: 'read' }));
    });
    afterEach(() => {
        const spacesDb = getSpacesDb();
        if (spaceId) {
            spacesDb.prepare('DELETE FROM space_members WHERE space_id = ?').run(spaceId);
            spacesDb.prepare('DELETE FROM spaces WHERE id = ?').run(spaceId);
            deleteTestDb(`space:${spaceId}`);
        }
        spacesDb.prepare('DELETE FROM space_user_versions WHERE user_id = ?').run(user.userId);
        user.cleanup();
    });

    describe('reading', () => {
        beforeEach(() => insertNote('n-long', 'Project', LONG, { pinned: 1, createdAt: '2026-10-01T09:00:00.000Z' }));

        it('adds metadata to the Document', async () => {
            await request(app).post(`${V1}/documents/n-long/append`).set(bearer()).send({ content: 'Appended.' }).expect(200);
            const res = await request(app).get(`${V1}/documents/n-long`).set(bearer(readSecret));
            expect(res.status).toBe(200);
            const doc = res.body.document;
            expect(doc).toMatchObject({
                id: 'n-long',
                createdAt: '2026-10-01T09:00:00.000Z',
                pinned: true,
                lineCount: 25,
                totalLines: 25,
                characterCount: doc.content.length,
                revisionCount: 2,
                imageIds: [IMAGE_ID],
                webUrl: 'https://panino.test/#/doc/n-long',
                range: { startLine: 1, endLine: 25 },
                partial: false,
            });
            expect(doc.wordCount).toBe(doc.content.trim().split(/\s+/).length);
            expect(doc.content.endsWith('Appended.')).toBe(true);
        });

        it('reads a line range, clamping the end, as JSON and Markdown', async () => {
            const res = await request(app).get(`${V1}/documents/n-long?startLine=5&endLine=7`).set(bearer(readSecret));
            expect(res.body.document).toMatchObject({ content: `## Budget\n\nMoney ![chart](/images/${IMAGE_ID}) here.`, range: { startLine: 5, endLine: 7 }, partial: true, totalLines: 23 });
            const tail = await request(app).get(`${V1}/documents/n-long?startLine=22&endLine=999`).set(bearer(readSecret));
            expect(tail.body.document).toMatchObject({ content: '\nAnother note.', range: { startLine: 22, endLine: 23 } });
            const md = await request(app).get(`${V1}/documents/n-long?format=markdown&endLine=1`).set(bearer(readSecret));
            expect(md.text).toBe('# Project');
            expect(md.headers['x-panino-total-lines']).toBe('23');
            expect(md.headers['x-panino-line-range']).toBe('1-1');
        });

        it('reads a section, through its subsections, ignoring fenced code', async () => {
            const res = await request(app).get(`${V1}/documents/n-long?section=budget`).set(bearer(readSecret));
            expect(res.body.document.range).toEqual({ startLine: 5, endLine: 16 });
            expect(res.body.document.section).toEqual({ text: 'Budget', level: 2, slug: 'budget', line: 5 });
            expect(res.body.document.content).toContain('Fine print.');
            expect(res.body.document.content).not.toContain('## Notes');
        });

        it('refuses ambiguous and missing sections, and bad ranges, with clear codes', async () => {
            const ambiguous = await request(app).get(`${V1}/documents/n-long?section=Notes`).set(bearer(readSecret));
            expect(ambiguous.status).toBe(400);
            expect(ambiguous.body).toMatchObject({ code: 'HEADING_AMBIGUOUS', details: { matchCount: 2, lines: [17, 21] } });
            const chosen = await request(app).get(`${V1}/documents/n-long?section=Notes&headingLine=21`).set(bearer(readSecret));
            expect(chosen.body.document.content).toBe('## Notes\n\nAnother note.');
            const missing = await request(app).get(`${V1}/documents/n-long?section=Nope`).set(bearer(readSecret));
            expect(missing.body.code).toBe('HEADING_NOT_FOUND');

            for (const query of ['startLine=0', 'startLine=24', 'startLine=5&endLine=4']) {
                const res = await request(app).get(`${V1}/documents/n-long?${query}`).set(bearer(readSecret));
                expect(res.status, query).toBe(400);
                expect(res.body, query).toMatchObject({ code: 'INVALID_RANGE', details: { totalLines: 23 } });
            }
            const notNumber = await request(app).get(`${V1}/documents/n-long?startLine=two`).set(bearer(readSecret));
            expect(notNumber.body.code).toBe('INVALID_INPUT');
            const both = await request(app).get(`${V1}/documents/n-long?section=Budget&startLine=1`).set(bearer(readSecret));
            expect(both.body.code).toBe('INVALID_INPUT');
        });

        it('returns metadata only on request', async () => {
            const res = await request(app).get(`${V1}/documents/n-long?includeContent=false`).set(bearer(readSecret));
            expect(res.body.document).not.toHaveProperty('content');
            expect(res.body.document).toMatchObject({ lineCount: 23, partial: false });
        });

        it('lists the outline with slugs and section ends', async () => {
            const res = await request(app).get(`${V1}/documents/n-long/outline`).set(bearer(readSecret));
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ document: { id: 'n-long', title: 'Project' }, totalLines: 23, truncated: false });
            expect(res.body.headings).toEqual([
                { level: 1, text: 'Project', slug: 'project', line: 1, endLine: 23 },
                { level: 2, text: 'Budget', slug: 'budget', line: 5, endLine: 16 },
                { level: 3, text: 'Detail', slug: 'detail', line: 13, endLine: 16 },
                { level: 2, text: 'Notes', slug: 'notes', line: 17, endLine: 20 },
                { level: 2, text: 'Notes', slug: 'notes-1', line: 21, endLine: 23 },
            ]);
        });

        it('gives MCP clients the metadata, the range and the outline as text', async () => {
            const part = await mcp('get_document', { id: 'n-long', section: 'Detail' }, readSecret);
            expect(text(part)).toMatch(/^Title: Project\nid: n-long\n/);
            expect(text(part)).toContain('pinned: yes');
            expect(text(part)).toContain(`images: ${IMAGE_ID}`);
            expect(text(part)).toContain('web_url: https://panino.test/#/doc/n-long');
            expect(text(part)).toContain('showing: lines 13–16 of 23');
            expect(text(part).endsWith('### Detail\n\nFine print.\n')).toBe(true);
            expect(part.body.result.structuredContent.document.range).toEqual({ startLine: 13, endLine: 16 });

            const meta = await mcp('get_document', { id: 'n-long', include_content: false }, readSecret);
            expect(text(meta)).toContain('text: not included');
            expect(text(meta)).not.toContain('Intro text.');

            const outline = await mcp('get_document_outline', { id: 'n-long' }, readSecret);
            expect(text(outline)).toContain('    ### Detail — lines 13–16 of 23 — slug detail');
            expect(text(outline)).toContain('  ## Notes — lines 21–23 of 23 — slug notes-1');

            const ambiguous = await mcp('get_document', { id: 'n-long', section: 'notes' }, readSecret);
            expect(ambiguous.body.result.isError).toBe(true);
            expect(text(ambiguous)).toMatch(/heading_line.*lines 17, 21\./);
            const range = await mcp('get_document', { id: 'n-long', start_line: 50 }, readSecret);
            expect(text(range)).toMatch(/That line range.*The Document has 23 lines\./);
        });
    });

    describe('edit_document', () => {
        beforeEach(() => insertNote('n-edit', 'Plan', '# Plan\n\nShip on Friday.\nReview on Friday.\n'));

        it('replaces one exact match, attributed in revision history', async () => {
            const res = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer())
                .send({ oldText: 'Ship on Friday', newText: 'Ship on Monday', expectedUpdatedAt: T0 });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ replacements: 1, line: 3, document: { content: '# Plan\n\nShip on Monday.\nReview on Friday.\n' } });
            expect(res.body.document.updatedAt).not.toBe(T0);
            expect(revisions('n-edit')).toEqual([
                { actor_kind: null, actor_label: null },
                { actor_kind: 'api', actor_label: 'Claude Code' },
            ]);
        });

        it('says nothing changed when new_text equals old_text, and records no revision', async () => {
            const rest = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer()).send({ oldText: 'Ship', newText: 'Ship' });
            expect(rest.status).toBe(200);
            expect(rest.body).toMatchObject({ changed: false, document: { updatedAt: T0 } });
            const viaMcp = await mcp('edit_document', { id: 'n-edit', old_text: 'Ship', new_text: 'Ship' });
            expect(text(viaMcp)).toContain('Nothing changed');
            expect(text(viaMcp)).not.toContain('replaced');
            expect(revisions('n-edit')).toEqual([]);
            const changed = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer()).send({ oldText: 'Ship', newText: 'Sail' });
            expect(changed.body.changed).toBe(true);
        });

        it('refuses no match and an ambiguous match, and replaces all on request', async () => {
            const none = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer()).send({ oldText: 'Sunday', newText: 'x' });
            expect(none.status).toBe(400);
            expect(none.body.code).toBe('EDIT_NO_MATCH');
            const many = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer()).send({ oldText: 'Friday', newText: 'Monday' });
            expect(many.status).toBe(400);
            expect(many.body).toMatchObject({ code: 'EDIT_AMBIGUOUS', details: { matchCount: 2 } });
            expect(contentOf('n-edit')).toBe('# Plan\n\nShip on Friday.\nReview on Friday.\n');
            const all = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer()).send({ oldText: 'Friday', newText: 'Monday', replaceAll: true });
            expect(all.body).toMatchObject({ replacements: 2, line: 3 });
            expect(contentOf('n-edit')).toBe('# Plan\n\nShip on Monday.\nReview on Monday.\n');
        });

        it('deletes with an empty newText and refuses an empty oldText', async () => {
            const res = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer()).send({ oldText: 'Review on Friday.\n', newText: '' });
            expect(res.body.document.content).toBe('# Plan\n\nShip on Friday.\n');
            const empty = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer()).send({ oldText: '', newText: 'x' });
            expect(empty.body.code).toBe('INVALID_INPUT');
            const missing = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer()).send({ oldText: 'Plan' });
            expect(missing.body.code).toBe('INVALID_INPUT');
        });

        it('honours expectedUpdatedAt, the size cap and read-only keys', async () => {
            const stale = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer())
                .send({ oldText: 'Ship', newText: 'Send', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
            expect(stale.status).toBe(409);
            expect(stale.body).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentUpdatedAt: T0 } });
            const big = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer())
                .send({ oldText: 'Ship', newText: 'x'.repeat(2 * 1024 * 1024) });
            expect(big.status).toBe(413);
            const readOnly = await request(app).post(`${V1}/documents/n-edit/edit`).set(bearer(readSecret)).send({ oldText: 'Ship', newText: 'Send' });
            expect(readOnly.status).toBe(403);
            expect(readOnly.body.code).toBe('INSUFFICIENT_SCOPE');
            expect(contentOf('n-edit')).toBe('# Plan\n\nShip on Friday.\nReview on Friday.\n');
            expect(revisions('n-edit')).toEqual([]);
        });

        it('works over MCP with errors that say what to do', async () => {
            const ok = await mcp('edit_document', { id: 'n-edit', old_text: 'Ship on Friday', new_text: 'Ship on Monday' });
            expect(ok.body.result.isError).toBeUndefined();
            expect(text(ok)).toMatch(/^Edited "Plan" \(id n-edit\): replaced 1 occurrence at line 3\. updated_at is now /);
            expect(ok.body.result.structuredContent).toMatchObject({ replacements: 1, line: 3 });

            const many = await mcp('edit_document', { id: 'n-edit', old_text: 'on', new_text: 'at' });
            expect(many.body.result.isError).toBe(true);
            expect(text(many)).toMatch(/replace_all.*It occurs \d+ times\./);
            const none = await mcp('edit_document', { id: 'n-edit', old_text: 'Sunday', new_text: 'x' });
            expect(text(none)).toContain('copy the text exactly');
            const conflict = await mcp('edit_document', { id: 'n-edit', old_text: 'Review', new_text: 'Check', expected_updated_at: T0 });
            expect(text(conflict)).toMatch(/Call get_document again.*Its updated_at is now/);

            const forced = await mcp('edit_document', { id: 'n-edit', old_text: 'Plan', new_text: 'x' }, readSecret);
            expect(forced.body.result.isError).toBe(true);
            expect(text(forced)).toContain('read-only');
        });
    });

    describe('insert_into_document', () => {
        const DOC = '# Log\n\n## Monday\n\n- one\n\n## Tuesday\n\n- two\n';
        beforeEach(() => insertNote('n-ins', 'Log', DOC));

        it('keeps each line ending of a Document that mixes CRLF and LF', async () => {
            // The review case: every ending used to become CRLF, so history showed a whole-Document change.
            insertNote('n-mixed', 'Mixed', 'a\r\nb\nc\r\n');
            await request(app).post(`${V1}/documents/n-mixed/insert`).set(bearer()).send({ content: 'X', position: 'end' }).expect(200);
            expect(contentOf('n-mixed')).toBe('a\r\nb\nc\r\n\r\nX\r\n');
        });

        it('reads the outline of a Document holding a 2 MiB line of spaces in linear time', async () => {
            // The review's high finding: the fence pattern backtracked quadratically on it,
            // which would have blocked the server for hours.
            insertNote('n-spaces', 'Spaces', `# Top\n${' '.repeat(2 * 1024 * 1024 - 100)}\n## Below\n`);
            const started = performance.now();
            const outline = await request(app).get(`${V1}/documents/n-spaces/outline`).set(bearer());
            expect(outline.status).toBe(200);
            expect(outline.body.headings.map((heading) => heading.text)).toEqual(['Top', 'Below']);
            const appended = await request(app).post(`${V1}/documents/n-spaces/append`).set(bearer()).send({ content: 'x' });
            expect(appended.status).toBe(200);
            expect(performance.now() - started).toBeLessThan(5000);
        });

        it('inserts at each position with blank-line spacing', async () => {
            const cases = [
                [{ position: 'start' }, `NEW\n\n${DOC}`, 1],
                [{ position: 'end' }, `${DOC}\nNEW\n`, 11],
                // Every case yields a different body, so none is skipped as a duplicate revision.
                [{ position: 'before_heading', heading: 'monday' }, DOC.replace('## Monday', 'NEW\n\n## Monday'), 3],
                [{ position: 'after_heading', heading: 'Monday' }, DOC.replace('## Monday\n', '## Monday\n\nNEW\n'), 5],
                [{ position: 'end_of_section', heading: 'Monday' }, DOC.replace('- one\n', '- one\n\nNEW\n'), 7],
            ];
            for (const [input, expected, line] of cases) {
                db().prepare('UPDATE notes SET content = ? WHERE id = ?').run(DOC, 'n-ins');
                const res = await request(app).post(`${V1}/documents/n-ins/insert`).set(bearer()).send({ content: 'NEW', ...input });
                expect(res.status, input.position).toBe(200);
                expect(res.body.document.content, input.position).toBe(expected);
                expect(res.body.line, input.position).toBe(line);
            }
            expect(revisions('n-ins').filter((row) => row.actor_kind === 'api')).toHaveLength(5);
        });

        it('refuses unknown and ambiguous headings, and bad input', async () => {
            db().prepare('UPDATE notes SET content = ? WHERE id = ?').run(`${DOC}\n## Monday\n\n- three\n`, 'n-ins');
            const missing = await request(app).post(`${V1}/documents/n-ins/insert`).set(bearer())
                .send({ content: 'x', position: 'after_heading', heading: 'Friday' });
            expect(missing.body.code).toBe('HEADING_NOT_FOUND');
            const ambiguous = await request(app).post(`${V1}/documents/n-ins/insert`).set(bearer())
                .send({ content: 'x', position: 'end_of_section', heading: 'Monday' });
            expect(ambiguous.body).toMatchObject({ code: 'HEADING_AMBIGUOUS', details: { matchCount: 2, lines: [3, 11] } });
            const chosen = await request(app).post(`${V1}/documents/n-ins/insert`).set(bearer())
                .send({ content: '- four', position: 'end_of_section', heading: 'Monday', headingLine: 11 });
            expect(chosen.body.document.content.endsWith('## Monday\n\n- three\n- four\n')).toBe(true);

            for (const input of [
                { content: 'x', position: 'middle' },
                { content: 'x', position: 'after_heading' },
                { content: '\n\n', position: 'end' },
                { position: 'end' },
            ]) {
                const res = await request(app).post(`${V1}/documents/n-ins/insert`).set(bearer()).send(input);
                expect(res.body.code, JSON.stringify(input)).toBe('INVALID_INPUT');
            }
        });

        it('works over MCP', async () => {
            const res = await mcp('insert_into_document', { id: 'n-ins', content: '- zero', position: 'after_heading', heading: 'Monday' });
            expect(text(res)).toMatch(/^Inserted into "Log" \(id n-ins\) at line 5\. updated_at is now /);
            expect(contentOf('n-ins')).toContain('## Monday\n\n- zero\n- one');
            expect(revisions('n-ins').at(-1)).toEqual({ actor_kind: 'api', actor_label: 'Claude Code' });
            const missing = await mcp('insert_into_document', { id: 'n-ins', content: 'x', position: 'before_heading', heading: 'Sunday' });
            expect(text(missing)).toContain('get_document_outline');
            const absent = await mcp('insert_into_document', { id: 'n-ins', content: 'x' });
            expect(text(absent)).toBe('The argument "position" is required.');
        });
    });

    describe('search', () => {
        beforeEach(() => {
            insertFolder('f-clients', 'Clients');
            insertFolder('f-acme', 'Acme', 'f-clients');
            insertFolder('f-other', 'Other');
            insertNote('n-1', 'Acme invoice', 'Invoice for Acme.\nDue date is Friday.\nInvoice total 100.', { folderId: 'f-acme', updatedAt: '2026-11-01T10:00:00.000Z' });
            insertNote('n-2', 'Meeting', 'We discussed the invoice.\nThe due date moved.', { folderId: 'f-clients', updatedAt: '2026-11-03T10:00:00.000Z' });
            insertNote('n-3', 'Due date list', 'Invoice dates only.', { folderId: 'f-other', updatedAt: '2026-11-02T10:00:00.000Z' });
            insertNote('n-4', 'Unrelated', 'Nothing here.', { updatedAt: '2026-11-04T10:00:00.000Z' });
        });

        const search = (query, key = readSecret) => request(app).get(`${V1}/search?${query}`).set(bearer(key));

        it('requires every term, keeps phrases whole, and ranks title matches first', async () => {
            const res = await search('q=invoice%20due');
            expect(res.status).toBe(200);
            expect(res.body.terms).toEqual(['invoice', 'due']);
            expect(res.body.results.map((hit) => hit.id)).toEqual(['n-3', 'n-1', 'n-2']);
            expect(res.body.results[0]).toMatchObject({ matchedTitle: false, createdAt: '2026-11-02T10:00:00.000Z', pinned: false });

            const phrase = await search(`q=${encodeURIComponent('"due date" invoice')}`);
            expect(phrase.body.results.map((hit) => hit.id)).toEqual(['n-3', 'n-1', 'n-2']);
            const strict = await search(`q=${encodeURIComponent('"date is"')}`);
            expect(strict.body.results.map((hit) => hit.id)).toEqual(['n-1']);
        });

        it('ignores the case of letters outside ASCII, in titles and bodies', async () => {
            // The review case: SQL folded ASCII only, so "ÜBER" missed "über".
            insertNote('n-5', 'Über uns', 'Wir sind ÜBERALL. Größe zählt.', { updatedAt: '2026-11-05T10:00:00.000Z' });
            insertNote('n-6', 'Sigma', 'ΣΟΦΊΑ and wisdom', { updatedAt: '2026-11-06T10:00:00.000Z' });
            expect((await search(`q=${encodeURIComponent('über')}`)).body.results.map((hit) => hit.id)).toEqual(['n-5']);
            expect((await search(`q=${encodeURIComponent('überall')}&in=content`)).body.results.map((hit) => hit.id)).toEqual(['n-5']);
            expect((await search(`q=${encodeURIComponent('größe')}`)).body.results.map((hit) => hit.id)).toEqual(['n-5']);
            expect((await search(`q=${encodeURIComponent('σοφία')}`)).body.results.map((hit) => hit.id)).toEqual(['n-6']);
            const hit = (await search(`q=${encodeURIComponent('ÜBER uns')}`)).body.results[0];
            expect(hit).toMatchObject({ id: 'n-5', matchedTitle: true });
        });

        it('matches % and _ literally', async () => {
            insertNote('n-7', 'Rates', 'Growth of 100% in a_b terms.', { updatedAt: '2026-11-05T10:00:00.000Z' });
            insertNote('n-8', 'Other rates', 'Growth of 1000 in axb terms.', { updatedAt: '2026-11-05T11:00:00.000Z' });
            expect((await search(`q=${encodeURIComponent('100%')}`)).body.results.map((hit) => hit.id)).toEqual(['n-7']);
            expect((await search(`q=${encodeURIComponent('a_b')}`)).body.results.map((hit) => hit.id)).toEqual(['n-7']);
            expect((await search(`q=${encodeURIComponent('\\ab')}`)).body.results).toEqual([]);
        });

        it('counts matches and returns up to three snippets with line numbers', async () => {
            const res = await search('q=invoice&in=content');
            const acme = res.body.results.find((hit) => hit.id === 'n-1');
            expect(acme.matchCount).toBe(2);
            expect(acme.snippets).toEqual([{ line: 1, text: 'Invoice for Acme.' }, { line: 3, text: 'Invoice total 100.' }]);
            expect(acme.snippet).toContain('Invoice');
            expect(acme.matchedTitle).toBe(false);
        });

        it('searches titles or bodies only, by folder subtree and by update time', async () => {
            const titles = await search('q=invoice&in=title');
            expect(titles.body.results.map((hit) => hit.id)).toEqual(['n-1']);
            const bodies = await search('q=meeting&in=content');
            expect(bodies.body.results).toEqual([]);
            const inClients = await search('q=invoice&folderId=f-clients');
            expect(inClients.body.results.map((hit) => hit.id).sort()).toEqual(['n-1', 'n-2']);
            const unknownFolder = await search('q=invoice&folderId=f-missing');
            expect(unknownFolder.body.code).toBe('FOLDER_NOT_FOUND');
            const recent = await search('q=invoice&updatedAfter=2026-11-01T12:00:00%2B00:00');
            expect(recent.body.results.map((hit) => hit.id)).toEqual(['n-2', 'n-3']);
            const badTime = await search('q=invoice&updatedAfter=yesterday');
            expect(badTime.body.code).toBe('INVALID_INPUT');
            const badField = await search('q=invoice&in=everywhere');
            expect(badField.body.code).toBe('INVALID_INPUT');
        });

        it('pages with offset and nextOffset', async () => {
            const first = await search('q=invoice&limit=2');
            expect(first.body.results.map((hit) => hit.id)).toEqual(['n-1', 'n-2']);
            expect(first.body.nextOffset).toBe(2);
            const second = await search('q=invoice&limit=2&offset=2');
            expect(second.body.results.map((hit) => hit.id)).toEqual(['n-3']);
            expect(second.body.nextOffset).toBeNull();
            const mcpPage = await mcp('search_documents', { query: 'invoice', limit: 2 }, readSecret);
            expect(text(mcpPage)).toContain('1. Acme invoice');
            expect(text(mcpPage)).toContain('   line 1: Invoice for Acme.');
            expect(text(mcpPage)).toContain('More results: call again with offset 2.');
            const mcpNext = await mcp('search_documents', { query: 'invoice', limit: 2, offset: 2 }, readSecret);
            expect(text(mcpNext)).toMatch(/^3\. Due date list/);
        });

        it('keeps the 2 to 200 character limit and leaves Trash out', async () => {
            expect((await search('q=a')).status).toBe(400);
            expect((await search(`q=${'x'.repeat(201)}`)).status).toBe(400);
            await request(app).delete(`${V1}/documents/n-3`).set(bearer()).expect(200);
            const res = await search('q=invoice');
            expect(res.body.results.map((hit) => hit.id)).toEqual(['n-1', 'n-2']);
            const withTrash = await search('q=invoice&includeTrash=true');
            expect(withTrash.body.results).toHaveLength(3);
        });
    });

    describe('list_documents', () => {
        beforeEach(() => {
            insertNote('n-a', 'banana', 'x', { createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' });
            insertNote('n-b', 'Apple', 'x', { createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z', pinned: 1 });
            insertNote('n-c', 'cherry', 'x', { createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' });
        });

        async function pages(query) {
            const ids = [];
            let cursor = null;
            for (let i = 0; i < 5; i += 1) {
                const res = await request(app).get(`${V1}/documents?limit=1&${query}${cursor ? `&cursor=${cursor}` : ''}`).set(bearer(readSecret));
                expect(res.status).toBe(200);
                ids.push(...res.body.documents.map((doc) => doc.id));
                cursor = res.body.nextCursor;
                if (!cursor) break;
            }
            return ids;
        }

        it('pages each sort with its own cursor', async () => {
            expect(await pages('')).toEqual(['n-b', 'n-c', 'n-a']);
            expect(await pages('sort=created')).toEqual(['n-a', 'n-c', 'n-b']);
            expect(await pages('sort=title')).toEqual(['n-b', 'n-a', 'n-c']);
        });

        it('refuses a cursor from another sort, and an unknown sort', async () => {
            const first = await request(app).get(`${V1}/documents?limit=1&sort=title`).set(bearer(readSecret));
            const mixed = await request(app).get(`${V1}/documents?limit=1&cursor=${first.body.nextCursor}`).set(bearer(readSecret));
            expect(mixed.status).toBe(400);
            expect(mixed.body.code).toBe('INVALID_INPUT');
            expect(mixed.body.error).toContain('another sort');
            const unknown = await request(app).get(`${V1}/documents?sort=size`).set(bearer(readSecret));
            expect(unknown.body.code).toBe('INVALID_INPUT');
        });

        it('filters pinned and recently updated Documents, with createdAt and pinned in summaries', async () => {
            const pinned = await request(app).get(`${V1}/documents?pinnedOnly=true`).set(bearer(readSecret));
            expect(pinned.body.documents).toEqual([expect.objectContaining({ id: 'n-b', pinned: true, createdAt: '2026-10-01T00:00:00.000Z' })]);
            const recent = await request(app).get(`${V1}/documents?updatedAfter=2026-11-01T12:00:00Z`).set(bearer(readSecret));
            expect(recent.body.documents.map((doc) => doc.id)).toEqual(['n-b', 'n-c']);

            const viaMcp = await mcp('list_documents', { sort: 'created', pinned_only: true }, readSecret);
            expect(text(viaMcp)).toMatch(/^1\. Apple — id n-b — updated .* — created 2026-10-01T00:00:00.000Z — pinned$/);
        });
    });

    describe('spaces and live sessions', () => {
        let spaceDb;
        beforeEach(() => {
            spaceId = createSpace({ actorUserId: user.userId, name: 'Team' }).spaceId;
            spaceDb = getDb(`space:${spaceId}`);
            insertNote('s-1', 'Team plan', '# Team\n\n## Goals\n\nShip it.\n', { target: spaceDb });
        });

        it('finds a space Document by id for reads and edits, with a link that opens its space', async () => {
            const read = await request(app).get(`${V1}/documents/s-1?section=goals`).set(bearer(readSecret));
            expect(read.body.document).toMatchObject({ space: spaceId, content: '## Goals\n\nShip it.\n', webUrl: `https://panino.test/#/doc/s-1?dbKey=space%3A${spaceId}` });
            const outline = await request(app).get(`${V1}/documents/s-1/outline`).set(bearer(readSecret));
            expect(outline.body.headings.map((heading) => heading.text)).toEqual(['Team', 'Goals']);

            const edit = await mcp('edit_document', { id: 's-1', old_text: 'Ship it.', new_text: 'Ship it on Monday.' });
            expect(edit.body.result.isError).toBeUndefined();
            const insert = await request(app).post(`${V1}/documents/s-1/insert`).set(bearer()).send({ content: 'Then rest.', position: 'end_of_section', heading: 'Goals' });
            expect(insert.status).toBe(200);
            expect(contentOf('s-1', spaceDb)).toBe('# Team\n\n## Goals\n\nShip it on Monday.\n\nThen rest.\n');
            expect(revisions('s-1', spaceDb).filter((row) => row.actor_kind === 'api').map((row) => row.actor_label)).toEqual(['Claude Code', 'Claude Code']);
        });

        it('a key without space access sees a space Document as missing', async () => {
            const { secret: personal } = await createKey(app, user, { name: 'Personal only', spaceAccess: 'personal' });
            for (const call of [
                request(app).get(`${V1}/documents/s-1`).set(bearer(personal)),
                request(app).get(`${V1}/documents/s-1/outline`).set(bearer(personal)),
                request(app).post(`${V1}/documents/s-1/edit`).set(bearer(personal)).send({ oldText: 'Ship', newText: 'x' }),
                request(app).post(`${V1}/documents/s-1/insert`).set(bearer(personal)).send({ content: 'x', position: 'end' }),
            ]) {
                const res = await call;
                expect(res.status).toBe(404);
                expect(res.body.code).toBe('NOT_FOUND');
            }
            const explicit = await request(app).get(`${V1}/documents/s-1/outline?space=${spaceId}`).set(bearer(personal));
            expect(explicit.body.code).toBe('SPACE_NOT_FOUND');
            const viaMcp = await mcp('get_document_outline', { id: 's-1' }, personal);
            expect(text(viaMcp)).toContain('search_documents');
            const search = await request(app).get(`${V1}/search?q=team`).set(bearer(personal));
            expect(search.body.results).toEqual([]);
        });

        it('refuses edits and insertions while a live session is open', async () => {
            spaceDb.prepare(`INSERT INTO collab_sessions (note_id, session_id, ydoc_state, base_content, base_hash, started_at, updated_at)
                             VALUES ('s-1', 'sess-1', x'00', 'x', 'h', '2026', '2026')`).run();
            const rest = [
                request(app).post(`${V1}/documents/s-1/edit`).set(bearer()).send({ oldText: 'Ship', newText: 'x' }),
                request(app).post(`${V1}/documents/s-1/insert`).set(bearer()).send({ content: 'x', position: 'end' }),
            ];
            for (const call of rest) {
                const res = await call;
                expect(res.status).toBe(409);
                expect(res.body.code).toBe('DOCUMENT_IN_LIVE_SESSION');
            }
            const viaMcp = await mcp('insert_into_document', { id: 's-1', content: 'x', position: 'start' });
            expect(viaMcp.body.result.isError).toBe(true);
            expect(text(viaMcp)).toContain('editing this Document live');
            expect(contentOf('s-1', spaceDb)).toBe('# Team\n\n## Goals\n\nShip it.\n');
        });
    });
});
