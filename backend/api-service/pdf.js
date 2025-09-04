// /backend/api-service/pdf.js
import express from 'express';
import puppeteer from 'puppeteer';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

export const pdfRoutes = express.Router();
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// -------------------------------------------------------------
// ✅ START: OPTIMIZATIONS FOR BROWSER REUSE
// -------------------------------------------------------------

// This promise will hold the single, persistent browser instance.
let browserPromise;

/**
 * Launches and/or returns the single Puppeteer browser instance.
 */
const launchBrowser = () => {
    // If the promise already exists, return it to reuse the instance.
    if (browserPromise) {
        return browserPromise;
    }

    // Otherwise, create the launch promise. This will only run once.
    browserPromise = puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox', // Note: See security docs for running in containers safely
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
        ],
    });
    return browserPromise;
};

// Immediately launch the browser when the server starts.
launchBrowser().then(() => console.log('Puppeteer browser launched successfully.'));

// Add a hook to gracefully close the browser when the Node.js process exits.
process.on('exit', async () => {
    if (browserPromise) {
        console.log('Closing Puppeteer browser...');
        const browser = await browserPromise;
        await browser.close();
    }
});
// -------------------------------------------------------------
// ✅ END: OPTIMIZATIONS FOR BROWSER REUSE
// -------------------------------------------------------------

/**
 * Map human-friendly alignment to flexbox values.
 */
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

/**
 * Wait until the number of .pagedjs_page elements is stable
 * for N consecutive checks at a given interval.
 */
async function waitForStablePageCount(page, consecutive = 3, intervalMs = 200, timeoutMs = 5000) {
    const start = Date.now();
    let streak = 0;
    let lastCount = -1;

    while (Date.now() - start < timeoutMs) {
        const count = await page.evaluate(() => document.querySelectorAll('.pagedjs_page').length);
        if (count > 0 && count === lastCount) {
            streak++;
            if (streak >= consecutive) return count;
        } else {
            streak = 0;
        }
        lastCount = count;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return lastCount; // best-effort
}

pdfRoutes.post('/render-pdf', async (req, res) => {
    const { htmlContent, cssStyles, printStyles = {} } = req.body;

    // 🛡️ SECURITY: Sanitize all user-provided input before using it.
    const cleanHtml = purify.sanitize(htmlContent);
    const cleanCss = purify.sanitize(cssStyles, { ALLOWED_TAGS: ['style'], ALLOWED_ATTR: [] });

    if (!cleanHtml || !cleanCss) {
        return res.status(400).send('Missing or invalid htmlContent or cssStyles');
    }

    let page; // Define page here to access it in the finally block
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
                /* User-provided styles (sanitized) */
                ${cleanCss}
                /* Ensure overlays don't capture events or affect layout */
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

        const browser = await launchBrowser(); // Reuse the single browser instance
        page = await browser.newPage(); // Create a new, fast page for this request

        // 🛡️ SECURITY: Intercept requests to block filesystem access and navigations.
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
        
        // ✅ OPTIMIZATION: Use 'domcontentloaded' for a much faster initial load.
        await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 45000 });

        try {
            if (/^https?:\/\//i.test(pagedJsUrl)) {
                await page.addScriptTag({ url: pagedJsUrl });
            } else {
                await page.addScriptTag({ path: pagedJsUrl });
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
                    setTimeout(() => resolve(-1), 15000);
                } catch (err) {
                    resolve(-1);
                }
            });
        });

        console.log('Paged afterRendered totalPages =', totalPagesFromPaged);
        await waitForStablePageCount(page, 3, 250, 6000);

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

        const pdfBuffer = await page.pdf({
            format: pageSize || 'A4',
            printBackground: true,
            preferCSSPageSize: true,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=preview.pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).send(`Failed to generate PDF: ${error.message}`);
    } finally {
        // ✅ CRITICAL: Always close the page to prevent memory leaks.
        if (page) {
            await page.close();
        }
    }
});