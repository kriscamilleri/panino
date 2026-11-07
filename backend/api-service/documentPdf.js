/**
 * The `/render-pdf` request for a stored Document, built on the server the way Export
 * builds it in the browser (frontend/src/composables/useDocumentPdfRequest.js), from the
 * shared pieces: the Document's print style (its own front matter, the nearest folder
 * with a default, or the account's print styles), the shared Markdown renderer with the
 * same inline styles, the database's global variables, and the shared request builder.
 * Used by add-ons that make PDFs without a browser (Odoo syncs, the AI agents API), so a
 * PDF made on the server looks like one the person exported.
 *
 * Rendering itself is `renderPdf` in pdf.js, which sanitizes again, embeds internal
 * images and fetches external ones under the SSRF rules.
 */

import crypto from 'node:crypto';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { applyDocumentVariables, createDocumentRenderer } from '@panino/content-merge/markdown-render';
import { applyStyleMap } from '@panino/content-merge/styled-renderer';
import { DEFAULT_PRINT_STYLES, buildPrintCss } from '@panino/content-merge/style-defaults';
import { isStyleKind, parseStyleValues, readDocumentStyleNames, resolveStylePreset } from '@panino/content-merge/style-presets';
import { buildPdfRequest, normalizePaperSize } from '@panino/content-merge/pdf-request';

const purify = DOMPurify(new JSDOM('').window);

/**
 * The browser Export's sanitizer: DOMPurify with its default profile, as
 * `DOMPurify.sanitize(html)` runs in the app.
 *
 * @param {string} html
 * @returns {string}
 */
export function sanitizeExportHtml(html) {
    return purify.sanitize(String(html ?? ''));
}

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
 * The named styles and folder and template defaults of a database, as the Styles page
 * reads them.
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
 * The global variables of a database, keyed by their normalized name, as the app's
 * global variables store hands them to the renderer.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Map<string, string>}
 */
export function databaseGlobals(db) {
    const map = new Map();
    try {
        for (const row of db.prepare('SELECT key, value FROM globals').all()) {
            if (row.key) map.set(row.key, row.value ?? '');
        }
    } catch {
        // A database without globals yet.
    }
    return map;
}

/**
 * @param {object} input
 * @param {import('better-sqlite3').Database} input.db the Document's database
 * @param {{ id: string, title: string, content: string, folder_id?: string|null }} input.note
 * @param {Map<string,string>|object} [input.globals] the database's global variables
 * @param {Date} [input.now]
 * @param {(html: string) => string} [input.sanitize] applied to every HTML fragment; the
 *   default leaves them as they are, because the renderer sanitizes each fragment itself
 *   (pdf.js). Pass `sanitizeExportHtml` for a request identical to the browser's.
 * @param {string} [input.pageSize] 'A4' or 'Letter' for this export only; default the
 *   print style's
 * @returns {{ request: { htmlContent: string, cssStyles: string, printStyles: object }, hash: string, styleSource: string, styleName: string|null }}
 */
export function buildDocumentPdfRequest({ db, note, globals = {}, now = new Date(), sanitize = (fragment) => fragment, pageSize }) {
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
        sanitize,
        pageSize: pageSize ? normalizePaperSize(pageSize) : normalizePaperSize(styles?.pageSize),
    });
    // What the PDF depends on, minus the date and time variables of the moment.
    const stable = applyDocumentVariables(markdown, { globals, now, formatDate: () => '', formatTime: () => '' });
    const hash = crypto.createHash('sha256')
        .update(JSON.stringify([note.title, stable, request.cssStyles, request.printStyles]))
        .digest('hex');
    return { request, hash, styleSource: resolved.source, styleName: resolved.preset?.name ?? null };
}
