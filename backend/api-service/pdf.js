// /backend/api-service/pdf.js

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

// Timeout for external image fetches (in milliseconds)
const EXTERNAL_IMAGE_TIMEOUT = 5000;

// Timeout for Paged.js rendering (in milliseconds) - increased for complex documents with images
const PAGEDJS_TIMEOUT = 60000;

/**
 * Fetches an image from disk and converts it to a base64 data URI.
 * This is used during PDF generation to embed images directly in the HTML
 * since the server can't make HTTP requests to itself.
 * 
 * For large images, we log a warning as they may cause Paged.js issues.
 * 
 * @param {string} imageId - The UUID of the image
 * @param {string} userId - The user ID for authorization
 * @returns {string|null} Base64 data URI or null if not found
 */
function getImageAsDataUri(imageId, userId) {
    try {
        const db = getUserDb(userId);
        const image = db.prepare('SELECT mime_type, path FROM images WHERE id = ? AND user_id = ?').get(imageId, userId);

        if (!image || !image.path) {
            console.log(`[PDF] Image not found in DB: ${imageId}`);
            return null;
        }

        const absolutePath = path.join(UPLOADS_DIR, image.path);

        // Security check
        if (!absolutePath.startsWith(UPLOADS_DIR)) {
            console.log(`[PDF] Security check failed for image: ${imageId}`);
            return null;
        }

        if (!fs.existsSync(absolutePath)) {
            console.log(`[PDF] Image file not on disk: ${absolutePath}`);
            return null;
        }

        const fileBuffer = fs.readFileSync(absolutePath);
        const fileSizeKB = Math.round(fileBuffer.length / 1024);
        const base64 = fileBuffer.toString('base64');
        const dataUri = `data:${image.mime_type};base64,${base64}`;

        if (fileSizeKB > 500) {
            console.log(`[PDF] WARNING: Large image ${imageId} (${fileSizeKB}KB) may slow down Paged.js`);
        }

        console.log(`[PDF] Converted image ${imageId} to data URI (${fileSizeKB}KB)`);
        return dataUri;
    } catch (error) {
        console.error(`[PDF] Error converting image to data URI:`, error);
        return null;
    }
}

/**
 * Fetches an external image URL and converts it to a base64 data URI.
 * Includes timeout handling to prevent hanging on slow/unreachable URLs.
 * 
 * @param {string} url - The external image URL
 * @returns {Promise<string|null>} Base64 data URI or null if fetch failed
 */
async function fetchExternalImageAsDataUri(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_IMAGE_TIMEOUT);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; PaninoPDF/1.0)',
            },
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.log(`[PDF] External image fetch failed: ${url} (status ${response.status})`);
            return null;
        }

        const contentType = response.headers.get('content-type') || 'image/png';
        
        // Validate it's actually an image
        if (!contentType.startsWith('image/')) {
            console.log(`[PDF] External URL is not an image: ${url} (${contentType})`);
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const fileSizeKB = Math.round(buffer.length / 1024);

        if (fileSizeKB > 2000) {
            console.log(`[PDF] WARNING: External image too large, skipping: ${url} (${fileSizeKB}KB)`);
            return null;
        }

        const base64 = buffer.toString('base64');
        const dataUri = `data:${contentType};base64,${base64}`;

        console.log(`[PDF] Fetched external image: ${url.substring(0, 60)}... (${fileSizeKB}KB)`);
        return dataUri;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log(`[PDF] External image fetch timeout: ${url}`);
        } else {
            console.log(`[PDF] External image fetch error: ${url} - ${error.message}`);
        }
        return null;
    }
}

/**
 * Replaces internal image URLs with base64 data URIs.
 * This allows Puppeteer to render images without making HTTP requests.
 * If an image cannot be loaded, it is removed from the HTML to prevent Paged.js errors.
 * 
 * @param {string} html - The HTML content with image URLs
 * @param {string} userId - The user ID for authorization
 * @returns {string} HTML with images embedded as data URIs (or removed if failed)
 */
