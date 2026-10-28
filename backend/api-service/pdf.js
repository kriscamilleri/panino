// /backend/api-service/pdf.js
/**
 * ============================================================================
 * PDF GENERATION SERVICE
 * ============================================================================
 *
 * Converts sanitized HTML/CSS into PDF via Puppeteer.
 *
 * FLOW:
 * 1. POST /render-pdf with { htmlContent, cssStyles, printStyles }
 * 2. Validate print-style settings, sanitize HTML and CSS, embed images as data URIs
 * 3. Build HTML with @page rules and pagebreak helpers
 * 4. Run a draft pdf pass to resolve total pages for header/footer placeholders
 * 5. Render final PDF using Puppeteer's displayHeaderFooter templates
 *
 * THREAT MODEL (docs/architecture/pdf-pipeline.md):
 * - Every authenticated user can get their own markup and CSS rendered by the
 *   server's Chromium. The page therefore runs with JavaScript disabled and a
 *   request allow-list of `data:` URLs and Google Fonts; nothing else leaves it.
 * - All CSS is parsed and re-serialized (pdfSanitize.js) so no value can close the
 *   `<style>` block or attribute it is placed in; structured settings are validated
 *   against shared rules (shared/printStyleRules.js) and fall back to defaults.
 * - External images are fetched server-side with DNS pinning, redirect re-checks and
 *   a streaming size limit (imageFetch.js); a failed fetch leaves a placeholder, never
 *   the original URL.
 * - The queue is bounded and every job has a deadline; clients get fixed messages.
 *
 * DESIGN NOTES:
 * - Images are pre-embedded to avoid localhost fetch issues and enforce SSRF checks
 * - Single browser instance is reused; requests run sequentially to limit memory
 * - Page numbers use a draft render + pdf-lib count to populate %p/%P tokens
 *
 * ============================================================================
 */

import express from 'express';
import puppeteer from 'puppeteer';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import fs from 'fs';
import { getDb } from './db.js';
import { resolveSpaceAccess } from './spaces.js';
import { resolveStoredImagePath } from './spaceStorage.js';
import { parseInternalImageLink } from './imageLinks.js';
import { PDFDocument } from 'pdf-lib';
import { validatePrintStyles } from '@panino/content-merge/print-style-rules';
import {
    sanitizeStylesheet,
    sanitizeDeclarations,
    isAllowedRendererRequest,
    describeBlockedUrl,
    CSS_LIMITS,
    CssBudget,
    FONT_HOSTS,
} from './pdfSanitize.js';
import { fetchExternalImageAsDataUri } from './imageFetch.js';

export const pdfRoutes = express.Router();

const window = new JSDOM('').window;
const purify = DOMPurify(window);

// `<style>` elements and `style` attributes stay allowed in Document content, but their
// CSS goes through the same parser as the request stylesheet (defence in depth: a parsed
// `<style>` cannot close itself, and CSS can neither run code nor fetch after the request
// allow-list, but the output should match what the sanitizer would let through anyway).
// The budget of the request being sanitized. Sanitization is synchronous and the API is
// single-threaded, so one module-level slot is enough.
let currentCssBudget = null;

purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style') {
        node.textContent = sanitizeStylesheet(node.textContent, currentCssBudget);
    }
});
purify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'style') {
        data.attrValue = sanitizeDeclarations(data.attrValue, currentCssBudget);
    }
});

const CONFIG = {
    PAGE_LOAD_TIMEOUT: 10000,
    /** Largest request body accepted by this route; the global JSON limit is far higher. */
    MAX_REQUEST_BYTES: 16 * 1024 * 1024,
    /** External images fetched per render; the rest become placeholders. */
    MAX_EXTERNAL_IMAGES: 25,
    /** External images fetched at the same time. */
    IMAGE_FETCH_CONCURRENCY: 4,
};

/**
 * Queue and deadline settings. Exported so tests can tighten them; production reads the
 * environment once at startup.
 */
