// /backend/api-service/pdf.js

import express from 'express';
import puppeteer from 'puppeteer';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

export const pdfRoutes = express.Router();
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// -------------------------------------------------------------
// SECTION 1: SINGLETON BROWSER MANAGER
// Manages a single, persistent browser instance to avoid the high cost
// of launching a new browser for every request.
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
                '--disable-dev-shm-usage', // Recommended for Docker environments
                '--disable-gpu',
                '--disable-software-rasterizer',
            ],
        });
        console.log('[PDF] New browser instance launched successfully.');
    }
    return browserInstance;
}

// Gracefully close the browser when the Node process exits.
process.on('exit', async () => {
    if (browserInstance) {
        console.log('[PDF] Closing browser instance on app exit...');
        await browserInstance.close();
        browserInstance = null;
    }
});


// -------------------------------------------------------------
// SECTION 2: REQUEST QUEUE
// This remains important to process one PDF at a time, preventing
// the server from being overwhelmed even with a single browser.
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
        // Log the detailed error and send a generic 500 response
        console.error('PDF generation failed:', error);
        if (!res.headersSent) {
            res.status(500).send(`Failed to generate PDF: ${error.message}`);
        }
    } finally {
        isProcessing = false;
        resolve(); // Resolve the promise to unblock the client's async request
        // Process the next item in the queue with a short delay
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
// Refactored to use the singleton browser and per-request contexts.
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

    // This will hold the isolated "incognito" session for this request.
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

        // 1. Get the shared browser instance.
        const browser = await getBrowser();

        // 2. Create a secure, isolated incognito context for this request.
        context = await browser.createIncognitoBrowserContext();

        // 3. Create a new page within that context.
        const page = await context.newPage();
        page.setDefaultTimeout(25000);

        await page.emulateMediaType('print');
        
        console.log('[PDF] Setting content...');
        await page.setContent(fullHtml, { 
            waitUntil: 'networkidle2',
            timeout: 25000 
        });

        await page.waitForTimeout(1000);
        
        console.log('[PDF] Content set, loading Paged.js...');

        // Your existing Paged.js and page.evaluate() logic follows...
        // This code does not need to be changed.
        // ...
        
        // (Assuming your Paged.js and evaluate calls are here)

        // ...
        
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
        // The error will be re-thrown and handled by the queue processor.
        console.error('[PDF] An error occurred during PDF generation:', error);
        throw error;
    } finally {
        console.log('[PDF] Cleanup starting...');
        
        // CRITICAL: Close the incognito context. This destroys the page
        // and all associated session data (cookies, storage, etc.).
        // The main browser instance remains running for the next request.
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