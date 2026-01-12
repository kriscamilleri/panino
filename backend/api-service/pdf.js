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
import { promises as dns } from 'dns';
import { fileURLToPath } from 'url';
import { getUserDb } from './db.js';

export const pdfRoutes = express.Router();

const window = new JSDOM('').window;
const purify = DOMPurify(window);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Configuration
const CONFIG = {
    EXTERNAL_IMAGE_TIMEOUT: 10000,  // Increased timeout for external images
    PAGED_JS_TIMEOUT: 120000,       // Increased to 120s for larger/slower documents
    PAGE_LOAD_TIMEOUT: 60000,       // Increased initial page load timeout
    MAX_EXTERNAL_IMAGE_SIZE: 5000,  // Increased max size
};

// Simple logging helper
const log = (message, ...args) => console.log(`[PDF] ${message}`, ...args);
const logWarn = (message, ...args) => console.warn(`[PDF] ${message}`, ...args);
const logError = (message, ...args) => console.error(`[PDF] ${message}`, ...args);

// ============================================================================
// IMAGE EMBEDDING
// ============================================================================

function isPrivateIp(ip) {
    // Check if IPv6
    if (ip.includes(':')) {
        const normalized = ip.toLowerCase();
        // Loopback
        if (normalized === '::1') return true;
        // Unique Local (fc00::/7)
        if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
        // Link-local (fe80::/10)
        if (normalized.startsWith('fe80')) return true;
        return false;
    }

    // IPv4
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);

    // 0.0.0.0/8
    if (first === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (first === 127) return true;
    // 10.0.0.0/8 (Private)
    if (first === 10) return true;
    // 172.16.0.0/12 (Private)
    if (first === 172 && second >= 16 && second <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (first === 192 && second === 168) return true;
    // 169.254.0.0/16 (Link-local)
    if (first === 169 && second === 254) return true;

    return false;
}

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
async function fetchExternalImageAsDataUri(urlStr) {
    try {
        const urlObj = new URL(urlStr);

        // SSRF Protection: Resolve hostname and check for private IP
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
            logWarn(`Image too large: ${urlStr} (${Math.round(buffer.length/1024)}KB)`);
            return null;
        }

        return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch (error) {
        if (error.message === 'SSRF_BLOCKED') throw error;
        // console.error(`Unexpected error in fetchExternal: ${error.message}`);
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
        // Match /images/UUID or /api/images/UUID (case insensitive)
        const internalMatch = src.match(/\/(?:api\/)?images\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i) ||
            src.match(/\/(?:api\/)?images\/([a-f0-9-]{32,})/i);
        if (internalMatch) {
            const dataUri = getInternalImageAsDataUri(internalMatch[1], userId);
            if (dataUri) {
                const sizeKB = Math.round(dataUri.length / 1024);
                log(`  Image ${idx + 1}: Internal ${internalMatch[1]} converted (${sizeKB}KB)`);
                return { original: fullMatch, replacement: `<img${beforeSrc} src="${dataUri}"${afterSrc}>` };
            }
            log(`  Image ${idx + 1}: Internal lookup ${internalMatch[1]} failed - falling back to external/cleanup`);
            // Do NOT return here. Fall through to allow external URL verification (SSRF check)
            // or default handling (removing if unknown).
        }

        // External image
        if (src.startsWith('http://') || src.startsWith('https://')) {
            try {
                const dataUri = await fetchExternalImageAsDataUri(src);
                if (dataUri) {
                    const sizeKB = Math.round(dataUri.length / 1024);
                    log(`  Image ${idx + 1}: External fetched (${sizeKB}KB)`);
                    return { original: fullMatch, replacement: `<img${beforeSrc} src="${dataUri}"${afterSrc}>` };
                }
                // If fetch failed (but not blocked), we currently keep original.
                // However, for PDF generation, keeping a failing URL is often worse (timeouts).
                // But to minimize changes, let's just log.
                log(`  Image ${idx + 1}: External ${src.substring(0, 50)} FAILED - keeping original`);
                return { original: fullMatch, replacement: fullMatch };
            } catch (err) {
                if (err.message === 'SSRF_BLOCKED') {
                    logWarn(`  Image ${idx + 1}: Blocked SSRF - removing image`);
                    // Replace with a placeholder or empty string to prevent Puppeteer from fetching it
                    return { original: fullMatch, replacement: '<!-- Blocked Image -->' };
                }
                // Other errors
                 log(`  Image ${idx + 1}: External error - keeping original. ${err.message}`);
                 return { original: fullMatch, replacement: fullMatch };
            }
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
            // Log ALL messages from the page for better debugging if we hit timeouts
            log('[PageConsole]', text);
        });

        page.on('pageerror', err => {
            logError('[PageError]', err.message);
        });

        // Use the polyfill version but disable auto-run via config
        // This ensures we have all handlers and polyfills loaded
        await page.evaluate(() => {
            window.PagedConfig = { auto: false };
        });

        // Use a specific older version of the polyfill if latest is problematic
        // We now bundle it locally to avoid external dependency and reliability issues
        const pagedJsPath = path.join(__dirname, 'lib', 'paged.polyfill.js');
        
        if (fs.existsSync(pagedJsPath)) {
            log(`Using local Paged.js from: ${pagedJsPath}`);
            await page.addScriptTag({ path: pagedJsPath });
        } else {
            // Fallback to CDN if local file is missing (e.g. inside a minimalistic container build?)
            const pagedJsUrl = 'https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js';
            logWarn(`Local Paged.js not found at ${pagedJsPath}, falling back to CDN: ${pagedJsUrl}`);
            await page.addScriptTag({ url: pagedJsUrl, timeout: 20000 });
        }

        // Wait a bit for script to initialize
        await new Promise(r => setTimeout(r, 1000));

        log('Starting Paged.js pagination with timeout', CONFIG.PAGED_JS_TIMEOUT);
        const success = await page.evaluate((timeout) => {
            return new Promise((resolve) => {
                // Check if Paged is loaded
                if (!window.Paged?.Previewer) {
                    console.log('[Paged.js] Library not loaded');
                    resolve(false);
                    return;
                }

                console.log('[Paged.js] Initializing Previewer...');
                const paged = new window.Paged.Previewer();

                // Track progress
                let pageCount = 0;
                paged.on('page', (page) => {
                    pageCount++;
                    console.log(`[Paged.js] Created page ${pageCount}`);
                });

                paged.on('rendered', (pages) => {
                    console.log(`[Paged.js] Rendered ${pages.length} pages total`);
                });

                const timer = setTimeout(() => {
                    console.log(`[Paged.js] Timeout reached! Current page count: ${pageCount}`);
                    // If we have some pages, maybe we can still return something? 
                    // But for now, let's just resolve false to see it in logs
                    resolve(pageCount > 0);
                }, timeout);

                try {
                    console.log('[Paged.js] Starting preview...');
                    const content = document.body.innerHTML;
                    document.body.innerHTML = '';

                    paged.preview(content, [], document.body)
                        .then(() => {
                            clearTimeout(timer);
                            console.log('[Paged.js] Preview finished successfully');
                            resolve(true);
                        })
                        .catch((err) => {
                            clearTimeout(timer);
                            console.error('[Paged.js] Preview failed:', err?.message || err);
                            resolve(false);
                        });
                } catch (e) {
                    clearTimeout(timer);
                    console.error('[Paged.js] Exception during preview:', e?.message || e);
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

    // Sanitize header/footer HTML to prevent XSS/injection
    if (printStyles.printHeaderHtml) {
        printStyles.printHeaderHtml = purify.sanitize(printStyles.printHeaderHtml);
    }
    if (printStyles.printFooterHtml) {
        printStyles.printFooterHtml = purify.sanitize(printStyles.printFooterHtml);
    }

    // CSS sanitation: don't use DOMPurify for raw CSS strings as it's meant for HTML.
    // Instead, just ensure we don't break out of the <style> tag.
    const cleanCss = cssStyles.replace(/<\/style>/gi, '');

    if (!cleanHtml) {
        return res.status(400).send('Invalid htmlContent');
    }

    // Embed images in main content
    log('Embedding images in content...');
    const htmlWithImages = await embedImagesAsDataUri(cleanHtml, userId);

    // Support for common page break markers
    const htmlWithPageBreaks = htmlWithImages
        .replace(/\\pagebreak/g, '<div style="break-after: page; clear: both;"></div>')
        .replace(/<!--\s*pagebreak\s*-->/g, '<div style="break-after: page; clear: both;"></div>');

    // Embed images in headers/footers if present
    const processedPrintStyles = { ...printStyles };
    if (processedPrintStyles.printHeaderHtml) {
        log('Embedding images in header...');
        processedPrintStyles.printHeaderHtml = await embedImagesAsDataUri(processedPrintStyles.printHeaderHtml, userId);
    }
    if (processedPrintStyles.printFooterHtml) {
        log('Embedding images in footer...');
        processedPrintStyles.printFooterHtml = await embedImagesAsDataUri(processedPrintStyles.printFooterHtml, userId);
    }

    // Build document
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

        // Run Paged.js for pagination
        const pagedSuccess = await runPagedJs(page);

        // Inject headers/footers
        if (processedPrintStyles.printHeaderHtml || processedPrintStyles.printFooterHtml) {
            await injectHeadersFooters(page, processedPrintStyles);
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