function positiveIntegerSetting(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const PDF_RUNTIME = {
    queueLimit: positiveIntegerSetting('PDF_QUEUE_LIMIT', 20),
    jobTimeoutMs: positiveIntegerSetting('PDF_JOB_TIMEOUT_MS', 45000),
    retryAfterSeconds: 10,
};

const ENABLE_REMOTE_FONTS = process.env.PDF_DISABLE_REMOTE_FONTS === '1'
    ? false
    : process.env.NODE_ENV !== 'test';

const log = (message, ...args) => console.log(`[PDF] ${message}`, ...args);
const logWarn = (message, ...args) => console.warn(`[PDF] ${message}`, ...args);
const logError = (message, ...args) => console.error(`[PDF] ${message}`, ...args);

// ============================================================================
// PRINT STYLE DEFAULTS + HELPERS
// ============================================================================

// The canonical print-style defaults for the service. These used to be a fallback for
// `poc/print-defaults.json`, read two directories up from here.
//
// That read never did anything. `poc/` is a proof of concept and is not part of the
// production image — the container's build context is `backend/api-service` — so the read
// always threw ENOENT and every PDF production has ever rendered used these values. In a dev
// checkout the file loaded, but its contents were byte-identical to this object (36 keys, 0
// differing), so it changed nothing there either.
//
// What it did do was maintain two sources of truth for the same styling, where editing the
// poc copy would silently change dev output and never reach production, and emit a warning
// on every production boot for a condition that was normal. Removed 2026-08-16.
const PRINT_STYLE_DEFAULTS = {
    h1: 'font-family: "Playfair Display", "Source Sans 3", Georgia, serif; font-size: 2.25rem; line-height: 1.15; color: #111827; margin-top: 2.5rem; margin-bottom: 1rem; font-weight: 600;',
    h2: 'font-family: "Playfair Display", "Source Sans 3", Georgia, serif; font-size: 1.75rem; line-height: 1.2; color: #1f2937; margin-top: 2rem; margin-bottom: .75rem; font-weight: 600;',
    h3: 'font-size: 1.5rem; line-height: 1.25; color: #1f2937; margin-top: 1.5rem; margin-bottom: .5rem; font-weight: 600;',
    h4: 'font-size: 1.25rem; line-height: 1.3; color: #374151; margin-top: 1.25rem; margin-bottom: .5rem; font-weight: 600;',
    h5: 'font-size: 1rem; line-height: 1.4; margin-top: 1rem; margin-bottom: .25rem; font-weight: 600; color: #374151;',
    h6: 'font-size: .875rem; line-height: 1.4; margin-top: 1rem; margin-bottom: .25rem; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; color: #4b5563;',
    p: 'margin: 0 0 1rem 0; line-height: 1.55;',
    ul: 'list-style-type: disc; margin: 0 0 1rem 1.5rem; padding: 0;',
    ol: 'list-style-type: decimal; margin: 0 0 1rem 1.5rem; padding: 0;',
    li: 'margin: .25rem 0;',
    code: 'font-family: "JetBrains Mono", ui-monospace, monospace; background-color: #f3f4f6; color: #111827; padding: .1rem .35rem; border-radius: 4px; font-size: .875em; font-variant-ligatures: none;',
    pre: 'display: block; width: 100%; box-sizing: border-box; font-family: "JetBrains Mono", ui-monospace, monospace; background-color: #f3f4f6; color: #111827; padding: 1rem 1.25rem; border-radius: 8px; overflow: auto; font-size: .875rem; line-height: 1.5; margin: 1.5rem 0; font-variant-ligatures: none;',
    blockquote: 'margin: 1.5rem 0; padding: .5rem 1rem; border-left: 4px solid #d1d5db; background-color: rgba(209, 213, 219, 0.08);',
    hr: 'border: 0; border-top: 1px solid #d1d5db; margin: 2rem 0;',
    em: 'font-style: italic;',
    strong: 'font-weight: 600;',
    a: 'color: #2563eb; text-decoration: underline; text-underline-offset: 2px;',
    img: 'max-width: 100%; height: auto; border-radius: 4px; margin: 1rem 0;',
    table: 'width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: .875rem;',
    tr: 'border-bottom: 1px solid #e5e7eb;',
    th: 'border: 1px solid #d1d5db; background-color: #f3f4f6; padding: .5rem .75rem; text-align: left; font-weight: 600;',
    td: 'border: 1px solid #d1d5db; padding: .5rem .75rem;',
    customCSS: `#preview-content, [data-testid="preview-content"] {\n  max-width: 72ch;\n  margin-left: auto;\n  margin-right: auto;\n  font-variant-numeric: proportional-nums;\n}\n/* Un-style code blocks inside <pre> so they inherit the parent's style */\npre > code {\n  background: transparent;\n  padding: 0;\n  border-radius: 0;\n  font-size: 1em;\n}\n`,
    googleFontFamily: 'Source Sans 3, JetBrains Mono, Playfair Display',
    printHeaderHtml: 'Professional Document',
    printFooterHtml: 'Page %p of %P',
    headerFontSize: '10',
    headerFontColor: '#666666',
    headerAlign: 'center',
    footerFontSize: '10',
    footerFontColor: '#666666',
    footerAlign: 'center',
    headerHeight: '2cm',
    footerHeight: '2.5cm',
    pageMargin: '2cm',
    enablePageNumbers: true,
};

const EXCLUDE_STYLE_KEYS = new Set([
    'customCSS', 'googleFontFamily', 'printHeaderHtml', 'printFooterHtml',
    'headerFontSize', 'headerFontColor', 'headerAlign', 'footerFontSize',
    'footerFontColor', 'footerAlign', 'enablePageNumbers', 'headerHeight',
    'footerHeight', 'pageMargin', 'pageSize',
]);

function fontsQuery(googleFontFamily) {
    return String(googleFontFamily || '')
        .split(',')
        .map(f => f.trim())
        .filter(Boolean)
        .map(f => `family=${encodeURIComponent(f)}:wght@400;600;700`)
        .join('&');
}

/**
 * The stylesheet built from validated print styles. Per-element values are declaration
 * lists and Custom CSS is a stylesheet; both are parsed and re-serialized.
 */
function printStylesToCss(styleMap = {}, budget = null) {
    const s = styleMap;
    let css = '';

    if (ENABLE_REMOTE_FONTS && s.googleFontFamily) {
        const families = fontsQuery(s.googleFontFamily);
        if (families) {
            css += `@import url('https://fonts.googleapis.com/css2?${families}&display=swap');\n\n`;
        }
    }

    // Validated family names match /^[\w\s-]+$/, so quoting them is safe.
    const primaryFont = s.googleFontFamily?.split(',')[0]?.trim();
    if (primaryFont) {
        css += `body { font-family: "${primaryFont}", sans-serif; }\n\n`;
    }

    for (const key of Object.keys(s)) {
        if (!s[key]) continue;
        if (EXCLUDE_STYLE_KEYS.has(key)) continue;
        const declarations = sanitizeDeclarations(s[key], budget);
        if (declarations) css += `${key} { ${declarations} }\n`;
    }

    if (s.customCSS) {
        css += `\n/* --- Custom CSS --- */\n${sanitizeStylesheet(s.customCSS, budget)}\n`;
    }

    // The composed sheet goes through the parser once more so the generated rules are
    // held to the same structure as everything else.
    return sanitizeStylesheet(css);
}

const DEFAULT_PRINT_STYLES = { ...PRINT_STYLE_DEFAULTS };

// ============================================================================
// IMAGE EMBEDDING
// ============================================================================

/**
 * An image link the PDF renderer may embed from this installation's own
 * storage, or null. Stricter than the shared parser: a link carrying any
 * parameter other than `space` and `token` is left to the external path.
 */
export function parseInternalImageSource(source) {
    const link = parseInternalImageLink(source);
    if (!link || link.extraParameters) return null;
    return { imageId: link.imageId, spaceId: link.spaceId };
}

/**
 * The bytes of one of this installation's own images, if `userId` may read it: their
 * personal image, or an image of a space they belong to.
 *
 * @param {string} source an `<img src>` value
 * @param {string} userId
 * @returns {{ imageId: string, mimeType: string, buffer: Buffer } | null}
 */
export function readInternalImage(source, userId) {
    try {
        const target = parseInternalImageSource(source);
        if (!target) return null;
        let dbKey = `user:${userId}`;
        if (target.spaceId) {
            const access = resolveSpaceAccess(target.spaceId, userId);
            if (!access) return null;
            dbKey = `space:${access.spaceId}`;
        }
        const db = getDb(dbKey);
        const image = target.spaceId
            ? db.prepare('SELECT mime_type, path FROM images WHERE id = ?').get(target.imageId)
            : db.prepare('SELECT mime_type, path FROM images WHERE id = ? AND user_id = ?').get(target.imageId, userId);

        if (!image?.path) return null;
        const absolutePath = resolveStoredImagePath(dbKey, image.path);
        if (!absolutePath || !fs.existsSync(absolutePath)) return null;

        return { imageId: target.imageId, mimeType: image.mime_type, buffer: fs.readFileSync(absolutePath) };
    } catch {
        return null;
    }
}

function getInternalImageAsDataUri(source, userId) {
    const image = readInternalImage(source, userId);
    return image ? `data:${image.mimeType};base64,${image.buffer.toString('base64')}` : null;
}

const IMAGE_PLACEHOLDER = '<!-- image unavailable -->';

// An <img> tag with quoted attribute values (jsdom leaves `>` unescaped inside them), and
// its src attribute.
const IMG_TAG_RE = /<img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const SRC_ATTR_RE = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * Replace every `<img src>` with a `data:` URI: internal images are read from storage,
 * external ones are fetched with the SSRF checks in imageFetch.js. An image that cannot
 * be embedded is replaced by a placeholder; the renderer would block its URL anyway, and
 * the placeholder keeps the output deterministic and the log accurate.
 *
 * Exported for tests.
 *
 * @param {string} html sanitized HTML
 * @param {string} userId
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function embedImagesAsDataUri(html, userId, { signal } = {}) {
    const images = [];
    for (const match of html.matchAll(IMG_TAG_RE)) {
        const attrs = match[1];
        const srcMatch = SRC_ATTR_RE.exec(attrs);
        if (!srcMatch) continue;
        images.push({ fullMatch: match[0], attrs, src: srcMatch[1] ?? srcMatch[2], srcText: srcMatch[0] });
    }

    if (images.length === 0) return html;

    log(`Processing ${images.length} images`);
    let externalCount = 0;

    const withSrc = (img, dataUri) => `<img${img.attrs.replace(img.srcText, () => ` src="${dataUri}"`)}>`;

    const replacements = await mapWithConcurrency(images, CONFIG.IMAGE_FETCH_CONCURRENCY, async (img, idx) => {
        const { fullMatch, src } = img;

        if (src.startsWith('data:')) {
            return { original: fullMatch, replacement: fullMatch };
        }

        const internalMatch = parseInternalImageSource(src);
        if (internalMatch) {
            const dataUri = getInternalImageAsDataUri(src, userId);
            if (dataUri) {
                const sizeKB = Math.round(dataUri.length / 1024);
                log(`  Image ${idx + 1}: Internal ${internalMatch.imageId} converted (${sizeKB}KB)`);
                return { original: fullMatch, replacement: withSrc(img, dataUri) };
            }
            log(`  Image ${idx + 1}: Internal lookup ${internalMatch.imageId} failed - falling back to external/cleanup`);
        }

        if (src.startsWith('http://') || src.startsWith('https://')) {
            if (externalCount >= CONFIG.MAX_EXTERNAL_IMAGES) {
                logWarn(`  Image ${idx + 1}: External image limit (${CONFIG.MAX_EXTERNAL_IMAGES}) reached - removing image`);
                return { original: fullMatch, replacement: IMAGE_PLACEHOLDER };
            }
            externalCount += 1;
            const result = await fetchExternalImageAsDataUri(src, { signal });
            if (result.ok) {
                log(`  Image ${idx + 1}: External fetched (${Math.round(result.bytes / 1024)}KB)`);
                return { original: fullMatch, replacement: withSrc(img, result.dataUri) };
            }
            const where = describeBlockedUrl(src);
            if (result.reason === 'blocked') {
                logWarn(`  Image ${idx + 1}: Blocked SSRF to ${where} - removing image`);
            } else {
                logWarn(`  Image ${idx + 1}: External fetch from ${where} failed (${logSafe(result.detail)}) - removing image`);
            }
            return { original: fullMatch, replacement: IMAGE_PLACEHOLDER };
        }

        log(`  Image ${idx + 1}: Unknown source type - removing image`);
        return { original: fullMatch, replacement: IMAGE_PLACEHOLDER };
    });

    let result = html;
    for (const { original, replacement } of replacements) {
        // A function replacer: `$&`-style patterns inside the replacement are literal.
        result = result.replace(original, () => replacement);
    }

    return result;
}

/** Remote-controlled text destined for the log: short, one line, printable. */
function logSafe(text) {
    // eslint-disable-next-line no-control-regex
    return String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80);
}

