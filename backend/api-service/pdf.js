// /backend/api-service/pdf.js
/**
 * ============================================================================
 * PDF GENERATION SERVICE
 * ============================================================================
 * 
 * Converts HTML/CSS content to PDF using Puppeteer + Paged.js for pagination.
 * 
 * FLOW:
 * 1. POST /render-pdf with { htmlContent, cssStyles, printStyles }
 * 2. Sanitize HTML/CSS, embed all images as base64 data URIs
 * 3. Build full HTML document with @page CSS rules
 * 4. Load in Puppeteer, run Paged.js for pagination
 * 5. Inject header/footer overlays on each page
 * 6. Generate PDF via page.pdf()
 * 
 * KEY DESIGN DECISIONS:
 * - Images are pre-embedded as base64 because Puppeteer can't fetch from localhost
 * - Single browser instance reused across requests (launching Chrome is slow)
 * - Sequential request processing to avoid memory issues
 * - Paged.js handles complex pagination (@page rules, page breaks, etc.)
 * - Headers/footers injected as DOM overlays after Paged.js runs
 * 
 * ============================================================================
 */

import express from 'express';
import puppeteer from 'puppeteer';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getUserDb } from './db.js';

export const pdfRoutes = express.Router();

const window = new JSDOM('').window;
const purify = DOMPurify(window);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Configuration
const CONFIG = {
    EXTERNAL_IMAGE_TIMEOUT: 5000,   // Timeout for fetching external images
    PAGED_JS_TIMEOUT: 60000,        // Timeout for Paged.js rendering (60s for slower servers)
    PAGE_LOAD_TIMEOUT: 30000,       // Timeout for initial page load
    MAX_EXTERNAL_IMAGE_SIZE: 2000,  // Max size in KB for external images
};

// Simple logging helper
const log = (message, ...args) => console.log(`[PDF] ${message}`, ...args);
const logWarn = (message, ...args) => console.warn(`[PDF] ${message}`, ...args);
const logError = (message, ...args) => console.error(`[PDF] ${message}`, ...args);

// ============================================================================
// IMAGE EMBEDDING
// ============================================================================

/**
 * Converts an internal image (stored on disk) to a base64 data URI.
 */
function getInternalImageAsDataUri(imageId, userId) {
    try {
        const db = getUserDb(userId);
        const image = db.prepare('SELECT mime_type, path FROM images WHERE id = ? AND user_id = ?').get(imageId, userId);

        if (!image?.path) return null;

        const absolutePath = path.join(UPLOADS_DIR, image.path);
        if (!absolutePath.startsWith(UPLOADS_DIR) || !fs.existsSync(absolutePath)) return null;

        const buffer = fs.readFileSync(absolutePath);
        return `data:${image.mime_type};base64,${buffer.toString('base64')}`;
    } catch {
        return null;
    }
}

/**
 * Fetches an external image URL and converts to base64 data URI.
 */
async function fetchExternalImageAsDataUri(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.EXTERNAL_IMAGE_TIMEOUT);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PaninoPDF/1.0)' },
        });
        clearTimeout(timeoutId);

        if (!response.ok) return null;

        const contentType = response.headers.get('content-type') || 'image/png';
        if (!contentType.startsWith('image/')) return null;

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length / 1024 > CONFIG.MAX_EXTERNAL_IMAGE_SIZE) return null;

        return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch {
        return null;
    }
}

/**
 * Embeds all images in HTML as base64 data URIs.
 * - Internal images (/images/UUID or /api/images/UUID) are read from disk
 * - External images (https://...) are fetched
 * - Failed images are removed to prevent rendering errors
 */
