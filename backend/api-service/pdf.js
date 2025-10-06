// /backend/api-service/pdf.js
import express from 'express';
import puppeteer from 'puppeteer';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

export const pdfRoutes = express.Router();
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// -------------------------------------------------------------
// ✅ BROWSER MANAGEMENT WITH BETTER ERROR RECOVERY
// -------------------------------------------------------------

let browserPromise = null;
let browserRestartPending = false;
const MAX_RETRIES = 2;

const launchBrowser = async () => {
    if (browserPromise && !browserRestartPending) {
        try {
            const browser = await browserPromise;
            if (browser.isConnected()) {
                return browserPromise;
            }
        } catch (err) {
            console.error('Browser check failed:', err);
        }
    }

    console.log('Launching new browser instance...');
    browserRestartPending = false;
    browserPromise = puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
        ],
    }).catch(err => {
        console.error('Failed to launch browser:', err);
        browserPromise = null;
        throw err;
    });

    return browserPromise;
};

// Initial launch
launchBrowser()
    .then(() => console.log('Puppeteer browser launched successfully.'))
    .catch(err => console.error('Failed to launch browser on startup:', err));

// Health check
setInterval(async () => {
    if (!browserPromise) return;
    
    try {
        const browser = await browserPromise;
        if (!browser.isConnected()) {
            console.warn('Browser disconnected, marking for restart');
            browserRestartPending = true;
            browserPromise = null;
        }
    } catch (err) {
        console.error('Browser health check failed:', err);
        browserRestartPending = true;
        browserPromise = null;
    }
}, 60000);