// ============================================================================
// BROWSER MANAGEMENT
// ============================================================================

let browserInstance = null;

async function getBrowser() {
    if (!browserInstance || !browserInstance.connected) {
        log('Launching browser...');
        // Prefetch and prerender links are issued by the browser process and never reach
        // request interception, so name resolution itself is restricted: nothing resolves
        // except, when remote fonts are on, the Google Fonts hosts. Interception stays as the
        // second layer for everything the page itself requests.
        const resolverRule = ENABLE_REMOTE_FONTS
            ? `MAP * ~NOTFOUND, ${FONT_HOSTS.map(h => `EXCLUDE ${new URL(h).hostname}`).join(', ')}`
            : 'MAP * ~NOTFOUND';
        browserInstance = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                `--host-resolver-rules=${resolverRule}`,
            ],
        });
    }
    return browserInstance;
}

process.on('exit', async () => {
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
});

// ============================================================================
// REQUEST QUEUE (sequential processing, bounded, with a per-job deadline)
// ============================================================================

let isProcessing = false;
const queue = [];

/**
 * A job is aborted by the deadline: `producePdf` stops at its next checkpoint, and the
 * browser context it owns, if it has one yet, is closed so a pending render fails fast.
 */
async function abortJob(job) {
    job.aborted = true;
    job.abort.abort();
    const context = job.context;
    job.context = null;
    if (!context) return;
    try {
        await context.close();
    } catch { /* already closed */ }
}