async function embedImagesAsDataUri(html, userId) {
    // Collect all image sources
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

    // Process each image
    const replacements = await Promise.all(images.map(async (img, idx) => {
        const { fullMatch, beforeSrc, src, afterSrc } = img;

        // Skip already-embedded images
        if (src.startsWith('data:')) {
            log(`  Image ${idx + 1}: Already embedded, skipping`);
            return { original: fullMatch, replacement: fullMatch };
        }

        // Check if it's an internal image
        const internalMatch = src.match(/\/(?:api\/)?images\/([a-f0-9-]+)/i);
        if (internalMatch) {
            const dataUri = getInternalImageAsDataUri(internalMatch[1], userId);
            if (dataUri) {
                const sizeKB = Math.round(dataUri.length / 1024);
                log(`  Image ${idx + 1}: Internal ${internalMatch[1]} converted (${sizeKB}KB)`);
                return { original: fullMatch, replacement: `<img${beforeSrc} src="${dataUri}"${afterSrc}>` };
            }
            log(`  Image ${idx + 1}: Internal ${internalMatch[1]} FAILED - removing`);
            return { original: fullMatch, replacement: `<!-- Image removed: ${internalMatch[1]} -->` };
        }

        // External image
        if (src.startsWith('http://') || src.startsWith('https://')) {
            const dataUri = await fetchExternalImageAsDataUri(src);
            if (dataUri) {
                const sizeKB = Math.round(dataUri.length / 1024);
                log(`  Image ${idx + 1}: External fetched (${sizeKB}KB)`);
                return { original: fullMatch, replacement: `<img${beforeSrc} src="${dataUri}"${afterSrc}>` };
            }
            log(`  Image ${idx + 1}: External ${src.substring(0, 50)} FAILED - removing`);
            return { original: fullMatch, replacement: `<!-- External image removed -->` };
        }

        // Unknown source type, keep as-is
        log(`  Image ${idx + 1}: Unknown source type, keeping: ${src.substring(0, 50)}`);
        return { original: fullMatch, replacement: fullMatch };
    }));

    // Apply replacements
    let result = html;
    for (const { original, replacement } of replacements) {
        result = result.replace(original, replacement);
    }

    // Check for any remaining non-data-URI images
    const remainingImages = result.match(/<img[^>]*src=["'](?!data:)[^"']+["'][^>]*>/gi) || [];
    if (remainingImages.length > 0) {
        logWarn(`${remainingImages.length} images still have external URLs after processing`);
    }

    return result;
}

// ============================================================================
// BROWSER MANAGEMENT
// ============================================================================

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

// ============================================================================
// REQUEST QUEUE (sequential processing)
// ============================================================================

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

// ============================================================================
// PDF GENERATION
// ============================================================================

/**
 * Maps alignment value to CSS flexbox justify-content.
 */
function toFlexAlign(align) {
    const map = { left: 'flex-start', right: 'flex-end', center: 'center' };
    return map[(align || 'center').toLowerCase()] || 'center';
}

/**
 * Builds the complete HTML document for PDF rendering.
 */
