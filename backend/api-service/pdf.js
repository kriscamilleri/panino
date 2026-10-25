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
} from './pdfSanitize.js';
import { fetchExternalImageAsDataUri } from './imageFetch.js';

export const pdfRoutes = express.Router();

const window = new JSDOM('').window;
const purify = DOMPurify(window);

// `<style>` elements and `style` attributes stay allowed in Document content, but their
// CSS goes through the same parser as the request stylesheet (defence in depth: a parsed
// `<style>` cannot close itself, and CSS can neither run code nor fetch after the request
// allow-list, but the output should match what the sanitizer would let through anyway).
purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style') {
        node.textContent = sanitizeStylesheet(node.textContent);
    }
});
purify.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'style') {
        data.attrValue = sanitizeDeclarations(data.attrValue);
    }
});

const CONFIG = {
    PAGE_LOAD_TIMEOUT: 10000,
};

/**
 * Queue and deadline settings. Exported so tests can tighten them; production reads the
 * environment once at startup.
 */
export const PDF_RUNTIME = {
    queueLimit: Number.parseInt(process.env.PDF_QUEUE_LIMIT, 10) || 20,
    jobTimeoutMs: Number.parseInt(process.env.PDF_JOB_TIMEOUT_MS, 10) || 45000,
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
function printStylesToCss(styleMap = {}) {
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
        const declarations = sanitizeDeclarations(s[key]);
        if (declarations) css += `${key} { ${declarations} }\n`;
    }

    if (s.customCSS) {
        css += `\n/* --- Custom CSS --- */\n${sanitizeStylesheet(s.customCSS)}\n`;
    }

    return css;
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

function getInternalImageAsDataUri(source, userId) {
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

        const buffer = fs.readFileSync(absolutePath);
        return `data:${image.mime_type};base64,${buffer.toString('base64')}`;
    } catch {
        return null;
    }
}

const IMAGE_PLACEHOLDER = '<!-- image unavailable -->';

/**
 * Replace every `<img src>` with a `data:` URI: internal images are read from storage,
 * external ones are fetched with the SSRF checks in imageFetch.js. An image that cannot
 * be embedded is replaced by a placeholder; the renderer would block its URL anyway, and
 * the placeholder keeps the output deterministic and the log accurate.
 */
async function embedImagesAsDataUri(html, userId) {
    const imgRegex = /<img([^>]*)\ssrc=["']([^"']+)["']([^>]*)>/gi;
    const images = [];
    let match;

    while ((match = imgRegex.exec(html)) !== null) {
        images.push({
            fullMatch: match[0],
            beforeSrc: match[1],
            src: match[2],
            afterSrc: match[3],
        });
    }

    if (images.length === 0) return html;

    log(`Processing ${images.length} images`);

    const replacements = await Promise.all(images.map(async (img, idx) => {
        const { fullMatch, beforeSrc, src, afterSrc } = img;

        if (src.startsWith('data:')) {
            return { original: fullMatch, replacement: fullMatch };
        }

        const internalMatch = parseInternalImageSource(src);
        if (internalMatch) {
            const dataUri = getInternalImageAsDataUri(src, userId);
            if (dataUri) {
                const sizeKB = Math.round(dataUri.length / 1024);
                log(`  Image ${idx + 1}: Internal ${internalMatch.imageId} converted (${sizeKB}KB)`);
                return { original: fullMatch, replacement: `<img${beforeSrc} src="${dataUri}"${afterSrc}>` };
            }
            log(`  Image ${idx + 1}: Internal lookup ${internalMatch.imageId} failed - falling back to external/cleanup`);
        }

        if (src.startsWith('http://') || src.startsWith('https://')) {
            const result = await fetchExternalImageAsDataUri(src);
            if (result.ok) {
                log(`  Image ${idx + 1}: External fetched (${Math.round(result.bytes / 1024)}KB)`);
                return { original: fullMatch, replacement: `<img${beforeSrc} src="${result.dataUri}"${afterSrc}>` };
            }
            const where = describeBlockedUrl(src);
            if (result.reason === 'blocked') {
                logWarn(`  Image ${idx + 1}: Blocked SSRF to ${where} - removing image`);
            } else {
                logWarn(`  Image ${idx + 1}: External fetch from ${where} failed (${result.detail}) - removing image`);
            }
            return { original: fullMatch, replacement: IMAGE_PLACEHOLDER };
        }

        log(`  Image ${idx + 1}: Unknown source type - removing image`);
        return { original: fullMatch, replacement: IMAGE_PLACEHOLDER };
    }));

    let result = html;
    for (const { original, replacement } of replacements) {
        // A function replacer: `$&`-style patterns inside the replacement are literal.
        result = result.replace(original, () => replacement);
    }

    return result;
}

// ============================================================================
// BROWSER MANAGEMENT
// ============================================================================

let browserInstance = null;