/** Hand a job its result once; later results (after a timeout) are dropped. */
function deliver(job, result) {
    if (job.delivered) return;
    job.delivered = true;
    job.deliver(result);
}

/**
 * Run one job under the deadline. On timeout the caller gets a fixed 504 and the job is
 * aborted so the next job starts clean. Errors never reach the caller; they are logged.
 */
async function runJob(job) {
    let timer;
    const deadline = new Promise(resolve => {
        timer = setTimeout(() => resolve('timeout'), PDF_RUNTIME.jobTimeoutMs);
    });

    const work = producePdf(job).then(
        (result) => {
            if (!job.aborted && result) deliver(job, result);
            return 'done';
        },
        (error) => {
            if (!job.aborted) {
                logError('Generation failed:', error);
                deliver(job, { ok: false, status: 500, message: 'PDF generation failed' });
            }
            return 'failed';
        },
    );

    const outcome = await Promise.race([work, deadline]);
    clearTimeout(timer);
    if (outcome !== 'timeout') return;

    logError(`Job exceeded ${PDF_RUNTIME.jobTimeoutMs}ms; aborting it`);
    deliver(job, { ok: false, status: 504, message: 'PDF generation timed out' });
    await abortJob(job);
    // Give the abandoned job a moment to settle before the next one starts.
    let settle;
    await Promise.race([work, new Promise(resolve => { settle = setTimeout(resolve, 5000); })]);
    clearTimeout(settle);
}