function embedInternalImagesAsDataUri(html, userId) {
    // Match image tags with our internal image URLs
    // Handles: /images/UUID, /api/images/UUID, http://localhost:PORT/images/UUID, etc.
    return html.replace(
        /<img([^>]*)\ssrc=["'](?:https?:\/\/[^\/]+)?\/(?:api\/)?images\/([a-f0-9-]+)(?:\?[^"']*)?["']([^>]*)>/gi,
        (match, beforeSrc, imageId, afterSrc) => {
            const dataUri = getImageAsDataUri(imageId, userId);
            if (dataUri) {
                return `<img${beforeSrc} src="${dataUri}"${afterSrc}>`;
            }
            // If we couldn't get the image, remove it entirely to prevent Paged.js errors
            console.log(`[PDF] Removing internal image ${imageId} from output (could not load)`);
            return `<!-- Image ${imageId} removed: could not load -->`;
        }
    );
}

/**
 * Extracts all external image URLs from HTML.
 * External images are any http/https URLs that are NOT our internal /images/ endpoints.
 * 
 * @param {string} html - The HTML content
 * @returns {string[]} Array of external image URLs
 */
function extractExternalImageUrls(html) {
    const urls = [];
    const regex = /<img[^>]*\ssrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const url = match[1];
        // Skip internal URLs that may have full domain (like localhost)
        if (!url.includes('/images/') && !url.includes('/api/images/')) {
            urls.push(url);
        }
    }
    return [...new Set(urls)]; // Remove duplicates
}

/**
 * Replaces all images (internal and external) with base64 data URIs.
 * Images that fail to load are removed from the HTML to prevent Paged.js errors.
 * 
 * @param {string} html - The HTML content with image URLs
 * @param {string} userId - The user ID for authorization
 * @returns {Promise<string>} HTML with images embedded as data URIs (or removed if failed)
 */
async function embedAllImagesAsDataUri(html, userId) {
    // Log all image tags found in HTML for debugging
    const allImgTags = html.match(/<img[^>]*>/gi) || [];
    console.log(`[PDF] Processing ${allImgTags.length} image tags`);
    allImgTags.forEach((tag, i) => {
        const srcMatch = tag.match(/src=["']([^"']+)["']/i);
        const src = srcMatch ? srcMatch[1] : 'no-src';
        // Truncate data URIs for logging
        const displaySrc = src.startsWith('data:') ? `${src.substring(0, 40)}... (data URI)` : src;
        console.log(`[PDF] Image ${i + 1}: ${displaySrc.substring(0, 100)}`);
    });

    // First, handle internal images (synchronous)
    let processedHtml = embedInternalImagesAsDataUri(html, userId);
    
    // Extract external image URLs
    const externalUrls = extractExternalImageUrls(processedHtml);
    
    if (externalUrls.length > 0) {
        console.log(`[PDF] Found ${externalUrls.length} external images to fetch`);
        
        // Fetch all external images in parallel with a map of url -> dataUri
        const urlToDataUri = new Map();
        const fetchPromises = externalUrls.map(async (url) => {
            const dataUri = await fetchExternalImageAsDataUri(url);
            urlToDataUri.set(url, dataUri);
        });
        
        await Promise.all(fetchPromises);
        
        // Replace external image URLs with data URIs or remove if failed
        processedHtml = processedHtml.replace(
            /<img([^>]*)\ssrc=["'](https?:\/\/[^"']+)["']([^>]*)>/gi,
            (match, beforeSrc, url, afterSrc) => {
                // Skip internal URLs
                if (url.includes('/images/') || url.includes('/api/images/')) {
                    return match;
                }
                
                const dataUri = urlToDataUri.get(url);
                if (dataUri) {
                    return `<img${beforeSrc} src="${dataUri}"${afterSrc}>`;
                }
                
                // If we couldn't fetch the image, remove it to prevent Paged.js errors
                console.log(`[PDF] Removing external image from output: ${url.substring(0, 60)}...`);
                return `<!-- External image removed: could not load ${url.substring(0, 60)}... -->`;
            }
        );
    }
    
    // Final check: look for any remaining non-data-URI images
    const remainingImages = processedHtml.match(/<img[^>]*src=["'](?!data:)[^"']+["'][^>]*>/gi) || [];
    if (remainingImages.length > 0) {
        console.log(`[PDF] WARNING: ${remainingImages.length} images still have external URLs after processing:`);
        remainingImages.forEach((tag, i) => {
            const srcMatch = tag.match(/src=["']([^"']+)["']/i);
            console.log(`[PDF] Remaining image ${i + 1}: ${srcMatch ? srcMatch[1].substring(0, 80) : 'unknown'}`);
        });
    } else {
        console.log(`[PDF] All images converted to data URIs successfully`);
    }
    
    return processedHtml;
}

