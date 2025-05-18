// src/utils/PdfLayoutManager.js

/**
 * Utility class for managing PDF layout and rendering
 * Enhances jsPDF with better content layout and image handling
 */
export class PdfLayoutManager {
    constructor(options = {}) {
        this.options = {
            pageSize: 'a4',
            orientation: 'portrait',
            margins: { top: 50, right: 40, bottom: 50, left: 40 },
            contentWidth: 515, // Default A4 content width in points
            imagePlaceholderText: '[Image]',
            ...options
        };

        this.fontSizes = {
            h1: 24,
            h2: 18,
            h3: 16,
            h4: 14,
            body: 12,
            small: 10,
            footer: 9
        };
    }

    /**
     * Process a DOM node to improve its layout for PDF generation
     * @param {HTMLElement} element - The DOM element to process
     * @returns {HTMLElement} - The processed element
     */
    processElement(element) {
        if (!element) return element;

        // Create a clone to avoid modifying the original
        const clone = element.cloneNode(true);

        // Fix container width
        clone.style.width = `${this.options.contentWidth}px`;
        clone.style.maxWidth = '100%';
        clone.style.margin = '0 auto';
        clone.style.padding = '0';

        // Process images
        const images = clone.querySelectorAll('img');
        images.forEach(img => {
            this.processImage(img);
        });

        // Improve list rendering
        const lists = clone.querySelectorAll('ul, ol');
        lists.forEach(list => {
            list.style.paddingLeft = '30px';
            list.style.marginTop = '10px';
            list.style.marginBottom = '10px';
        });

        // Enhance code blocks
        const codeBlocks = clone.querySelectorAll('pre, code');
        codeBlocks.forEach(block => {
            block.style.backgroundColor = '#f5f5f5';
            block.style.padding = '10px';
            block.style.borderRadius = '4px';
            block.style.fontFamily = 'monospace';
            block.style.whiteSpace = 'pre-wrap';
            block.style.marginTop = '10px';
            block.style.marginBottom = '10px';
            block.style.width = '100%';
        });

        // Improve tables
        const tables = clone.querySelectorAll('table');
        tables.forEach(table => {
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';
            table.style.marginTop = '10px';
            table.style.marginBottom = '10px';

            const cells = table.querySelectorAll('th, td');
            cells.forEach(cell => {
                cell.style.border = '1px solid #ddd';
                cell.style.padding = '8px';
                cell.style.textAlign = 'left';
            });

            const headers = table.querySelectorAll('th');
            headers.forEach(header => {
                header.style.backgroundColor = '#f2f2f2';
                header.style.fontWeight = 'bold';
            });
        });

        // Improve links
        const links = clone.querySelectorAll('a');
        links.forEach(link => {
            link.style.color = '#0366d6';
            link.style.textDecoration = 'underline';
        });

        // Improve blockquotes
        const blockquotes = clone.querySelectorAll('blockquote');
        blockquotes.forEach(quote => {
            quote.style.borderLeft = '4px solid #ddd';
            quote.style.paddingLeft = '15px';
            quote.style.marginLeft = '0';
            quote.style.fontStyle = 'italic';
            quote.style.color = '#555';
        });

        return clone;
    }

    /**
     * Process an image element for better PDF rendering
     * @param {HTMLImageElement} img - The image element to process
     */
    processImage(img) {
        // Set maximum dimensions
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.objectFit = 'contain';

        // Add margin for spacing
        img.style.marginTop = '10px';
        img.style.marginBottom = '10px';
        img.style.display = 'block';

        // Handle base64 images - make sure the src is properly formatted
        if (img.src && img.src.startsWith('data:')) {
            // Fix any broken base64 data URIs
            if (img.src.includes('data:image') && !img.src.includes(';base64,')) {
                const parts = img.src.split(',');
                if (parts.length === 2) {
                    img.src = `data:image/png;base64,${parts[1].trim()}`;
                }
            }
        }

        // Add placeholder text for failed images
        img.onerror = () => {
            img.outerHTML = `<div style="padding: 20px; background-color: #f8f8f8; text-align: center; color: #888; border: 1px dashed #ccc;">${this.options.imagePlaceholderText}</div>`;
        };
    }

    /**
     * Create HTML wrapper with optimized styles for better PDF rendering
     * @param {string} content - HTML content to wrap
     * @param {Object} metadata - Metadata for the document
     * @returns {string} - Optimized HTML
     */
    createOptimizedHtml(content, metadata = {}) {
        const { title = 'Document' } = metadata;

        return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <style>
            @page {
              margin: 0;
              size: ${this.options.pageSize} ${this.options.orientation};
            }
            
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              line-height: 1.5;
              color: #333;
              margin: 0;
              padding: 0;
              width: 100%;
            }
            
            .container {
              width: ${this.options.contentWidth}px;
              max-width: 100%;
              margin: 0 auto;
              padding: ${this.options.margins.top}px ${this.options.margins.right}px ${this.options.margins.bottom}px ${this.options.margins.left}px;
            }
            
            h1 { font-size: ${this.fontSizes.h1}px; margin-top: 24px; margin-bottom: 16px; font-weight: bold; }
            h2 { font-size: ${this.fontSizes.h2}px; margin-top: 20px; margin-bottom: 14px; font-weight: bold; }
            h3 { font-size: ${this.fontSizes.h3}px; margin-top: 16px; margin-bottom: 12px; font-weight: bold; }
            h4 { font-size: ${this.fontSizes.h4}px; margin-top: 14px; margin-bottom: 10px; font-weight: bold; }
            
            p { margin-top: 8px; margin-bottom: 8px; }
            
            ul, ol { padding-left: 30px; margin-top: 10px; margin-bottom: 10px; }
            li { margin-bottom: 6px; }
            
            pre, code {
              font-family: SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace;
              background-color: #f6f8fa;
              border-radius: 3px;
            }
            
            code {
              padding: 2px 4px;
              font-size: 90%;
            }
            
            pre {
              padding: 16px;
              overflow: auto;
              line-height: 1.45;
              word-wrap: normal;
              margin-top: 10px;
              margin-bottom: 10px;
            }
            
            pre code {
              padding: 0;
              background-color: transparent;
            }
            
            blockquote {
              margin-left: 0;
              padding-left: 16px;
              border-left: 4px solid #ddd;
              color: #555;
              font-style: italic;
            }
            
            img {
              max-width: 100%;
              height: auto;
              display: block;
              margin: 16px auto;
            }
            
            table {
              border-collapse: collapse;
              width: 100%;
              margin-top: 16px;
              margin-bottom: 16px;
            }
            
            table, th, td {
              border: 1px solid #ddd;
            }
            
            th, td {
              padding: 8px;
              text-align: left;
            }
            
            th {
              background-color: #f0f0f0;
              font-weight: bold;
            }
            
            a {
              color: #0366d6;
              text-decoration: underline;
            }
            
            hr {
              height: 1px;
              background-color: #ddd;
              border: none;
              margin: 16px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            ${content}
          </div>
        </body>
        </html>
      `;
    }
}

export default PdfLayoutManager;