async function processQueue() {
    if (isProcessing || queue.length === 0) return;

    isProcessing = true;
    const job = queue.shift();

    try {
        await runJob(job);
    } catch (error) {
        logError('Queue worker failed:', error);
    } finally {
        isProcessing = false;
        job.resolve();
        if (queue.length > 0) setTimeout(processQueue, 50);
    }
}

/**
 * Queue a render. Resolves with `{ ok: true, pdf }` or `{ ok: false, status, message }`,
 * where `status` is the HTTP status the failure maps to (400, 401, 413, 500, 503, 504).
 * A full queue answers 503 at once, with `retryAfterSeconds`.
 *
 * @param {{ htmlContent?: string, cssStyles?: string, printStyles?: object }} payload
 * @param {{ userId: string }} options the user whose images may be embedded
 * @returns {Promise<{ ok: true, pdf: Buffer } | { ok: false, status: number, message: string, retryAfterSeconds?: number }>}
 */
export function renderPdf(payload, { userId }) {
    if (queue.length >= PDF_RUNTIME.queueLimit) {
        logWarn(`Queue full (${queue.length}); rejecting request`);
        return Promise.resolve({
            ok: false,
            status: 503,
            message: 'PDF service busy, try again shortly',
            retryAfterSeconds: PDF_RUNTIME.retryAfterSeconds,
        });
    }
    return new Promise((resolveResult) => {
        let result;
        queue.push({
            payload: payload || {},
            userId,
            deliver: (value) => { result = value; resolveResult(value); },
            // The queue resolves the job when it is finished with it; a result normally
            // arrived earlier, and this guards against one that never did.
            resolve: () => { if (!result) resolveResult({ ok: false, status: 500, message: 'PDF generation failed' }); },
            delivered: false,
            aborted: false,
            context: null,
            abort: new AbortController(),
        });
        processQueue().catch(error => logError('Queue start failed:', error));
    });
}