// Helper function to replace deprecated page.waitForTimeout
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// -------------------------------------------------------------
// SECTION 1: SINGLETON BROWSER MANAGER
// -------------------------------------------------------------

let browserInstance = null;

async function getBrowser() {
    if (!browserInstance || !browserInstance.isConnected()) {
        console.log('[PDF] No browser instance found or disconnected, launching a new one...');
        browserInstance = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
            ],
        });
        console.log('[PDF] New browser instance launched successfully.');
    }
    return browserInstance;
}

process.on('exit', async () => {
    if (browserInstance) {
        console.log('[PDF] Closing browser instance on app exit...');
        await browserInstance.close();
        browserInstance = null;
    }
});


// -------------------------------------------------------------
// SECTION 2: REQUEST QUEUE
// -------------------------------------------------------------

let isProcessing = false;
const queue = [];

async function processNextInQueue() {
    if (isProcessing || queue.length === 0) return;

    isProcessing = true;
    const { req, res, resolve } = queue.shift();

    try {
        await handlePdfGeneration(req, res);
    } catch (error) {
        console.error('PDF generation failed:', error);
        if (!res.headersSent) {
            res.status(500).send(`Failed to generate PDF: ${error.message}`);
        }
    } finally {
        isProcessing = false;
        resolve();
        setTimeout(() => processNextInQueue(), 100);
    }
}

pdfRoutes.post('/render-pdf', (req, res) => {
    return new Promise((resolve) => {
        queue.push({ req, res, resolve });
        processNextInQueue();
    });
});


// -------------------------------------------------------------
// SECTION 3: PDF GENERATION LOGIC
// -------------------------------------------------------------

function mapAlign(align) {
    switch ((align || 'center').toLowerCase()) {
        case 'left': return 'flex-start';
        case 'right': return 'flex-end';
        default: return 'center';
    }
}