// Graceful shutdown
const shutdown = async () => {
    if (browserPromise) {
        console.log('Closing Puppeteer browser...');
        try {
            const browser = await browserPromise;
            await browser.close();
        } catch (err) {
            console.error('Error during browser shutdown:', err);
        }
    }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('exit', () => {
    // Note: Can't use async here, but attempt cleanup
    if (browserPromise) {
        browserPromise.then(b => b.close()).catch(() => {});
    }
});

// -------------------------------------------------------------
// ✅ ENHANCED REQUEST QUEUE WITH RETRY LOGIC
// -------------------------------------------------------------

let isGenerating = false;
const requestQueue = [];

async function processQueue() {
    if (isGenerating || requestQueue.length === 0) return;
    
    isGenerating = true;
    const item = requestQueue.shift();
    
    try {
        await generatePdfWithRetry(item.req, item.res, item.retryCount || 0);
        item.resolve();
    } catch (error) {
        console.error('PDF generation failed after retries:', error);
        if (!item.res.headersSent) {
            item.res.status(500).send(`Failed to generate PDF: ${error.message}`);
        }
        item.resolve(); // Still resolve to continue queue
    } finally {
        isGenerating = false;
        // Small delay before next request to allow cleanup
        setTimeout(() => processQueue(), 100);
    }
}

async function generatePdfWithRetry(req, res, retryCount) {
    try {
        await generatePdfForRequest(req, res);
    } catch (error) {
        if (retryCount < MAX_RETRIES && (
            error.message.includes('Execution context was destroyed') ||
            error.message.includes('Target closed') ||
            error.message.includes('Session closed')
        )) {
            console.log(`Retry attempt ${retryCount + 1}/${MAX_RETRIES} for PDF generation`);
            browserRestartPending = true;
            browserPromise = null;
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retry
            return generatePdfWithRetry(req, res, retryCount + 1);
        }
        throw error;
    }
}

pdfRoutes.post('/render-pdf', async (req, res) => {
    return new Promise((resolve) => {
        requestQueue.push({ req, res, resolve, retryCount: 0 });
        processQueue();
    });
});

// -------------------------------------------------------------
// ✅ PDF GENERATION WITH ENHANCED ERROR HANDLING
// -------------------------------------------------------------

function mapAlign(align) {
    switch ((align || 'center').toLowerCase()) {
        case 'left':
            return 'flex-start';
        case 'right':
            return 'flex-end';
        default:
            return 'center';
    }
}

async function waitForStablePageCount(page, consecutive = 3, intervalMs = 200, timeoutMs = 5000) {
    const start = Date.now();
    let streak = 0;
    let lastCount = -1;

    while (Date.now() - start < timeoutMs) {
        try {
            const count = await page.evaluate(() => document.querySelectorAll('.pagedjs_page').length);
            if (count > 0 && count === lastCount) {
                streak++;
                if (streak >= consecutive) return count;
            } else {
                streak = 0;
            }
            lastCount = count;
            await new Promise((r) => setTimeout(r, intervalMs));
        } catch (err) {
            if (err.message.includes('Execution context was destroyed')) {
                throw err;
            }
            console.warn('Error in waitForStablePageCount:', err.message);
            break;
        }
    }
    return lastCount;
}

async function generatePdfForRequest(req, res) {
    const { htmlContent, cssStyles, printStyles = {} } = req.body;

    const cleanHtml = purify.sanitize(htmlContent);
    const cleanCss = purify.sanitize(cssStyles, { ALLOWED_TAGS: ['style'], ALLOWED_ATTR: [] });

    if (!cleanHtml || !cleanCss) {
        return res.status(400).send('Missing or invalid htmlContent or cssStyles');
    }

    let page = null;
    let browser = null;

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
                @page {
                  size: ${pageSize};
                  margin: ${pageMargin};
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
            <body>
              ${cleanHtml}
            </body>
          </html>
        `;

        browser = await launchBrowser();
        page = await browser.newPage();

        page.setDefaultTimeout(40000);
        page.setDefaultNavigationTimeout(40000);

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.startsWith('file://')) {
                request.abort();
            } else if (request.isNavigationRequest() && url !== 'about:blank' && !url.startsWith('data:')) {
                request.abort();
            } else {
                request.continue();
            }
        });

        page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
        
        await page.emulateMediaType('print');
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 40000 });

        try {
            if (/^https?:\/\//i.test(pagedJsUrl)) {
                await page.addScriptTag({ url: pagedJsUrl, timeout: 15000 });
            } else {
                await page.addScriptTag({ path: pagedJsUrl, timeout: 15000 });
            }
        } catch (e) {
            console.warn('Failed to load Paged.js:', e?.message || e);
        }

        const totalPagesFromPaged = await page.evaluate(async () => {
            if (!window.Paged || !window.PagedPolyfill) return -1;
            return await new Promise((resolve) => {
                try {
                    class DoneHandler extends window.Paged.Handlers.Base {
                        afterRendered(flow) {
                            const total = (flow && flow.total) || 0;
                            document.documentElement.setAttribute('data-pagedjs-rendered', 'true');
                            document.documentElement.setAttribute('data-total-pages', String(total));
                            setTimeout(() => resolve(total), 0);
                        }
                    }
                    window.Paged.registerHandlers(DoneHandler);
                    window.PagedPolyfill.preview().catch(() => resolve(-1));
                    setTimeout(() => resolve(-1), 12000);
                } catch (err) {
                    resolve(-1);
                }
            });
        });

        console.log('Paged afterRendered totalPages =', totalPagesFromPaged);
        await waitForStablePageCount(page, 3, 250, 5000);

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

        // Generate PDF with timeout protection
        const pdfBuffer = await Promise.race([
            page.pdf({
                format: pageSize || 'A4',
                printBackground: true,
                preferCSSPageSize: true,
            }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('PDF generation timeout')), 35000)
            )
        ]);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=preview.pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF Generation Error:', error);
        throw error;
    } finally {
        if (page) {
            try {
                if (!page.isClosed()) {
                    await page.close();
                }
            } catch (err) {
                console.error('Error closing page:', err.message);
            }
        }
    }
}