pdfRoutes.post('/render-pdf', async (req, res) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > CONFIG.MAX_REQUEST_BYTES) {
        return res.status(413).send('Request too large');
    }
    const result = await renderPdf(req.body, { userId: req.user?.user_id });
    if (res.headersSent) return undefined;
    if (!result.ok) {
        if (result.retryAfterSeconds) res.setHeader('Retry-After', String(result.retryAfterSeconds));
        return res.status(result.status).send(result.message);
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=document.pdf');
    return res.send(result.pdf);
});

// ============================================================================
// PDF GENERATION
// ============================================================================

/**
 * The header or footer template. `html` is sanitized and has its images embedded;
 * the other values are validated print-style settings.
 */
function buildHeaderFooterTemplate(html, align, fontSize, color, pageMargin, totalPagesText) {
    if (!html) return '';
    const replaced = html
        .replace(/%P/g, totalPagesText || '<span class="totalPages"></span>')
        .replace(/%p/g, '<span class="pageNumber"></span>');

    return `
        <div style="
            font-size: ${fontSize}px;
            color: ${color};
            width: 100%;
            padding: 0 ${pageMargin};
            text-align: ${align};
        ">
            ${replaced}
        </div>
    `;
}

/**
 * The page Chromium renders. `content` is sanitized HTML with embedded images, `css` is
 * sanitized CSS, and the print styles are validated.
 */
