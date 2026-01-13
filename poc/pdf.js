import express from 'express';
import puppeteer from 'puppeteer';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import path from 'path';
import fs from 'fs';
import { promises as dns } from 'dns';
import { fileURLToPath } from 'url';
import mime from 'mime-types';
import { loadDefaultPrintStyles, printStylesToCss } from './style-utils.js';

export const pdfRoutes = express.Router();

const window = new JSDOM('').window;
const purify = DOMPurify(window);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PAGED_JS_PATHS = [
    path.join(__dirname, 'lib', 'paged.polyfill.js'),
    path.join(__dirname, '..', 'backend', 'api-service', 'lib', 'paged.polyfill.js'),
];

const CONFIG = {
    EXTERNAL_IMAGE_TIMEOUT: 10000,
    PAGED_JS_TIMEOUT: 120000,
    PAGE_LOAD_TIMEOUT: 60000,
    MAX_EXTERNAL_IMAGE_SIZE: 5000,
};

const DEFAULT_PRINT_STYLES = loadDefaultPrintStyles();

const log = (message, ...args) => console.log(`[PDF] ${message}`, ...args);
const logWarn = (message, ...args) => console.warn(`[PDF] ${message}`, ...args);
const logError = (message, ...args) => console.error(`[PDF] ${message}`, ...args);

function isPrivateIp(ip) {
    if (ip.includes(':')) {
        const normalized = ip.toLowerCase();
        if (normalized === '::1') return true;
        if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
        if (normalized.startsWith('fe80')) return true;
        return false;
    }

    const parts = ip.split('.');
    if (parts.length !== 4) return false;

    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);

    if (first === 0) return true;
    if (first === 127) return true;
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 169 && second === 254) return true;

    return false;
}

function findUploadCandidate(imageId) {
    try {
        if (!fs.existsSync(UPLOADS_DIR)) return null;
        const entries = fs.readdirSync(UPLOADS_DIR);
        const hit = entries.find(name => name.startsWith(imageId));
        if (!hit) return null;
        const candidate = path.join(UPLOADS_DIR, hit);
        if (!candidate.startsWith(UPLOADS_DIR)) return null;
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) return null;
        return candidate;
    } catch {
        return null;
    }
}

function getInternalImageAsDataUri(imageId) {
    try {
        if (!imageId) return null;
        const directPath = path.join(UPLOADS_DIR, imageId);
        const directExists = directPath.startsWith(UPLOADS_DIR) && fs.existsSync(directPath) && fs.statSync(directPath).isFile();
        const filePath = directExists ? directPath : findUploadCandidate(imageId);
        if (!filePath) return null;

        const buffer = fs.readFileSync(filePath);
        const mimeType = mime.lookup(filePath) || 'application/octet-stream';
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } catch (err) {
        logWarn(`Internal image lookup failed for ${imageId}: ${err.message}`);
        return null;
    }
}

