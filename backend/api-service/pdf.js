// /backend/api-service/pdf.js

import express from 'express';
import puppeteer from 'puppeteer';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

export const pdfRoutes = express.Router();
const window = new JSDOM('').window;
const purify = DOMPurify(window);

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

    const cleanHtml = purify.sanitize(htmlContent);
    const cleanCss = purify.sanitize(cssStyles, { ALLOWED_TAGS: ['style'], ALLOWED_ATTR: [] });

    if (!cleanHtml || !cleanCss) {
        return res.status(400).send('Missing or invalid htmlContent or cssStyles');
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

        const csp = `default-src 'none'; script-src https://unpkg.com; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src https://fonts.googleapis.com; img-src * data:;`;

        const fullHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8" />
              <meta http-equiv="Content-Security-Policy" content="${csp}">
              <title>PDF Preview</title>
              ${googleFontsLink}
              <style>
                @page { size: ${pageSize}; margin: ${pageMargin}; }
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
            <body>${cleanHtml}</body>
          </html>
        `;

        const browser = await getBrowser();
        context = await browser.createBrowserContext();
        const page = await context.newPage();
        page.setDefaultTimeout(25000);

        await page.emulateMediaType('print');

        console.log('[PDF] Setting content...');
        await page.setContent(fullHtml, {
            waitUntil: 'networkidle2',
            timeout: 25000
        });

        await wait(1000);

        console.log('[PDF] Content set, loading Paged.js...');

        // --- PAGED.JS LOGIC (RESTORED) ---
        let pagedSuccess = false;
        try {
            await page.addScriptTag({ url: pagedJsUrl, timeout: 8000 });
            await wait(500);

            pagedSuccess = await page.evaluate(() => {
                return new Promise((resolve) => {
                    if (!window.Paged || !window.PagedPolyfill) {
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

                    try {
                        class DoneHandler extends window.Paged.Handlers.Base {
                            afterRendered() {
                                settle(true);
                            }
                        }

                        window.Paged.registerHandlers(DoneHandler);
                        window.PagedPolyfill.preview()
                            .then(() => settle(true))
                            .catch(() => settle(false));

                        setTimeout(() => settle(false), 8000);
                    } catch {
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