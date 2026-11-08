// Templates, global variables and PDF export in the v1 API
// (docs/specs/proposed/ai-api-expansion.md §4.3), as plain operations taking
// `ctx` (see serviceCore.js). Templates and variables are read only; a Document
// made from a template goes through createDocument, so it follows the same write
// rules. PDFs are built like the app's Export (core documentPdf.js) and rendered
// by core pdf.js, which sanitizes, embeds images and applies the SSRF rules.
import { setFrontMatterValues } from '@panino/content-merge/front-matter';
import { assignmentId, STYLE_FRONT_MATTER_KEYS, STYLE_KINDS } from '@panino/content-merge/style-presets';
import { extractInputLabels, resolveTemplateTitle, resolveTemplateVariables } from '@panino/content-merge/template-variables';
import { Buffer } from 'node:buffer';
import { PDFDocument } from 'pdf-lib';
import { buildDocumentPdfRequest, databaseGlobals, sanitizeExportHtml, styleLibrary } from '../../documentPdf.js';
import { parseInternalImageSource, PDF_RUNTIME, renderPdf } from '../../pdf.js';
import { createDocument } from './documentService.js';
import { buildFolderIndex } from './keyUtils.js';
import {
    ApiError,
    locateDocument,
    readFolders,
    reachableTargets,
    requireAgentScope,
    resolveMany,
    resolveOne,
} from './serviceCore.js';

/** Most templates or variables one list returns, per database. */
export const LIBRARY_LIST_CAP = 500;
/** Largest PDF handed to an MCP client inline (base64 grows it by a third). */
export const MCP_PDF_MAX_BYTES = 10 * 1024 * 1024;
/** Largest `inputs` value accepted, in characters of JSON. */
const MAX_INPUTS_CHARS = 100 * 1024;

const templateNotFound = () => new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Template not found.');

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

function readTemplates(db) {
    try {
        return db.prepare(`
            SELECT id, name, content, title_pattern, default_folder_id, updated_at
              FROM templates ORDER BY updated_at DESC, id ASC LIMIT ?
        `).all(LIBRARY_LIST_CAP + 1);
    } catch {
        return []; // a database from before templates existed
    }
}

function readTemplate(db, id) {
    try {
        return db.prepare(`
            SELECT id, name, content, title_pattern, default_folder_id, updated_at
              FROM templates WHERE id = ?
        `).get(id) || null;
    } catch {
        return null;
    }
}

function templateShape(row, target, folderIndex, folderIds, { withContent = false } = {}) {
    const folderId = row.default_folder_id || null;
    const folderExists = Boolean(folderId && folderIds.has(folderId));
    return {
        id: row.id,
        name: row.name ?? '',
        titlePattern: row.title_pattern ?? '',
        defaultFolderId: folderId,
        // Null when the folder is gone: the Document then goes to the top level.
        defaultFolderPath: folderExists ? folderIndex.pathOf(folderId) : null,
        inputs: extractInputLabels(row.content ?? '', row.title_pattern ?? ''),
        space: target.spaceId,
        updatedAt: row.updated_at,
        ...(withContent ? { content: row.content ?? '' } : {}),
    };
}

/** The database holding a template: `space` when given, else every reachable one. */
function locateTemplate(ctx, space, id) {
    if (typeof id !== 'string' || !id || id.length > 200) throw templateNotFound();
    const candidates = space === undefined || space === null || space === '' ? reachableTargets(ctx) : [resolveOne(ctx, space)];
    for (const target of candidates) {
        const row = readTemplate(target.db, id);
        if (row) return { target, row };
    }
    throw templateNotFound();
}

/** Templates of every reachable database (or one, with `space`), most recently updated first. */
export function listTemplates(ctx, { space } = {}) {
    requireAgentScope(ctx, 'read');
    const templates = [];
    let truncated = false;
    for (const target of resolveMany(ctx, space)) {
        const rows = readTemplates(target.db);
        if (rows.length > LIBRARY_LIST_CAP) truncated = true;
        const folders = readFolders(target.db);
        const folderIndex = buildFolderIndex(folders);
        const folderIds = new Set(folders.map((folder) => folder.id));
        for (const row of rows.slice(0, LIBRARY_LIST_CAP)) {
            templates.push({ ...templateShape(row, target, folderIndex, folderIds), spaceName: target.name });
        }
    }
    templates.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return { templates, truncated };
}

/** One template with its body. */
export function getTemplate(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'read');
    const { target, row } = locateTemplate(ctx, space, id);
    const folders = readFolders(target.db);
    return {
        template: templateShape(row, target, buildFolderIndex(folders), new Set(folders.map((folder) => folder.id)), { withContent: true }),
    };
}

