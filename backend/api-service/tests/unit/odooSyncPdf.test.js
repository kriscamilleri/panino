import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { cleanupTestUser, setupTestUser } from '../testHelpers.js';
import { getUserDb } from '../../db.js';
import { DEFAULT_PRINT_STYLES } from '@panino/content-merge/style-defaults';
import { assignmentId } from '@panino/content-merge/style-presets';
import { accountPrintStyles, buildSyncPdfRequest, folderTrail, styleLibrary } from '../../odooSyncPdf.js';

describe('buildSyncPdfRequest', () => {
    let user;
    let db;
    const now = () => new Date().toISOString();

    beforeEach(async () => {
        user = await setupTestUser(`odoo-sync-pdf-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@example.test`, 'password123');
        db = getUserDb(user.userId);
    });
    afterEach(() => cleanupTestUser(user.userId));

    function folder(name, parentId = null) {
        const id = uuidv4();
        db.prepare('INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)').run(id, user.userId, name, parentId, now());
        return id;
    }
    function preset(kind, name, values) {
        const id = uuidv4();
        db.prepare('INSERT INTO style_presets (id, kind, name, styles, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, kind, name, JSON.stringify(values), now(), now());
        return id;
    }

    it('uses the account print styles over the defaults when nothing names a style', () => {
        db.prepare("INSERT OR REPLACE INTO settings (id, value) VALUES ('printStyles', ?)").run(JSON.stringify({ h1: 'color: purple', pageSize: 'Letter' }));
        expect(accountPrintStyles(db)).toMatchObject({ ...DEFAULT_PRINT_STYLES, h1: 'color: purple', pageSize: 'Letter' });

        const note = { id: 'n', title: 'Memo', content: '# Memo\n\nHello {{ who }} on {{ GLOBAL_DATE }}', folder_id: null };
        const { request, hash, styleSource } = buildSyncPdfRequest({ db, note, globals: { who: 'Ada' }, now: new Date('2026-10-28T10:00:00Z') });
        expect(styleSource).toBe('default');
        expect(request.htmlContent).toContain('<h1 style="color: purple">Memo</h1>');
        expect(request.htmlContent).toContain('Hello Ada on ');
        expect(request.printStyles.pageSize).toBe('Letter');
        expect(request.cssStyles).toContain('h1 { color: purple }');
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        // The hash ignores the time of day but follows content and styles.
        const later = buildSyncPdfRequest({ db, note, globals: { who: 'Ada' }, now: new Date('2026-10-29T11:00:00Z') });
        expect(later.hash).toBe(hash);
        expect(buildSyncPdfRequest({ db, note: { ...note, content: 'changed' } }).hash).not.toBe(hash);
    });

    it('takes the folder default, and the Document’s own front matter over it', () => {
        const root = folder('Root');
        const sub = folder('Sub', root);
        const memo = preset('print', 'Memo', { h1: 'color: green', p: 'margin: 1em' });
        const quote = preset('print', 'Quote', { h1: 'color: red' });
        preset('preview', 'Quote', { h1: 'color: black' });
        db.prepare('INSERT INTO style_assignments (id, target_type, target_id, kind, preset_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(assignmentId('folder', root, 'print'), 'folder', root, 'print', memo, now());
        expect(folderTrail(db, sub)).toEqual([sub, root]);
        expect(styleLibrary(db).presets.map((p) => p.name).sort()).toEqual(['Memo', 'Quote', 'Quote']);

        const inherited = buildSyncPdfRequest({ db, note: { id: 'a', title: 'A', content: '# A\n\ntext', folder_id: sub } });
        expect(inherited.styleSource).toBe('folder');
        expect(inherited.request.htmlContent).toContain('<h1 style="color: green">A</h1>');
        expect(inherited.request.htmlContent).toContain('<p style="margin: 1em">text</p>');

        const own = buildSyncPdfRequest({ db, note: { id: 'b', title: 'B', content: '---\nprint-style: Quote\n---\n\n# B', folder_id: sub } });
        expect(own.styleSource).toBe('document');
        expect(own.request.htmlContent).toContain('<h1 style="color: red">B</h1>');
        expect(own.request.htmlContent).not.toContain('print-style');
        expect(quote).toBeTruthy();
    });
});
