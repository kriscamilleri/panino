// /backend/api-service/pdf.js
import express from 'express';
import puppeteer from 'puppeteer';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

export const pdfRoutes = express.Router();
const window = new JSDOM('').window;
const purify = DOMPurify(window);

const BROWSER_TIMEOUT = 45000;
const PDF_TIMEOUT = 35000;

async function createBrowser() {
    const browser = await puppeteer.launch({
        headless: true,
        timeout: 30000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
        ],
    });
    
    const timeoutId = setTimeout(async () => {
        console.log('Browser timeout reached, forcing close');
        try {
            await browser.close();
        } catch (err) {
            console.error('Error force-closing browser:', err.message);
        }
    }, BROWSER_TIMEOUT);
    
    browser.once('disconnected', () => clearTimeout(timeoutId));
    
    return { browser, timeoutId };
}

function mapAlign(align) {
    switch ((align || 'center').toLowerCase()) {
        case 'left': return 'flex-start';
        case 'right': return 'flex-end';
        default: return 'center';
    }
}

pdfRoutes.post('/render-pdf', async (req, res) => {
    const { htmlContent, cssStyles, printStyles = {} } = req.body;

    const cleanHtml = purify.sanitize(htmlContent);
    const cleanCss = purify.sanitize(cssStyles, { ALLOWED_TAGS: ['style'], ALLOWED_ATTR: [] });

    if (!cleanHtml || !cleanCss) {
        return res.status(400).send('Missing or invalid htmlContent or cssStyles');
    }

    let browserContext = null;
    let page = null;

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

        browserContext = await createBrowser();
        const { browser, timeoutId } = browserContext;
        
        page = await browser.newPage();
        page.setDefaultTimeout(30000);

        // ✅ FIX: Disable request interception - it can cause navigation issues
        // await page.setRequestInterception(true);
        // page.on('request', (request) => {
        //     const url = request.url();
        //     if (url.startsWith('file://') || 
        //         (request.isNavigationRequest() && url !== 'about:blank' && !url.startsWith('data:'))) {
        //         request.abort();
        //     } else {
        //         request.continue();
        //     }
        // });

        await page.emulateMediaType('print');
        
        // ✅ FIX: Wait for networkidle0 to ensure navigation is fully complete
        await page.setContent(fullHtml, { 
            waitUntil: ['load', 'networkidle0'], 
            timeout: 30000 
        });

        // ✅ FIX: Add a small delay after setContent to ensure context is stable
        await new Promise(resolve => setTimeout(resolve, 500));

        // Try to load and run Paged.js
        try {
            await page.addScriptTag({ url: pagedJsUrl, timeout: 10000 });
            
            // ✅ FIX: Wait a bit after loading the script
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Run Paged.js with proper error handling
            const pagedResult = await page.evaluate(() => {
                return new Promise((resolve) => {
                    if (!window.Paged || !window.PagedPolyfill) {
                        resolve({ success: false, reason: 'Paged not available' });
                        return;
                    }
                    
                    try {
                        let resolved = false;
                        
                        class DoneHandler extends window.Paged.Handlers.Base {
                            afterRendered(flow) {
                                if (!resolved) {
                                    resolved = true;
                                    const total = (flow && flow.total) || 0;
                                    resolve({ success: true, pages: total });
                                }
                            }
                        }
                        
                        window.Paged.registerHandlers(DoneHandler);
                        window.PagedPolyfill.preview().catch(err => {
                            if (!resolved) {
                                resolved = true;
                                resolve({ success: false, reason: err.message });
                            }
                        });
                        
                        // Timeout fallback
                        setTimeout(() => {
                            if (!resolved) {
                                resolved = true;
                                resolve({ success: false, reason: 'timeout' });
                            }
                        }, 10000);
                    } catch (err) {
                        resolve({ success: false, reason: err.message });
                    }
                });
            });
            
            console.log('Paged.js result:', pagedResult);
            
            // Wait for page count to stabilize
            if (pagedResult.success) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
        } catch (err) {
            console.warn('Paged.js processing skipped:', err.message);
        }

        // ✅ FIX: Another delay before DOM manipulation
        await new Promise(resolve => setTimeout(resolve, 200));

        // Add headers/footers
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

        // Generate PDF
        const pdfBuffer = await page.pdf({
            format: pageSize || 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            timeout: PDF_TIMEOUT,
        });

        clearTimeout(timeoutId);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=preview.pdf');
        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF Generation Error:', error.message);
        if (!res.headersSent) {
            res.status(500).send(`Failed to generate PDF: ${error.message}`);
        }
    } finally {
        if (page) {
            try { await page.close(); } catch (err) { console.error('Page close error:', err.message); }
        }
        if (browserContext) {
            try {
                clearTimeout(browserContext.timeoutId);
                await browserContext.browser.close();
            } catch (err) {
                console.error('Browser close error:', err.message);
            }
        }
    }
});