/** `inputs` as an object of label → text, from an object (REST) or JSON text (MCP). */
function parseInputs(inputs) {
    if (inputs === undefined || inputs === null || inputs === '') return Object.create(null);
    let value = inputs;
    if (typeof value === 'string') {
        if (value.length > MAX_INPUTS_CHARS) throw new ApiError(400, 'INVALID_INPUT', 'inputs is too large.');
        try {
            value = JSON.parse(value);
        } catch {
            throw new ApiError(400, 'INVALID_INPUT', 'inputs must be a JSON object of label to text.');
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError(400, 'INVALID_INPUT', 'inputs must be an object of label to text.');
    }
    const out = Object.create(null);
    for (const [label, text] of Object.entries(value)) {
        if (!['string', 'number', 'boolean'].includes(typeof text)) {
            throw new ApiError(400, 'INVALID_INPUT', 'Every value in inputs must be text.');
        }
        out[label] = String(text);
    }
    if (JSON.stringify(out).length > MAX_INPUTS_CHARS) throw new ApiError(400, 'INVALID_INPUT', 'inputs is too large.');
    return out;
}

/** `preview-style` / `print-style` front matter for the template's default styles, as the app adds. */
function templateStyleFrontMatter(db, templateId) {
    const library = styleLibrary(db);
    const entries = {};
    for (const kind of STYLE_KINDS) {
        const presetId = library.assignments.get(assignmentId('template', templateId, kind));
        const preset = presetId ? library.presets.find((candidate) => candidate.id === presetId) : null;
        if (preset) entries[STYLE_FRONT_MATTER_KEYS[kind]] = preset.name;
    }
    return entries;
}

/**
 * A new Document from a template, with the same title and body as the app's
 * "New from template": the title pattern (or the template's name) and the body
 * with `{{today}}`, `{{now}}` and `{{input:Label}}` filled in (labels without a
 * value become empty, as in the app), plus the template's default styles as
 * front matter. It goes into `folderId`, else the template's default folder
 * when that still exists, else the top level, in the template's database.
 */
export function createDocumentFromTemplate(ctx, { id, space, title, folderId, inputs } = {}) {
    requireAgentScope(ctx, 'write');
    const { target, row } = locateTemplate(ctx, space, id);
    const given = parseInputs(inputs);
    const labels = extractInputLabels(row.content ?? '', row.title_pattern ?? '');
    const values = Object.fromEntries(labels.map((label) => [label, Object.hasOwn(given, label) ? given[label] : '']));
    const unfilledInputs = labels.filter((label) => !Object.hasOwn(given, label));

    const template = { name: row.name ?? '', titlePattern: row.title_pattern ?? '' };
    // A template with neither a name nor a usable pattern still makes a Document.
    const name = title !== undefined && title !== null && title !== '' ? title : (resolveTemplateTitle(template, values) || 'Untitled');
    const content = setFrontMatterValues(
        resolveTemplateVariables(row.content ?? '', values),
        templateStyleFrontMatter(target.db, row.id),
    );

    let folder = folderId;
    if (folder === undefined || folder === null || folder === '') {
        const fallback = row.default_folder_id || null;
        const exists = fallback && target.db.prepare('SELECT 1 FROM folders WHERE id = ?').get(fallback);
        folder = exists ? fallback : 'root';
    }

    const { document } = createDocument(ctx, {
        space: target.spaceId ?? 'personal',
        title: name,
        content,
        folderId: folder,
    });
    return { document, template: { id: row.id, name: row.name ?? '' }, unfilledInputs };
}

/* ------------------------------------------------------------------ *
 * Global variables
 * ------------------------------------------------------------------ */

/** The global variables of one database (personal unless `space`), by display name. */
export function listVariables(ctx, { space } = {}) {
    requireAgentScope(ctx, 'read');
    const target = resolveOne(ctx, space);
    let rows;
    try {
        rows = target.db.prepare(`
            SELECT key, display_key, value, updated_at FROM globals
             ORDER BY coalesce(nullif(display_key, ''), key) COLLATE NOCASE ASC, key ASC
             LIMIT ?
        `).all(LIBRARY_LIST_CAP + 1);
    } catch {
        rows = []; // a database without globals yet
    }
    return {
        space: target.spaceId,
        variables: rows.slice(0, LIBRARY_LIST_CAP).map((variable) => ({
            key: variable.key,
            displayKey: variable.display_key || variable.key,
            value: variable.value ?? '',
            updatedAt: variable.updated_at,
        })),
        truncated: rows.length > LIBRARY_LIST_CAP,
    };
}

/* ------------------------------------------------------------------ *
 * PDF export
 * ------------------------------------------------------------------ */

const IMG_TAG_RE = /<img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const SRC_ATTR_RE = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * Drop images of shared spaces from HTML an agent limited to the personal
 * database exports: the renderer would otherwise embed any space image its
 * owner can read, past the key's reach.
 */
function withoutSpaceImages(html) {
    return String(html || '').replace(IMG_TAG_RE, (tag) => {
        const match = SRC_ATTR_RE.exec(tag);
        const source = match ? parseInternalImageSource(match[1] ?? match[2]) : null;
        return source?.spaceId ? '<!-- image unavailable -->' : tag;
    });
}

/** A filename for Content-Disposition: the title, made safe; `.pdf` added. */
export function pdfFilename(title) {
    const cleaned = String(title || '')
        .replace(/[\p{Cc}"\\/:*?<>|;]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
        .trim();
    const unicode = cleaned || 'Document';
    const ascii = unicode.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[%']/g, '').replace(/\s+/g, ' ').trim() || 'Document';
    return { ascii: `${ascii}.pdf`, unicode: `${unicode}.pdf` };
}

async function countPages(pdf) {
    try {
        return (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
    } catch {
        return null;
    }
}

function renderFailure(rendered) {
    switch (rendered.status) {
        case 503:
            return new ApiError(503, 'PDF_BUSY', 'The PDF service is busy. Try again shortly.',
                { retryAfterSeconds: rendered.retryAfterSeconds || 5 });
        case 504:
            return new ApiError(504, 'PDF_TIMEOUT', 'Making the PDF took too long.');
        case 413:
            return new ApiError(413, 'PDF_INPUT_TOO_LARGE', 'The Document or its print style is too large to render as a PDF.');
        case 400:
            return new ApiError(422, 'PDF_NOTHING_TO_RENDER', 'The Document has nothing to put in a PDF.');
        default:
            return new ApiError(500, 'PDF_FAILED', 'The PDF could not be made.');
    }
}

/**
 * A Document as a PDF, made like the app's Export: its print style, the shared
 * renderer, the database's global variables, sanitized HTML, internal images
 * embedded, then the server's renderer (its queue, limits and SSRF rules).
 *
 * @param {object} ctx
 * @param {{ id: string, space?: string, pageSize?: string, maxBytes?: number }} args
 *   `maxBytes` refuses a larger result with PDF_TOO_LARGE (the MCP cap)
 * @returns {Promise<{ document: object, pdf: Buffer, bytes: number, pages: number|null, filename: { ascii: string, unicode: string }, pageSize: string, printStyle: string|null }>}
 */
// PDFs render one at a time on a shared queue of PDF_QUEUE_LIMIT jobs. An agent may loop
// over many Documents, so each account keeps at most this many API exports in the queue,
// across all its keys and connected apps; the rest of the queue stays for the app's
// Export and for other accounts. Over the cap the answer is PDF_BUSY, as for a full queue.
export const MAX_PDF_EXPORTS_PER_ACCOUNT = 2;
const pdfExportsInFlight = new Map();

export async function exportPdf(ctx, { id, space, pageSize, maxBytes } = {}) {
    requireAgentScope(ctx, 'read');
    if (pageSize !== undefined && pageSize !== null && pageSize !== '' && !['A4', 'Letter'].includes(pageSize)) {
        throw new ApiError(400, 'INVALID_INPUT', 'pageSize must be A4 or Letter.');
    }
    const { target, note } = locateDocument(ctx, space, id);
    const built = buildDocumentPdfRequest({
        db: target.db,
        note,
        globals: databaseGlobals(target.db),
        sanitize: sanitizeExportHtml,
        pageSize: pageSize || undefined,
    });
    const request = built.request;
    if (!request.htmlContent.trim()) {
        throw new ApiError(422, 'PDF_NOTHING_TO_RENDER', 'The Document has nothing to put in a PDF.');
    }
    if (ctx.agent.spaceAccess !== 'all') {
        request.htmlContent = withoutSpaceImages(request.htmlContent);
        request.printStyles.printHeaderHtml = withoutSpaceImages(request.printStyles.printHeaderHtml);
        request.printStyles.printFooterHtml = withoutSpaceImages(request.printStyles.printFooterHtml);
    }

    const running = pdfExportsInFlight.get(ctx.userId) ?? 0;
    if (running >= MAX_PDF_EXPORTS_PER_ACCOUNT) {
        throw renderFailure({ status: 503, retryAfterSeconds: PDF_RUNTIME.retryAfterSeconds });
    }
    pdfExportsInFlight.set(ctx.userId, running + 1);
    let rendered;
    try {
        rendered = await renderPdf(request, { userId: ctx.userId });
    } finally {
        const left = (pdfExportsInFlight.get(ctx.userId) ?? 1) - 1;
        if (left > 0) pdfExportsInFlight.set(ctx.userId, left);
        else pdfExportsInFlight.delete(ctx.userId);
    }
    if (!rendered?.ok) throw renderFailure(rendered || {});
    const pdf = Buffer.isBuffer(rendered.pdf) ? rendered.pdf : Buffer.from(rendered.pdf);
    if (maxBytes && pdf.length > maxBytes) {
        throw new ApiError(413, 'PDF_TOO_LARGE', 'The PDF is too large to return here.', { bytes: pdf.length, maxBytes });
    }

    const folders = readFolders(target.db);
    const folderIndex = buildFolderIndex(folders);
    return {
        document: {
            id: note.id,
            title: note.title,
            folderId: note.folder_id ?? null,
            folderPath: folderIndex.pathOf(note.folder_id),
            space: target.spaceId,
            updatedAt: note.updated_at,
        },
        pdf,
        bytes: pdf.length,
        pages: await countPages(pdf),
        filename: pdfFilename(note.title),
        pageSize: request.printStyles.pageSize,
        printStyle: built.styleName,
    };
}