function buildHtmlDocument(content, css, printStyles) {
    const {
        pageSize = 'A4',
        pageMargin = '2cm',
        headerHeight = '1.5cm',
        footerHeight = '1.5cm',
        googleFontFamily = '',
    } = printStyles;

    // Build Google Fonts link if specified
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

/**
 * Runs Paged.js inside the page to handle pagination.
 * Uses the non-polyfill version so we can control when it runs.
 */
async function runPagedJs(page) {
    try {
        // Add console listener for debugging
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[Paged') || text.includes('paged')) {
                log('[Page]', text);
            }
        });

        page.on('pageerror', err => {
            logError('[PageError]', err.message);
        });

        // Use the polyfill version but disable auto-run via config
        // This ensures we have all handlers and polyfills loaded
        await page.evaluate(() => {
            window.PagedConfig = { auto: false };
        });

        const pagedJsUrl = 'https://unpkg.com/pagedjs/dist/paged.polyfill.js';
        await page.addScriptTag({ url: pagedJsUrl, timeout: 10000 });
        
        // Wait a bit for script to initialize
        await new Promise(r => setTimeout(r, 500));

        const success = await page.evaluate((timeout) => {
            return new Promise((resolve) => {
                // Check if Paged is loaded
                if (!window.Paged?.Previewer) {
                    console.log('[Paged.js] Library not loaded');
                    console.log('[Paged.js] window.Paged keys:', window.Paged ? Object.keys(window.Paged) : 'undefined');
                    resolve(false);
                    return;
                }

                const timer = setTimeout(() => {
                    const pages = document.querySelectorAll('.pagedjs_page');
                    console.log('[Paged.js] Timeout reached with', pages.length, 'pages created so far');
                    resolve(pages.length > 0);
                }, timeout);

                // Wait for images to load first
                const waitForImages = () => {
                    const images = document.querySelectorAll('img');
                    console.log('[Paged.js] Waiting for', images.length, 'images...');
                    
                    return Promise.all(Array.from(images).map((img, idx) => {
                        if (img.complete && img.naturalWidth > 0) {
                            return Promise.resolve();
                        }
                        return new Promise(res => {
                            const imgTimeout = setTimeout(res, 3000);
                            img.onload = () => { clearTimeout(imgTimeout); res(); };
                            img.onerror = () => { clearTimeout(imgTimeout); res(); };
                        });
                    }));
                };

                try {
                    waitForImages().then(() => {
                        console.log('[Paged.js] Images ready, starting pagination...');
                        
                        const paged = new window.Paged.Previewer();
                        const content = document.body.innerHTML;
                        document.body.innerHTML = '';

                        paged.preview(content, [], document.body)
                            .then(() => {
                                clearTimeout(timer);
                                const pages = document.querySelectorAll('.pagedjs_page');
                                console.log('[Paged.js] Completed with', pages.length, 'pages');
                                resolve(true);
                            })
                            .catch((err) => {
                                clearTimeout(timer);
                                console.error('[Paged.js] Error:', err?.message || err);
                                resolve(false);
                            });
                    });
                } catch (e) {
                    clearTimeout(timer);
                    console.error('[Paged.js] Exception:', e?.message || e);
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

/**
 * Injects header and footer overlays on each page.
 */
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

            // Check visibility rules
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

        // If no pages (Paged.js didn't run), add to body
        if (pages.length === 0) {
            document.body.style.position = 'relative';
            const header = createOverlay('header', 1);
            const footer = createOverlay('footer', 1);
            if (header) document.body.appendChild(header);
            if (footer) document.body.appendChild(footer);
            return;
        }

        // Add overlays to each page - append to the pagebox, not the page itself
        pages.forEach((pageEl, i) => {
            // Skip if we've already added overlays to this page
            if (pageEl.querySelector('._pdf-header') || pageEl.querySelector('._pdf-footer')) {
                return;
            }
            
            // Find the pagebox within the page for better positioning
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

/**
 * Main PDF generation function.
 */
async function generatePdf(req, res) {
    const { htmlContent, cssStyles, printStyles = {} } = req.body;
    const userId = req.user?.user_id;

    if (!userId) {
        return res.status(401).send('Authentication required');
    }

    // Sanitize inputs
    const cleanHtml = purify.sanitize(htmlContent);
    const cleanCss = purify.sanitize(cssStyles, { ALLOWED_TAGS: ['style'], ALLOWED_ATTR: [] });

    if (!cleanHtml || !cleanCss) {
        return res.status(400).send('Invalid htmlContent or cssStyles');
    }

    // Debug: Check for images in raw HTML before embedding
    const rawImgCount = (cleanHtml.match(/<img/gi) || []).length;
    log(`Raw HTML: ${cleanHtml.length} chars, ${rawImgCount} img tags`);

    // Embed images
    log('Embedding images...');
    const htmlWithImages = await embedImagesAsDataUri(cleanHtml, userId);

    // Build document
    const fullHtml = buildHtmlDocument(htmlWithImages, cleanCss, printStyles);

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

        // Run Paged.js for pagination
        const pagedSuccess = await runPagedJs(page);

        // Inject headers/footers
        if (printStyles.printHeaderHtml || printStyles.printFooterHtml) {
            await injectHeadersFooters(page, printStyles);
        }

        // Generate PDF
        const pdfBuffer = await page.pdf({
            format: printStyles.pageSize || 'A4',
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
            } catch { /* ignore */ }
        }
    }
}
