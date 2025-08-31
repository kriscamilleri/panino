// pdf.js
import express from 'express';
import puppeteer from 'puppeteer';

export const pdfRoutes = express.Router();

/**
 * Launch Puppeteer with Docker-friendly flags.
 */
const launchBrowser = () =>
  puppeteer.launch({
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
  });

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

  if (htmlContent === undefined || cssStyles === undefined) {
    return res.status(400).send('Missing htmlContent or cssStyles');
  }

  let browser;
  try {
    const {
      // Overlay HTML templates with tokens: %p (current page), %P (total pages)
      printHeaderHtml = '',
      printFooterHtml = '',
      // Typography & alignment
      headerFontSize = '10', // px (string or number)
      headerFontColor = '#666666',
      headerAlign = 'center',
      footerFontSize = '10', // px
      footerFontColor = '#666666',
      footerAlign = 'center',
      // Visibility toggles
      hideHeaderOnFirst = false,
      hideFooterOnFirst = false,
      hideHeaderOnLast = false,
      hideFooterOnLast = false,
      // Box sizes & offsets
      headerHeight = '1.5cm',
      footerHeight = '1.5cm',
      headerOffset = '0cm', // positive length; rendered upward via translateY(-offset)
      footerOffset = '0cm', // positive length; rendered downward via translateY(offset)
      // Optional: custom Paged.js URL (e.g., local path in the container)
      pagedJsUrl = process.env.PAGEDJS_URL || 'https://unpkg.com/pagedjs/dist/paged.polyfill.js',
      // Optional: override @page margin & size
      pageSize = 'A4',
      pageMargin = '2cm',
    } = printStyles;

    const headerJustify = mapAlign(headerAlign);
    const footerJustify = mapAlign(footerAlign);

    // Build the document (no inline <script src="..."> to avoid race with CDN);
    // we inject Paged.js deterministically with page.addScriptTag after setContent.
    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>PDF Preview</title>
          <style>
            @page {
              size: ${pageSize};
              margin: ${pageMargin};
            }
            html, body {
              padding: 0;
              margin: 0;
            }
            body {
              font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Helvetica Neue', Arial, 'Noto Sans', 'Liberation Sans', sans-serif;
              line-height: 1.6;
              color: #333;
            }

            /* User-provided styles */
            ${cssStyles}

            /* Ensure overlays don't capture events or affect layout */
            ._overlay-header, ._overlay-footer {
              pointer-events: none;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
      </html>
    `;

    browser = await launchBrowser();
    const page = await browser.newPage();

    // Debug console from the headless page
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));

    // Use print CSS rules
    await page.emulateMediaType('print');

    // Load content and wait for network to settle (fonts, images, etc.)
    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 45000 });

    // 1) Explicitly load Paged.js (CDN or local). If this fails, we proceed without pagination.
    try {
      if (/^https?:\/\//i.test(pagedJsUrl)) {
        await page.addScriptTag({ url: pagedJsUrl });
      } else {
        // Treat as file path within the container
        await page.addScriptTag({ path: pagedJsUrl });
      }
    } catch (e) {
      console.warn('Failed to load Paged.js:', e?.message || e);
    }

    // 2) Start Paged and await afterRendered via a Promise.
    const totalPagesFromPaged = await page.evaluate(async () => {
      if (!window.Paged || !window.PagedPolyfill) return -1;

      return await new Promise((resolve) => {
        try {
          class DoneHandler extends window.Paged.Handlers.Base {
            afterRendered(flow) {
              const total = (flow && flow.total) || 0;
              // mark for debugging/inspection (not relied upon for flow)
              document.documentElement.setAttribute('data-pagedjs-rendered', 'true');
              document.documentElement.setAttribute('data-total-pages', String(total));
              // Let DOM settle at least one cycle
              setTimeout(() => resolve(total), 0);
            }
          }
          window.Paged.registerHandlers(DoneHandler);
          window.PagedPolyfill.preview().catch(() => resolve(-1));
          // Safety timeout to avoid hanging forever
          setTimeout(() => resolve(-1), 15000);
        } catch (err) {
          resolve(-1);
        }
      });
    });

    console.log('Paged afterRendered totalPages =', totalPagesFromPaged);

    // 3) Double-check stability to avoid off-by-one issues while Paged finalizes spreads/blank pages.
    const stableCount = await waitForStablePageCount(page, 3, 250, 6000);
    console.log('Paged stable page count =', stableCount);

    // 4) Paint overlays (headers/footers) **after** pagination is done/stable.
    await page.evaluate((settings) => {
      // Skip deliberate blank pages to keep numbering aligned with actual content pages.
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
        el.innerHTML = tpl
          .replace(/%p/g, String(pageNum))
          .replace(/%P/g, String(lastPage));

        // Base overlay styles
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.right = '0';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = which === 'header' ? settings.headerJustify : settings.footerJustify;
        el.style.fontSize = which === 'header' ? settings.headerFontSize : settings.footerFontSize;
        el.style.color = which === 'header' ? settings.headerColor : settings.footerColor;
        el.style.height = which === 'header' ? settings.headerHeight : settings.footerHeight;
        el.style.overflow = 'visible';
        el.style.zIndex = '2147483647';

        // Paint into margins using translateY instead of negative top/bottom to avoid weird layout behavior.
        if (which === 'header') {
          el.style.top = '0';
          el.style.transform = 'translateY(' + ('-' + settings.headerOffset) + ')';
        } else {
          el.style.bottom = '0';
          el.style.transform = 'translateY(' + settings.footerOffset + ')';
        }
        return el;
      };

      if (pages.length === 0) {
        // Fallback single-page: treat <body> as a page
        const body = document.body;
        const pageNum = 1;
        body.style.position = 'relative';
        body.style.overflow = 'visible';
        if (shouldShow('header', pageNum, 1)) {
          const h = makeOverlay('header', pageNum, 1);
          if (h) body.appendChild(h);
        }
        if (shouldShow('footer', pageNum, 1)) {
          const f = makeOverlay('footer', pageNum, 1);
          if (f) body.appendChild(f);
        }
        return;
      }

      const last = totalPages;
      pages.forEach((pageEl, i) => {
        const pageNum = i + 1;
        pageEl.style.position = 'relative';
        pageEl.style.overflow = 'visible';
        if (shouldShow('header', pageNum, last)) {
          const h = makeOverlay('header', pageNum, last);
          if (h) pageEl.appendChild(h);
        }
        if (shouldShow('footer', pageNum, last)) {
          const f = makeOverlay('footer', pageNum, last);
          if (f) pageEl.appendChild(f);
        }
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
      headerOffset: String(headerOffset).replace(/^\+/, ''), // ensure positive length; we add +/- via transform
      footerOffset: String(footerOffset).replace(/^\+/, ''),
    });

    // 5) Export the PDF
    const pdfBuffer = await page.pdf({
      format: pageSize || 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });

    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=preview.pdf');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF Generation Error:', error);
    if (browser) {
      try { await browser.close(); } catch {}
    }
    res.status(500).send(`Failed to generate PDF: ${error.message}`);
  }
});
