// The core `/render-pdf` request builder for stored Documents (documentPdf.js), used by
// the Odoo and AI agents add-ons. The Odoo add-on's own suite
// (addons/odoo/tests/unit/syncPdf.test.js) still covers style resolution through its
// re-export; this covers what core adds for other callers.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { cleanupTestUser, setupTestUser } from '../testHelpers.js';
import { getUserDb } from '../../db.js';
import {
    buildDocumentPdfRequest,
    databaseGlobals,
    sanitizeExportHtml,
    styleLibrary,
} from '../../documentPdf.js';

describe('documentPdf', () => {
    let user;
    let db;
    const now = () => new Date().toISOString();

    beforeEach(async () => {
        user = await setupTestUser(`document-pdf-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@example.test`, 'password123');
        db = getUserDb(user.userId);
    });
    afterEach(() => cleanupTestUser(user.userId));

    const note = (content, folderId = null) => ({ id: 'n', title: 'T', content, folder_id: folderId });

    it('leaves HTML to the renderer by default, and sanitizes like Export when asked', () => {
        const content = '# Hi\n\n<script>alert(1)</script><p onclick="x()">p</p>';
        const raw = buildDocumentPdfRequest({ db, note: note(content) }).request;
        expect(raw.htmlContent).toContain('<script>');

        const clean = buildDocumentPdfRequest({ db, note: note(content), sanitize: sanitizeExportHtml });
        expect(clean.request.htmlContent).not.toContain('<script');
        expect(clean.request.htmlContent).not.toContain('onclick');
        expect(clean.request.htmlContent).toContain('<p>p</p>');
        // Header and footer fragments go through the same sanitizer.
        db.prepare("INSERT OR REPLACE INTO settings (id, value) VALUES ('printStyles', ?)")
            .run(JSON.stringify({ printHeaderHtml: '<b onmouseover="x()">Head</b>' }));
        const withHeader = buildDocumentPdfRequest({ db, note: note('x'), sanitize: sanitizeExportHtml });
        expect(withHeader.request.printStyles.printHeaderHtml).toBe('<b>Head</b>');
    });

    it('fills in the database\'s global variables', () => {
        db.prepare('INSERT INTO globals (key, id, value, display_key) VALUES (?, ?, ?, ?)').run('company name', uuidv4(), 'Acme', 'Company Name');
        const globals = databaseGlobals(db);
        expect([...globals]).toEqual([['company name', 'Acme']]);
        const { request } = buildDocumentPdfRequest({ db, note: note('For {{ Company  Name }}'), globals });
        expect(request.htmlContent).toContain('For Acme');
    });

    it('overrides the paper size for one export and names the print style it used', () => {
        const id = uuidv4();
        db.prepare('INSERT INTO style_presets (id, kind, name, styles, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, 'print', 'Memo', JSON.stringify({ h1: 'color: green' }), now(), now());
        const markdown = '---\nprint-style: Memo\n---\n# A';
        const named = buildDocumentPdfRequest({ db, note: note(markdown) });
        expect(named.styleName).toBe('Memo');
        expect(named.request.printStyles).toMatchObject({ h1: 'color: green', pageSize: 'A4' });
        const letter = buildDocumentPdfRequest({ db, note: note(markdown), pageSize: 'Letter' });
        expect(letter.request.printStyles.pageSize).toBe('Letter');
        // Without an override the result is what the Odoo add-on has always built.
        expect(buildDocumentPdfRequest({ db, note: note(markdown), pageSize: undefined }).hash).toBe(named.hash);
        expect(buildDocumentPdfRequest({ db, note: note('# A') }).styleName).toBeNull();
        expect(styleLibrary(db).presets.map((p) => p.name)).toEqual(['Memo']);
    });
});