async function getBrowser() {
    if (!browserInstance || !browserInstance.connected) {
        log('Launching browser...');
        browserInstance = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
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
let activeContext = null;

async function closeActiveContext() {
    const context = activeContext;
    activeContext = null;
    if (!context) return;
    try {
        await context.close();
    } catch { /* already closed */ }
}

/**
 * Run one job under the deadline. On timeout the client gets a fixed 504 and the job's
 * browser context is closed so its pending render fails fast and the next job starts
 * clean. Errors never reach the client; they are logged here.
 */
async function runJob({ req, res }) {
    let timer;
    let timedOut = false;
    const deadline = new Promise(resolve => {
        timer = setTimeout(() => {
            timedOut = true;
            resolve('timeout');
        }, PDF_RUNTIME.jobTimeoutMs);
    });

    const work = generatePdf(req, res).then(
        () => 'done',
        (error) => {
            if (!timedOut) {
                logError('Generation failed:', error);
                if (!res.headersSent) res.status(500).send('PDF generation failed');
            }
            return 'failed';
        },
    );

    const outcome = await Promise.race([work, deadline]);
    clearTimeout(timer);
    if (outcome !== 'timeout') return;

    logError(`Job exceeded ${PDF_RUNTIME.jobTimeoutMs}ms; closing its browser context`);
    if (!res.headersSent) res.status(504).send('PDF generation timed out');
    await closeActiveContext();
    // Give the abandoned job a moment to settle before the next one starts.
    await Promise.race([work, new Promise(resolve => setTimeout(resolve, 5000))]);
}

async function processQueue() {
    if (isProcessing || queue.length === 0) return;

    isProcessing = true;
    const job = queue.shift();

    try {
        await runJob(job);
    } finally {
        isProcessing = false;
        job.resolve();
        if (queue.length > 0) setTimeout(processQueue, 50);
    }
}

pdfRoutes.post('/render-pdf', (req, res) => {
    if (queue.length >= PDF_RUNTIME.queueLimit) {
        logWarn(`Queue full (${queue.length}); rejecting request`);
        res.setHeader('Retry-After', String(PDF_RUNTIME.retryAfterSeconds));
        return res.status(503).send('PDF service busy, try again shortly');
    }
    return new Promise((resolve) => {
        queue.push({ req, res, resolve });
        processQueue();
    });
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
 * @returns {Promise<Buffer>}
 */
export async function renderHtmlToPdf(fullHtml, { pdfOptions, headerFooter }) {
    const browser = await getBrowser();
    const context = await browser.createBrowserContext();
    activeContext = context;
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
        if (activeContext === context) activeContext = null;
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
export function sanitizeDocumentHtml(html) {
    return purify.sanitize(typeof html === 'string' ? html : '', {
        ADD_ATTR: ['style'],
        // A fragment that starts with <style> is parsed into <head>, which DOMPurify
        // discards. Force body parsing so a Document's leading <style> block survives.
        FORCE_BODY: true,
    });
}

async function generatePdf(req, res) {
    const { htmlContent = '', cssStyles = '', printStyles: incomingPrintStyles = {} } = req.body || {};
    const userId = req.user?.user_id;

    if (!userId) {
        return res.status(401).send('Authentication required');
    }

    const { styles: processedPrintStyles, invalid } = validatePrintStyles(incomingPrintStyles, DEFAULT_PRINT_STYLES);
    if (invalid.length > 0) {
        logWarn(`Print style values replaced by defaults: ${invalid.map(i => `${i.key} (${i.reason})`).join('; ')}`);
    }

    const cleanHtml = sanitizeDocumentHtml(htmlContent);

    if (!cleanHtml) {
        return res.status(400).send('Invalid htmlContent');
    }

    if (processedPrintStyles.printHeaderHtml) {
        processedPrintStyles.printHeaderHtml = purify.sanitize(processedPrintStyles.printHeaderHtml);
    }
    if (processedPrintStyles.printFooterHtml) {
        processedPrintStyles.printFooterHtml = purify.sanitize(processedPrintStyles.printFooterHtml);
    }

    const requestCss = sanitizeStylesheet(cssStyles);
    const cleanCss = requestCss.trim() ? requestCss : printStylesToCss(processedPrintStyles);

    log('Embedding images in content...');
    const htmlWithImages = await embedImagesAsDataUri(cleanHtml, userId);

    const htmlWithPageBreaks = htmlWithImages
        .replace(/\\pagebreak/g, PAGEBREAK_DIV)
        .replace(/<!--\s*pagebreak\s*-->/g, PAGEBREAK_DIV)
        .replace(/---\s*pagebreak\s*---/gi, PAGEBREAK_DIV);

    if (processedPrintStyles.printHeaderHtml) {
        processedPrintStyles.printHeaderHtml = await embedImagesAsDataUri(processedPrintStyles.printHeaderHtml, userId);
    }
    if (processedPrintStyles.printFooterHtml) {
        processedPrintStyles.printFooterHtml = await embedImagesAsDataUri(processedPrintStyles.printFooterHtml, userId);
    }

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

    const pdfBuffer = await renderHtmlToPdf(fullHtml, { pdfOptions, headerFooter });

    // The job may have been abandoned by the deadline while rendering.
    if (res.headersSent) return;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=document.pdf');
    res.send(pdfBuffer);
}