async function fetchExternalImageAsDataUri(urlStr) {
    try {
        const urlObj = new URL(urlStr);

        try {
            const { address } = await dns.lookup(urlObj.hostname);

            if (isPrivateIp(address)) {
                logWarn(`Blocked SSRF attempt to ${urlObj.hostname} (${address})`);
                throw new Error('SSRF_BLOCKED');
            }
        } catch (e) {
            if (e.message === 'SSRF_BLOCKED') throw e;
            logWarn(`DNS lookup failed for ${urlObj.hostname}: ${e.message}`);
            return null;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.EXTERNAL_IMAGE_TIMEOUT);

        let response;
        try {
            response = await fetch(urlStr, {
                signal: controller.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaninoPDF/1.0)' },
            });
        } catch (err) {
            logWarn(`Fetch failed for ${urlStr}: ${err.message}`);
            return null;
        } finally {
            clearTimeout(timeoutId);
        }

        if (!response.ok) {
            logWarn(`Failed to fetch ${urlStr}: ${response.status} ${response.statusText}`);
            return null;
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        if (!contentType.startsWith('image/')) {
            logWarn(`Invalid content type for ${urlStr}: ${contentType}`);
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length / 1024 > CONFIG.MAX_EXTERNAL_IMAGE_SIZE) {
            logWarn(`Image too large: ${urlStr} (${Math.round(buffer.length / 1024)}KB)`);
            return null;
        }

        return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (error) {
        if (error.message === 'SSRF_BLOCKED') throw error;
        return null;
    }
}

async function embedImagesAsDataUri(html) {
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
    images.forEach((img, i) => {
        const displaySrc = img.src.startsWith('data:')
            ? `${img.src.substring(0, 40)}... (data URI)`
            : img.src.substring(0, 100);
        log(`  Image ${i + 1}: ${displaySrc}`);
    });

    const replacements = await Promise.all(images.map(async (img, idx) => {
        const { fullMatch, beforeSrc, src, afterSrc } = img;

        if (src.startsWith('data:')) {
            log(`  Image ${idx + 1}: Already embedded, skipping`);
            return { original: fullMatch, replacement: fullMatch };
        }

        const internalMatch = src.match(/\/(?:api\/)?images\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i) ||
            src.match(/\/(?:api\/)?images\/([a-f0-9-]{32,})/i);
        if (internalMatch) {
            const dataUri = getInternalImageAsDataUri(internalMatch[1]);
            if (dataUri) {
                const sizeKB = Math.round(dataUri.length / 1024);
                log(`  Image ${idx + 1}: Internal ${internalMatch[1]} converted (${sizeKB}KB)`);
                return { original: fullMatch, replacement: `<img${beforeSrc} src="${dataUri}"${afterSrc}>` };
            }
            log(`  Image ${idx + 1}: Internal lookup ${internalMatch[1]} failed - falling back to external/cleanup`);
        }

        if (src.startsWith('http://') || src.startsWith('https://')) {
            try {
                const dataUri = await fetchExternalImageAsDataUri(src);
                if (dataUri) {
                    const sizeKB = Math.round(dataUri.length / 1024);
                    log(`  Image ${idx + 1}: External fetched (${sizeKB}KB)`);
                    return { original: fullMatch, replacement: `<img${beforeSrc} src="${dataUri}"${afterSrc}>` };
                }
                log(`  Image ${idx + 1}: External ${src.substring(0, 50)} FAILED - keeping original`);
                return { original: fullMatch, replacement: fullMatch };
            } catch (err) {
                if (err.message === 'SSRF_BLOCKED') {
                    logWarn(`  Image ${idx + 1}: Blocked SSRF - removing image`);
                    return { original: fullMatch, replacement: '<!-- Blocked Image -->' };
                }
                log(`  Image ${idx + 1}: External error - keeping original. ${err.message}`);
                return { original: fullMatch, replacement: fullMatch };
            }
        }

        log(`  Image ${idx + 1}: Unknown source type, keeping: ${src.substring(0, 50)}`);
        return { original: fullMatch, replacement: fullMatch };
    }));

    let result = html;
    for (const { original, replacement } of replacements) {
        result = result.replace(original, replacement);
    }

    const remainingImages = result.match(/<img[^>]*src=["'](?!data:)[^"']+["'][^>]*>/gi) || [];
    if (remainingImages.length > 0) {
        logWarn(`${remainingImages.length} images still have external URLs after processing`);
    }

    return result;
}

let browserInstance = null;

async function getBrowser() {
    if (!browserInstance || !browserInstance.isConnected()) {
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

let isProcessing = false;
const queue = [];

async function processQueue() {
    if (isProcessing || queue.length === 0) return;

    isProcessing = true;
    const { req, res, resolve } = queue.shift();

    try {
        await generatePdf(req, res);
    } catch (error) {
        logError('Generation failed:', error.message);
        if (!res.headersSent) {
            res.status(500).send(`PDF generation failed: ${error.message}`);
        }
    } finally {
        isProcessing = false;
        resolve();
        if (queue.length > 0) setTimeout(processQueue, 50);
    }
}

pdfRoutes.post('/render-pdf', (req, res) => {
    return new Promise((resolve) => {
        queue.push({ req, res, resolve });
        processQueue();
    });
});

function toFlexAlign(align) {
    const map = { left: 'flex-start', right: 'flex-end', center: 'center' };
    return map[(align || 'center').toLowerCase()] || 'center';
}

function buildHtmlDocument(content, css, printStyles) {
    const {
        pageSize = 'A4',
        pageMargin = '2cm',
        headerHeight = '1.5cm',
        footerHeight = '1.5cm',
        googleFontFamily = '',
    } = printStyles;

    let fontsLink = '';
    if (googleFontFamily) {
        const families = googleFontFamily
            .split(',')
            .map(f => `family=${encodeURIComponent(f.trim())}:wght@400;600;700`)
            .join('&');
        fontsLink = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">`;
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
        ._pdf-header, ._pdf-footer {
            position: absolute;
            left: 0;
            right: 0;
            display: flex;
            align-items: center;
            pointer-events: none;
            z-index: 999999;
        }
    </style>
</head>
<body>${content}</body>
</html>`;
}

async function runPagedJs(page) {
    try {
        page.on('console', msg => {
            const text = msg.text();
            log('[PageConsole]', text);
        });

        page.on('pageerror', err => {
            logError('[PageError]', err.message);
        });

        await page.evaluate(() => {
            window.PagedConfig = { auto: false };
        });

        const localPagedPath = PAGED_JS_PATHS.find(candidate => fs.existsSync(candidate));

        if (localPagedPath) {
            log(`Using local Paged.js from: ${localPagedPath}`);
            await page.addScriptTag({ path: localPagedPath });
        } else {
            const pagedJsUrl = 'https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js';
            logWarn(`Local Paged.js not found, falling back to CDN: ${pagedJsUrl}`);
            await page.addScriptTag({ url: pagedJsUrl, timeout: 20000 });
        }

        await new Promise(r => setTimeout(r, 500));

        log('Starting Paged.js polyfill preview...');

        const success = await page.evaluate((timeout) => {
            return new Promise(async (resolve) => {
                try {
                    if (!window.PagedPolyfill || !window.PagedPolyfill.preview) {
                        console.log('[Paged.js] PagedPolyfill not found, falling back to Paged.Previewer');

                        if (!window.Paged?.Previewer) {
                            console.log('[Paged.js] Library not loaded');
                            resolve(false);
                            return;
                        }

                        const paged = new window.Paged.Previewer();
                        const content = document.body.innerHTML;
                        document.body.innerHTML = '';

                        await paged.preview(content, [], document.body);
                        const pages = document.querySelectorAll('.pagedjs_page');
                        console.log(`[Paged.js] Previewer created ${pages.length} pages`);
                        resolve(pages.length > 0);
                        return;
                    }

                    console.log('[Paged.js] Using PagedPolyfill.preview()');
                    await window.PagedPolyfill.preview();

                    const pages = document.querySelectorAll('.pagedjs_page');
                    console.log(`[Paged.js] Completed with ${pages.length} pages`);
                    resolve(pages.length > 0);

                } catch (err) {
                    console.error('[Paged.js] Error:', err.message || err);
                    resolve(false);
                }
            });
        }, CONFIG.PAGED_JS_TIMEOUT);

        return success;
    } catch (err) {
        logWarn('Paged.js error:', err.message);
        return false;
    }
}

async function injectHeadersFooters(page, printStyles) {
    const {
        printHeaderHtml = '',
        printFooterHtml = '',
        headerFontSize = '10',
        headerFontColor = '#666666',
        headerAlign = 'center',
        footerFontSize = '10',
        footerFontColor = '#666666',
        footerAlign = 'center',
        hideHeaderOnFirst = false,
        hideFooterOnFirst = false,
        hideHeaderOnLast = false,
        hideFooterOnLast = false,
        headerHeight = '1.5cm',
        footerHeight = '1.5cm',
        headerOffset = '0cm',
        footerOffset = '0cm',
    } = printStyles;

    await page.evaluate((config) => {
        const pages = document.querySelectorAll('.pagedjs_page:not(.pagedjs_blank)');
        const total = Math.max(1, pages.length);

        function createOverlay(type, pageNum) {
            const isHeader = type === 'header';
            const html = isHeader ? config.headerHtml : config.footerHtml;
            if (!html) return null;

            if (isHeader) {
                if (pageNum === 1 && config.hideHeaderOnFirst) return null;
                if (pageNum === total && config.hideHeaderOnLast) return null;
            } else {
                if (pageNum === 1 && config.hideFooterOnFirst) return null;
                if (pageNum === total && config.hideFooterOnLast) return null;
            }

            const el = document.createElement('div');
            el.className = isHeader ? '_pdf-header' : '_pdf-footer';
            el.innerHTML = html.replace(/%p/g, pageNum).replace(/%P/g, total);

            el.style.cssText = `
                position: absolute;
                left: 0;
                right: 0;
                display: flex;
                align-items: center;
                justify-content: ${isHeader ? config.headerJustify : config.footerJustify};
                font-size: ${isHeader ? config.headerFontSize : config.footerFontSize}px;
                color: ${isHeader ? config.headerColor : config.footerColor};
                height: ${isHeader ? config.headerHeight : config.footerHeight};
                ${isHeader ? 'top' : 'bottom'}: 0;
                transform: translateY(${isHeader ? '-' + config.headerOffset : config.footerOffset});
                z-index: 999999;
                pointer-events: none;
            `;

            return el;
        }

        if (pages.length === 0) {
            document.body.style.position = 'relative';
            const header = createOverlay('header', 1);
            const footer = createOverlay('footer', 1);
            if (header) document.body.appendChild(header);
            if (footer) document.body.appendChild(footer);
            return;
        }

        pages.forEach((pageEl, i) => {
            if (pageEl.querySelector('._pdf-header') || pageEl.querySelector('._pdf-footer')) {
                return;
            }

            const pagebox = pageEl.querySelector('.pagedjs_pagebox') || pageEl;
            pagebox.style.position = 'relative';

            const header = createOverlay('header', i + 1);
            const footer = createOverlay('footer', i + 1);
            if (header) pagebox.appendChild(header);
            if (footer) pagebox.appendChild(footer);
        });
    }, {
        headerHtml: printHeaderHtml,
        footerHtml: printFooterHtml,
        headerFontSize: parseInt(headerFontSize, 10),
        headerColor: headerFontColor,
        headerJustify: toFlexAlign(headerAlign),
        footerFontSize: parseInt(footerFontSize, 10),
        footerColor: footerFontColor,
        footerJustify: toFlexAlign(footerAlign),
        hideHeaderOnFirst,
        hideFooterOnFirst,
        hideHeaderOnLast,
        hideFooterOnLast,
        headerHeight,
        footerHeight,
        headerOffset: headerOffset.replace(/^\+/, ''),
        footerOffset: footerOffset.replace(/^\+/, ''),
    });
}

async function generatePdf(req, res) {
    const { htmlContent = '', cssStyles = '', printStyles: incomingPrintStyles = {} } = req.body || {};

    const mergedPrintStyles = { ...DEFAULT_PRINT_STYLES, ...incomingPrintStyles };

    const cleanHtml = purify.sanitize(htmlContent, {
        ADD_ATTR: ['style'],
    });

    if (htmlContent.includes('break-after') || htmlContent.includes('pagebreak')) {
        log('Input HTML contains pagebreak markers');
        log('Sample: ' + htmlContent.substring(0, 500));
    }
    if (cleanHtml.includes('break-after') || cleanHtml.includes('pagebreak')) {
        log('Sanitized HTML contains pagebreak markers');
    } else if (htmlContent.includes('break-after') || htmlContent.includes('pagebreak')) {
        logWarn('Pagebreak markers were STRIPPED by DOMPurify!');
    }

    if (mergedPrintStyles.printHeaderHtml) {
        mergedPrintStyles.printHeaderHtml = purify.sanitize(mergedPrintStyles.printHeaderHtml);
    }
    if (mergedPrintStyles.printFooterHtml) {
        mergedPrintStyles.printFooterHtml = purify.sanitize(mergedPrintStyles.printFooterHtml);
    }

    const cleanCssInput = (cssStyles || '').replace(/<\/style>/gi, '');
    const cleanCss = cleanCssInput.trim() ? cleanCssInput : printStylesToCss(mergedPrintStyles);

    if (!cleanHtml) {
        return res.status(400).send('Invalid htmlContent');
    }

    log('Embedding images in content...');
    const htmlWithImages = await embedImagesAsDataUri(cleanHtml);

    const htmlWithPageBreaks = htmlWithImages
        .replace(/\\pagebreak/g, '<div class="pagebreak" style="break-after: page; page-break-after: always; clear: both;"></div>')
        .replace(/<!--\s*pagebreak\s*-->/g, '<div class="pagebreak" style="break-after: page; page-break-after: always; clear: both;"></div>')
        .replace(/---\s*pagebreak\s*---/gi, '<div class="pagebreak" style="break-after: page; page-break-after: always; clear: both;"></div>');

    const processedPrintStyles = { ...mergedPrintStyles };
    if (processedPrintStyles.printHeaderHtml) {
        log('Embedding images in header...');
        processedPrintStyles.printHeaderHtml = await embedImagesAsDataUri(processedPrintStyles.printHeaderHtml);
    }
    if (processedPrintStyles.printFooterHtml) {
        log('Embedding images in footer...');
        processedPrintStyles.printFooterHtml = await embedImagesAsDataUri(processedPrintStyles.printFooterHtml);
    }

    const fullHtml = buildHtmlDocument(htmlWithPageBreaks, cleanCss, processedPrintStyles);

    let context = null;

    try {
        const browser = await getBrowser();
        context = await browser.createBrowserContext();
        const page = await context.newPage();

        await page.emulateMediaType('print');

        await page.setContent(fullHtml, {
            waitUntil: 'load',
            timeout: CONFIG.PAGE_LOAD_TIMEOUT,
        });

        await runPagedJs(page);

        if (processedPrintStyles.printHeaderHtml || processedPrintStyles.printFooterHtml) {
            await injectHeadersFooters(page, processedPrintStyles);
        }

        const pdfBuffer = await page.pdf({
            format: processedPrintStyles.pageSize || 'A4',
            printBackground: true,
            preferCSSPageSize: true,
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=document.pdf');
        res.send(pdfBuffer);

    } finally {
        if (context) {
            try {
                await context.close();
            } catch {
                // ignore
            }
        }
    }
}