function buildHtmlDocument(content, css, printStyles) {
    const {
        pageSize = 'A4',
        pageMargin,
        headerHeight,
        footerHeight,
        googleFontFamily = '',
    } = printStyles;

    let fontsLink = '';
    if (ENABLE_REMOTE_FONTS && googleFontFamily) {
        const families = fontsQuery(googleFontFamily);
        if (families) {
            fontsLink = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">`;
        }
    }

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>PDF</title>
    ${fontsLink}
    <style>
        @page { 
            size: ${pageSize}; 
            margin: ${headerHeight} ${pageMargin} ${footerHeight} ${pageMargin};
        }
        html, body { 
            margin: 0; 
            padding: 0; 
        }
        body {
            font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
        }
        .pagebreak {
            display: none;
        }
        .pagebreak + * {
            break-before: page !important;
            page-break-before: always !important;
        }
        ${css}
    </style>
</head>
<body>${content}</body>
</html>`;
}

async function countPdfPages(buffer) {
    const doc = await PDFDocument.load(buffer);
    return doc.getPageCount();
}

/**
 * Render a finished HTML document to a PDF in a contained page: JavaScript off and every
 * request outside the allow-list aborted. Exported for the integration tests, which
 * feed it raw HTML to prove the containment without the sanitizers in front of it.
 *
 * @param {string} fullHtml
 * @param {object} options
 * @param {object} options.pdfOptions Puppeteer `page.pdf()` options without templates
 * @param {{ header: (totalPages: string|null) => string, footer: (totalPages: string|null) => string } | null} options.headerFooter
 * @param {object|null} [job] queue job; its `aborted` flag is honoured and it owns the context
 * @returns {Promise<Buffer>}
 */
export async function renderHtmlToPdf(fullHtml, { pdfOptions, headerFooter }, job = null) {
    const browser = await getBrowser();
    if (job?.aborted) throw new Error('Job aborted before rendering');
    const context = await browser.createBrowserContext();
    if (job) {
        if (job.aborted) {
            await context.close().catch(() => {});
            throw new Error('Job aborted before rendering');
        }
        job.context = context;
    }
    try {
        const page = await context.newPage();

        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (isAllowedRendererRequest(request.url(), { remoteFonts: ENABLE_REMOTE_FONTS })) {
                request.continue().catch(() => {});
                return;
            }
            logWarn(`Blocked renderer request to ${describeBlockedUrl(request.url())}`);
            request.abort('blockedbyclient').catch(() => {});
        });

        await page.emulateMediaType('print');

        await page.setContent(fullHtml, {
            waitUntil: 'load',
            timeout: CONFIG.PAGE_LOAD_TIMEOUT,
        });

        if (!headerFooter) {
            const pdfBuffer = await page.pdf({
                ...pdfOptions,
                displayHeaderFooter: false,
                headerTemplate: '<span></span>',
                footerTemplate: '<span></span>',
            });
            return Buffer.from(pdfBuffer);
        }

        const draftBuffer = await page.pdf({
            ...pdfOptions,
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate: '<span></span>',
        });
        const totalPagesText = String(await countPdfPages(draftBuffer));

        const pdfBuffer = await page.pdf({
            ...pdfOptions,
            displayHeaderFooter: true,
            headerTemplate: headerFooter.header(totalPagesText) || '<span></span>',
            footerTemplate: headerFooter.footer(totalPagesText) || '<span></span>',
        });
        return Buffer.from(pdfBuffer);
    } finally {
        if (job && job.context === context) job.context = null;
        try {
            await context.close();
        } catch { /* already closed */ }
    }
}

const PAGEBREAK_DIV = '<div class="pagebreak" style="break-after: page; page-break-after: always; clear: both;"></div>';

/**
 * Sanitize Document HTML for rendering: DOMPurify with `style` attributes kept, and
 * `<style>` text and `style` values run through the CSS sanitizer by the hooks above.
 * @param {unknown} html
 * @returns {string}
 */
export function sanitizeDocumentHtml(html, budget = null) {
    currentCssBudget = budget;
    try {
        return purify.sanitize(typeof html === 'string' ? html : '', {
            ADD_ATTR: ['style'],
            // A fragment that starts with <style> is parsed into <head>, which DOMPurify
            // discards. Force body parsing so a Document's leading <style> block survives.
            FORCE_BODY: true,
        });
    } finally {
        currentCssBudget = null;
    }
}

/**
 * Header and footer HTML. A `<style>` element here can make Chromium's print fail (an
 * `@import` inside a header template aborts `printToPDF`), so only `style` attributes are
 * allowed in these fragments.
 * @param {unknown} html
 * @param {CssBudget|null} [budget]
 * @returns {string}
 */
export function sanitizeHeaderFooterHtml(html, budget = null) {
    currentCssBudget = budget;
    try {
        return purify.sanitize(typeof html === 'string' ? html : '', {
            ADD_ATTR: ['style'],
            FORBID_TAGS: ['style'],
        });
    } finally {
        currentCssBudget = null;
    }
}

/**
 * Render one job. Returns `{ ok: true, pdf }`, `{ ok: false, status, message }` for a
 * refused request, or nothing when the job was aborted.
 */
async function producePdf(job) {
    const { htmlContent = '', cssStyles = '', printStyles: incomingPrintStyles = {} } = job.payload || {};
    const userId = job.userId;
    const refuse = (status, message) => ({ ok: false, status, message });

    if (!userId) {
        return refuse(401, 'Authentication required');
    }

    const requestBytes = (typeof htmlContent === 'string' ? htmlContent.length : 0)
        + (typeof cssStyles === 'string' ? cssStyles.length : 0)
        + JSON.stringify(incomingPrintStyles ?? {}).length;
    if (requestBytes > CONFIG.MAX_REQUEST_BYTES) {
        return refuse(413, 'Request too large');
    }
    const requestCssBytes = (typeof cssStyles === 'string' ? cssStyles.length : 0)
        + (typeof incomingPrintStyles?.customCSS === 'string' ? incomingPrintStyles.customCSS.length : 0);
    if ((typeof cssStyles === 'string' && cssStyles.length > CSS_LIMITS.stylesheetBytes)
        || (typeof incomingPrintStyles?.customCSS === 'string' && incomingPrintStyles.customCSS.length > CSS_LIMITS.stylesheetBytes)
        || requestCssBytes > CSS_LIMITS.requestBytes) {
        return refuse(413, 'CSS too large');
    }
    const budget = new CssBudget();

    const { styles: processedPrintStyles, invalid } = validatePrintStyles(incomingPrintStyles, DEFAULT_PRINT_STYLES);
    if (invalid.length > 0) {
        logWarn(`Print style values replaced by defaults: ${invalid.map(i => `${i.key} (${i.reason})`).join('; ')}`);
    }

    // Page-break markers become elements before sanitization, so they are sanitized like
    // everything else and can never land inside an attribute.
    const markedHtml = (typeof htmlContent === 'string' ? htmlContent : '')
        .replace(/\\pagebreak/g, PAGEBREAK_DIV)
        .replace(/<!--\s*pagebreak\s*-->/g, PAGEBREAK_DIV)
        .replace(/---\s*pagebreak\s*---/gi, PAGEBREAK_DIV);

    const cleanHtml = sanitizeDocumentHtml(markedHtml, budget);

    if (!cleanHtml) {
        return refuse(400, 'Invalid htmlContent');
    }

    if (processedPrintStyles.printHeaderHtml) {
        processedPrintStyles.printHeaderHtml = sanitizeHeaderFooterHtml(processedPrintStyles.printHeaderHtml, budget);
    }
    if (processedPrintStyles.printFooterHtml) {
        processedPrintStyles.printFooterHtml = sanitizeHeaderFooterHtml(processedPrintStyles.printFooterHtml, budget);
    }

    const requestCss = sanitizeStylesheet(cssStyles, budget);
    const cleanCss = requestCss.trim() ? requestCss : printStylesToCss(processedPrintStyles, budget);
    if (budget.exceeded) {
        logWarn(`CSS budget of ${CSS_LIMITS.requestBytes} bytes exceeded; some CSS was dropped`);
    }

    log('Embedding images in content...');
    const signal = job.abort.signal;
    const htmlWithPageBreaks = await embedImagesAsDataUri(cleanHtml, userId, { signal });
    if (job.aborted) return undefined;

    if (processedPrintStyles.printHeaderHtml) {
        processedPrintStyles.printHeaderHtml = await embedImagesAsDataUri(processedPrintStyles.printHeaderHtml, userId, { signal });
    }
    if (processedPrintStyles.printFooterHtml) {
        processedPrintStyles.printFooterHtml = await embedImagesAsDataUri(processedPrintStyles.printFooterHtml, userId, { signal });
    }

    if (job.aborted) return undefined;
    const fullHtml = buildHtmlDocument(htmlWithPageBreaks, cleanCss, processedPrintStyles);

    const needsHeaderFooter = Boolean(processedPrintStyles.printHeaderHtml || processedPrintStyles.printFooterHtml);

    const pdfOptions = {
        format: processedPrintStyles.pageSize || 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: needsHeaderFooter ? {
            top: processedPrintStyles.headerHeight,
            bottom: processedPrintStyles.footerHeight,
            left: processedPrintStyles.pageMargin,
            right: processedPrintStyles.pageMargin,
        } : undefined,
    };

    const headerFooter = needsHeaderFooter ? {
        header: (totalPagesText) => buildHeaderFooterTemplate(
            processedPrintStyles.printHeaderHtml,
            processedPrintStyles.headerAlign,
            processedPrintStyles.headerFontSize,
            processedPrintStyles.headerFontColor,
            processedPrintStyles.pageMargin,
            totalPagesText,
        ),
        footer: (totalPagesText) => buildHeaderFooterTemplate(
            processedPrintStyles.printFooterHtml,
            processedPrintStyles.footerAlign,
            processedPrintStyles.footerFontSize,
            processedPrintStyles.footerFontColor,
            processedPrintStyles.pageMargin,
            totalPagesText,
        ),
    } : null;

    const pdfBuffer = await renderHtmlToPdf(fullHtml, { pdfOptions, headerFooter }, job);

    // The job may have been abandoned by the deadline while rendering.
    if (job.aborted) return undefined;
    return { ok: true, pdf: pdfBuffer };
}