async function handlePdfGeneration(req, res) {
    const { htmlContent, cssStyles, printStyles = {} } = req.body;

    // Get the user ID from the authenticated request
    const userId = req.user?.user_id;
    if (!userId) {
        return res.status(401).send('Authentication required for PDF generation');
    }

    const cleanHtml = purify.sanitize(htmlContent);
    const cleanCss = purify.sanitize(cssStyles, { ALLOWED_TAGS: ['style'], ALLOWED_ATTR: [] });

    if (!cleanHtml || !cleanCss) {
        return res.status(400).send('Missing or invalid htmlContent or cssStyles');
    }

    // Embed internal images as base64 data URIs
    // This is necessary because Puppeteer can't make HTTP requests back to this server
    // Also fetches and embeds external images to prevent Paged.js loading issues
    console.log('[PDF] Embedding images as data URIs for user:', userId);
    const htmlWithEmbeddedImages = await embedAllImagesAsDataUri(cleanHtml, userId);

    // Count images for logging
    const imgMatches = cleanHtml.match(/<img[^>]*>/gi);
    if (imgMatches) {
        console.log('[PDF] Found', imgMatches.length, 'images in HTML');
    }

    let context = null;

    try {
        const {
            printHeaderHtml = '',
            printFooterHtml = '',
            googleFontFamily = '',
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
            pagedJsUrl = process.env.PAGEDJS_URL || 'https://unpkg.com/pagedjs/dist/paged.polyfill.js',
            pageSize = 'A4',
            pageMargin = '2cm',
        } = printStyles;

        const headerJustify = mapAlign(headerAlign);
        const footerJustify = mapAlign(footerAlign);

        let googleFontsLink = '';
        if (googleFontFamily) {
            const families = googleFontFamily
                .split(',')
                .map(f => `family=${encodeURIComponent(f.trim())}:wght@400;600;700`)
                .join('&');
            if (families) {
                googleFontsLink = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">`;
            }
        }

        const csp = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src https://fonts.googleapis.com; img-src * data: blob:;`;

        const fullHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8" />
              <meta http-equiv="Content-Security-Policy" content="${csp}">
              <title>PDF Preview</title>
              ${googleFontsLink}
              <style>
                @page { 
                  size: ${pageSize}; 
                  margin-top: ${headerHeight}; 
                  margin-bottom: ${footerHeight};
                  margin-left: ${pageMargin};
                  margin-right: ${pageMargin};
                }
                html, body { padding: 0; margin: 0; }
                body {
                  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif;
                  line-height: 1.6;
                  color: #333;
                }
                ${cleanCss}
                ._overlay-header, ._overlay-footer {
                  pointer-events: none;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                }
              </style>
            </head>
            <body>${htmlWithEmbeddedImages}</body>
          </html>
        `;

        const browser = await getBrowser();
        context = await browser.createBrowserContext();
        const page = await context.newPage();
        page.setDefaultTimeout(90000); // 90s Puppeteer timeout for complex documents

        // Log failed requests to debug image loading issues
        page.on('requestfailed', request => {
            console.log('[PDF] Request failed:', request.url(), request.failure()?.errorText);
        });

        page.on('response', response => {
            if (response.url().includes('/images/')) {
                console.log('[PDF] Image response:', response.url().substring(0, 80), 'Status:', response.status());
            }
        });

        // Capture console logs from the page for Paged.js debugging
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('Paged') || text.includes('paged')) {
                console.log('[PDF][Page]', text);
            }
        });

        page.on('pageerror', err => {
            console.log('[PDF][PageError]', err.message);
        });

        await page.emulateMediaType('print');

        console.log('[PDF] Setting content...');
        await page.setContent(fullHtml, {
            waitUntil: 'load',  // Wait for load event (ignores networkIdle for failing fonts)
            timeout: 30000 // 30s timeout for content loading
        });

        // Give more time for large images to be processed
        await wait(500);

        console.log('[PDF] Content set, loading Paged.js...');

        // --- PAGED.JS LOGIC (RESTORED) ---
        let pagedSuccess = false;
        try {
            await page.addScriptTag({ url: pagedJsUrl, timeout: 5000 }); // 5s network timeout
            await wait(500);

            pagedSuccess = await page.evaluate(() => {
                return new Promise((resolve) => {
                    if (!window.Paged || !window.PagedPolyfill) {
                        console.log('[Paged.js] Library not loaded');
                        resolve(false);
                        return;
                    }

                    let settled = false;
                    const settle = (result) => {
                        if (!settled) {
                            settled = true;
                            resolve(result);
                        }
                    };

                    // Wait for all images to be fully loaded before starting Paged.js
                    const waitForImages = () => {
                        const images = document.querySelectorAll('img');
                        console.log('[Paged.js] Found', images.length, 'img elements in DOM');
                        
                        const loadPromises = Array.from(images).map((img, idx) => {
                            // Data URI images are typically already complete
                            const isDataUri = img.src && img.src.startsWith('data:');
                            
                            if (img.complete && img.naturalWidth > 0) {
                                console.log('[Paged.js] Image', idx + 1, 'already complete');
                                return Promise.resolve();
                            }
                            
                            if (isDataUri) {
                                // Data URIs should load synchronously, if not complete yet wait briefly
                                console.log('[Paged.js] Image', idx + 1, 'is data URI, waiting briefly...');
                                return new Promise((res) => setTimeout(res, 100));
                            }
                            
                            console.log('[Paged.js] Image', idx + 1, 'waiting for load:', img.src?.substring(0, 50));
                            return new Promise((res) => {
                                const timeout = setTimeout(() => {
                                    console.log('[Paged.js] Image', idx + 1, 'load timeout after 5s');
                                    res();
                                }, 5000); // 5s timeout per image
                                
                                img.onload = () => {
                                    clearTimeout(timeout);
                                    console.log('[Paged.js] Image', idx + 1, 'loaded');
                                    res();
                                };
                                img.onerror = () => {
                                    clearTimeout(timeout);
                                    console.log('[Paged.js] Image', idx + 1, 'failed to load');
                                    res(); // Resolve anyway to not block
                                };
                            });
                        });
                        return Promise.all(loadPromises);
                    };

                    try {
                        console.log('[Paged.js] Waiting for images to load...');
                        waitForImages().then(() => {
                            const imgCount = document.querySelectorAll('img').length;
                            console.log('[Paged.js] Images loaded, starting preview with', imgCount, 'images...');
                            
                            // Track progress while Paged.js runs
                            let lastPageCount = 0;
                            let stuckCounter = 0;
                            
                            // Check for progress every 2 seconds
                            const progressCheck = setInterval(() => {
                                const pages = document.querySelectorAll('.pagedjs_page');
                                console.log('[Paged.js] Progress check: found', pages.length, 'pages');
                                
                                if (pages.length === lastPageCount && pages.length > 0) {
                                    stuckCounter++;
                                    if (stuckCounter >= 3) {
                                        // Stuck for 6+ seconds after rendering some pages, force complete
                                        console.log('[Paged.js] Appears stuck, forcing completion with', pages.length, 'pages');
                                        clearInterval(progressCheck);
                                        settle(true);
                                    }
                                } else {
                                    stuckCounter = 0;
                                    lastPageCount = pages.length;
                                }
                            }, 2000);
                            
                            // Use PagedPolyfill.preview() which works directly on the existing DOM
                            // This is the polyfill approach - it doesn't require passing content/styles
                            // and doesn't clear/re-render the body (which causes duplicate headers)
                            window.PagedPolyfill.preview()
                                .then(() => {
                                    clearInterval(progressCheck);
                                    const pages = document.querySelectorAll('.pagedjs_page');
                                    console.log('[Paged.js] Preview completed with', pages.length, 'pages');
                                    settle(true);
                                })
                                .catch((err) => {
                                    clearInterval(progressCheck);
                                    console.error('[Paged.js] Preview error:', err?.message || err?.toString() || 'Unknown error');
                                    settle(false);
                                });
                        });

                        // Timeout for Paged.js
                        setTimeout(() => {
                            console.log('[Paged.js] Timeout reached after 60s');
                            // Even on timeout, check if pages were rendered
                            const pages = document.querySelectorAll('.pagedjs_page');
                            if (pages.length > 0) {
                                console.log('[Paged.js] Timeout but found', pages.length, 'pages');
                                settle(true);
                            } else {
                                settle(false);
                            }
                        }, 60000); // 60s timeout for complex documents
                    } catch (e) {
                        console.error('[Paged.js] Exception:', e?.message || e?.toString() || 'Unknown');
                        console.error('[Paged.js] Stack:', e?.stack || 'No stack');
                        settle(false);
                    }
                });
            });

            console.log('[PDF] Paged.js completed:', pagedSuccess);

            if (pagedSuccess) {
                await wait(800);
            }
        } catch (err) {
            console.warn('[PDF] Paged.js error:', err.message);
        }

        await wait(300);

        console.log('[PDF] Adding headers/footers...');

        // --- HEADER/FOOTER INJECTION LOGIC (RESTORED) ---
        await page.evaluate((settings) => {
            const pages = document.querySelectorAll('.pagedjs_page:not(.pagedjs_blank)');
            const totalPages = Math.max(1, pages.length);

            function shouldShow(which, pageNum, lastPage) {
                if (which === 'header') {
                    if (pageNum === 1 && settings.hideHeaderOnFirst) return false;
                    if (pageNum === lastPage && settings.hideHeaderOnLast) return false;
                    return !!settings.headerHtml;
                } else {
                    if (pageNum === 1 && settings.hideFooterOnFirst) return false;
                    if (pageNum === lastPage && settings.hideFooterOnLast) return false;
                    return !!settings.footerHtml;
                }
            }

            const makeOverlay = (which, pageNum, lastPage) => {
                const tpl = which === 'header' ? settings.headerHtml : settings.footerHtml;
                if (!tpl) return null;
                const el = document.createElement('div');
                el.className = which === 'header' ? '_overlay-header' : '_overlay-footer';
                el.innerHTML = tpl.replace(/%p/g, String(pageNum)).replace(/%P/g, String(lastPage));
                Object.assign(el.style, {
                    position: 'absolute', left: '0', right: '0', display: 'flex', alignItems: 'center',
                    justifyContent: which === 'header' ? settings.headerJustify : settings.footerJustify,
                    fontSize: which === 'header' ? settings.headerFontSize : settings.footerFontSize,
                    color: which === 'header' ? settings.headerColor : settings.footerColor,
                    height: which === 'header' ? settings.headerHeight : settings.footerHeight,
                    overflow: 'visible', zIndex: '2147483647',
                });
                if (which === 'header') {
                    el.style.top = '0';
                    el.style.transform = `translateY(-${settings.headerOffset})`;
                } else {
                    el.style.bottom = '0';
                    el.style.transform = `translateY(${settings.footerOffset})`;
                }
                return el;
            };

            if (pages.length === 0) {
                const body = document.body;
                Object.assign(body.style, { position: 'relative', overflow: 'visible' });
                if (shouldShow('header', 1, 1)) body.appendChild(makeOverlay('header', 1, 1));
                if (shouldShow('footer', 1, 1)) body.appendChild(makeOverlay('footer', 1, 1));
                return;
            }

            const last = totalPages;
            pages.forEach((pageEl, i) => {
                const pageNum = i + 1;
                Object.assign(pageEl.style, { position: 'relative', overflow: 'visible' });
                if (shouldShow('header', pageNum, last)) pageEl.appendChild(makeOverlay('header', pageNum, last));
                if (shouldShow('footer', pageNum, last)) pageEl.appendChild(makeOverlay('footer', pageNum, last));
            });
        }, {
            headerHtml: String(printHeaderHtml || ''),
            footerHtml: String(printFooterHtml || ''),
            headerFontSize: `${parseInt(String(headerFontSize), 10)}px`,
            headerColor: String(headerFontColor),
            headerJustify,
            footerFontSize: `${parseInt(String(footerFontSize), 10)}px`,
            footerColor: String(footerFontColor),
            footerJustify,
            hideHeaderOnFirst: !!hideHeaderOnFirst,
            hideFooterOnFirst: !!hideFooterOnFirst,
            hideHeaderOnLast: !!hideHeaderOnLast,
            hideFooterOnLast: !!hideFooterOnLast,
            headerHeight: String(headerHeight),
            footerHeight: String(footerHeight),
            headerOffset: String(headerOffset).replace(/^\+/, ''),
            footerOffset: String(footerOffset).replace(/^\+/, ''),
        });

        console.log('[PDF] Generating PDF...');
        const pdfBuffer = await page.pdf({
            format: pageSize || 'A4',
            printBackground: true,
            preferCSSPageSize: true,
        });

        console.log('[PDF] PDF generated successfully');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=preview.pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('[PDF] An error occurred during PDF generation:', error);
        throw error;
    } finally {
        console.log('[PDF] Cleanup starting...');

        if (context) {
            try {
                await context.close();
                console.log('[PDF] Browser context closed successfully.');
            } catch (err) {
                console.error('[PDF] Failed to close browser context:', err.message);
            }
        }

        console.log('[PDF] Cleanup complete.');
    }
}