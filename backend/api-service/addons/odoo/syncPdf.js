/**
 * The `/render-pdf` request for a Document in a sync (docs/specs/active/odoo-integration.md
 * §11, "Server-side rendering", Phase 12): built the way Export builds it in the browser,
 * from the shared pieces — the Document's print style (its own front matter, the nearest
 * folder with a default, or the account's print styles), the shared Markdown renderer with
 * the same inline styles, and the shared request builder — so a PDF filed by a sync looks
 * like one the person exported.
 */

import crypto from 'node:crypto';
import { applyDocumentVariables, createDocumentRenderer } from '@panino/content-merge/markdown-render';
import { applyStyleMap } from '@panino/content-merge/styled-renderer';
import { DEFAULT_PRINT_STYLES, buildPrintCss } from '@panino/content-merge/style-defaults';
import { isStyleKind, parseStyleValues, readDocumentStyleNames, resolveStylePreset } from '@panino/content-merge/style-presets';
import { buildPdfRequest, normalizePaperSize } from '@panino/content-merge/pdf-request';

/**
 * The account's saved print styles over the library defaults, as the Styles page
 * keeps them in `settings`.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {object}
 */
export function accountPrintStyles(db) {
    let saved = {};
    try {
        const row = db.prepare("SELECT value FROM settings WHERE id = 'printStyles'").get();
        if (row?.value) saved = JSON.parse(row.value);
    } catch {
        saved = {};
    }
    return { ...DEFAULT_PRINT_STYLES, ...(saved && typeof saved === 'object' ? saved : {}) };
}

/**
 * The named styles and folder defaults of a database, as the Styles page reads them.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ presets: object[], assignments: Map<string, string|null> }}
 */
export function styleLibrary(db) {
    let presets = [];
    let assignments = new Map();
    try {
        presets = db.prepare('SELECT id, kind, name, styles FROM style_presets').all()
            .filter((row) => isStyleKind(row.kind))
            .map((row) => ({ id: row.id, kind: row.kind, name: row.name, values: parseStyleValues(row.styles, row.kind) }));
        assignments = new Map(db.prepare('SELECT id, preset_id FROM style_assignments').all().map((row) => [row.id, row.preset_id || null]));
    } catch {
        // A database from before named styles existed.
    }
    return { presets, assignments };
}

/**
 * The folder ids above a Document, its own folder first.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string|null} folderId
 * @returns {string[]}
 */
export function folderTrail(db, folderId) {
    const trail = [];
    const seen = new Set();
    let current = folderId ?? null;
    while (current && !seen.has(current)) {
        seen.add(current);
        trail.push(current);
        current = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(current)?.parent_id ?? null;
    }
    return trail;
}

/**
 * @param {object} input
 * @param {import('better-sqlite3').Database} input.db the Document's database
 * @param {{ id: string, title: string, content: string, folder_id?: string|null }} input.note
 * @param {Map<string,string>|object} [input.globals] the account's global variables
 * @param {Date} [input.now]
 * @returns {{ request: { htmlContent: string, cssStyles: string, printStyles: object }, hash: string, styleSource: string }}
 */
export function buildSyncPdfRequest({ db, note, globals = {}, now = new Date() }) {
    const markdown = note.content || '';
    const names = readDocumentStyleNames(markdown);
    const library = styleLibrary(db);
    const resolved = resolveStylePreset({
        kind: 'print',
        documentStyleName: names.print,
        folderTrail: folderTrail(db, note.folder_id ?? null),
        presets: library.presets,
        assignments: library.assignments,
    });
    const styles = resolved.preset ? resolved.preset.values : accountPrintStyles(db);

    const md = applyStyleMap(createDocumentRenderer(), styles);
    const html = md.render(applyDocumentVariables(markdown, { globals, now }));
    const request = buildPdfRequest({
        html,
        cssStyles: buildPrintCss(styles),
        printStyles: styles,
        // The renderer sanitizes every fragment itself (pdf.js), so nothing is dropped here.
        sanitize: (fragment) => fragment,
        pageSize: normalizePaperSize(styles?.pageSize),
    });
    // What the PDF depends on, minus the date and time variables of the moment.
    const stable = applyDocumentVariables(markdown, { globals, now, formatDate: () => '', formatTime: () => '' });
    const hash = crypto.createHash('sha256')
        .update(JSON.stringify([note.title, stable, request.cssStyles, request.printStyles]))
        .digest('hex');
    return { request, hash, styleSource: resolved.source };
}
