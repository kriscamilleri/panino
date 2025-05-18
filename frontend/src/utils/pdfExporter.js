// PdfExporter.js - A utility class for PDF generation

export class PdfExporter {
    constructor(options = {}) {
        this.options = {
            margins: { top: 40, right: 20, bottom: 40, left: 20 },
            pageSize: 'a4',
            orientation: 'portrait',
            ...options
        };

        // Import dependencies dynamically to avoid global imports
        this.importDependencies();
    }

    async importDependencies() {
        // Dynamic imports for jsPDF and html2canvas
        const [jsPDFModule, html2canvasModule] = await Promise.all([
            import('jspdf'),
            import('html2canvas')
        ]);

        this.jsPDF = jsPDFModule.jsPDF;
        this.html2canvas = html2canvasModule.default;
    }

    async generatePDF(content, metadata = {}) {
        try {
            // Create container element for rendering
            const container = document.createElement('div');
            container.innerHTML = content;
            container.className = 'pdf-content';
            document.body.appendChild(container);

            // Setup properties
            const { title = 'Document', author = 'Markdown Notes', headerContent, footerContent } = metadata;

            // Initialize PDF document
            const pdf = new this.jsPDF({
                orientation: this.options.orientation,
                unit: 'pt',
                format: this.options.pageSize
            });

            // Set document properties
            pdf.setProperties({
                title,
                author,
                subject: 'Exported from Markdown Notes',
                creator: 'PanINO Notes App'
            });

            // Pre-process images to ensure they're correctly loaded
            await this.preProcessImages(container);

            // Get page dimensions
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const contentWidth = pageWidth - this.options.margins.left - this.options.margins.right;

            // Render HTML to canvas
            const canvas = await this.html2canvas(container, {
                scale: 2, // Higher scale for better quality
                useCORS: true, // Allow cross-origin images
                logging: false,
                allowTaint: true,
                letterRendering: true,
                windowWidth: contentWidth
            });

            // Calculate scaling and paging
            const imgData = canvas.toDataURL('image/png');
            const imgWidth = contentWidth;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            const pageCount = Math.ceil(imgHeight / (pageHeight - this.options.margins.top - this.options.margins.bottom));

            // Add content to PDF with paging
            let position = 0;
            for (let i = 0; i < pageCount; i++) {
                // Add new page if not the first page
                if (i > 0) pdf.addPage();

                // Calculate positioning for this page section
                const sourceY = position;
                const sourceHeight = Math.min(canvas.height - sourceY, (pageHeight - this.options.margins.top - this.options.margins.bottom) * canvas.width / imgWidth);
                const destHeight = sourceHeight * imgWidth / canvas.width;

                // Add page content
                pdf.addImage(
                    imgData,
                    'PNG',
                    this.options.margins.left,
                    this.options.margins.top,
                    imgWidth,
                    destHeight,
                    null,
                    'FAST',
                    0,
                    sourceY,
                    canvas.width,
                    sourceHeight
                );

                // Add header if defined
                if (headerContent) {
                    this.addPageHeader(pdf, headerContent, i + 1, pageCount);
                }

                // Add footer if defined
                if (footerContent) {
                    this.addPageFooter(pdf, footerContent, i + 1, pageCount);
                }

                // Update position for next page
                position += sourceHeight;
            }

            // Clean up
            document.body.removeChild(container);

            return pdf;
        } catch (error) {
            console.error('Error generating PDF:', error);
            throw error;
        }
    }

    async preProcessImages(container) {
        // Find all images
        const images = container.querySelectorAll('img');

        // Wait for all images to load
        const promises = Array.from(images).map(img => {
            return new Promise((resolve) => {
                if (img.complete) {
                    resolve();
                } else {
                    img.onload = resolve;
                    img.onerror = () => {
                        // Replace broken images with placeholder
                        img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlZWVlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzk5OTk5OSI+SW1hZ2UgTG9hZCBFcnJvcjwvdGV4dD48L3N2Zz4=';
                        resolve();
                    };
                }
            });
        });

        await Promise.all(promises);

        // Set max width on images to prevent overflow
        images.forEach(img => {
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
        });
    }

    addPageHeader(pdf, headerContent, pageNumber, totalPages) {
        const { left, right, leftImage, rightImage } = typeof headerContent === 'object' ? headerContent : {};
        const pageWidth = pdf.internal.pageSize.getWidth();

        // Save current state
        pdf.saveGraphicsState();

        // Set font for header
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(100, 100, 100);

        // Add left header content (text or image)
        if (leftImage) {
            // Add image to header (left)
            try {
                pdf.addImage(
                    leftImage,
                    'PNG',
                    this.options.margins.left,
                    5,
                    40, // max width for header image
                    15  // max height for header image
                );
            } catch (err) {
                console.error('Error adding header left image:', err);
            }
        } else if (left) {
            if (typeof left === 'function') {
                pdf.text(left(pageNumber, totalPages), this.options.margins.left, 15);
            } else {
                pdf.text(String(left).replace('{page}', pageNumber).replace('{total}', totalPages), this.options.margins.left, 15);
            }
        }

        // Add right header content (text or image)
        if (rightImage) {
            // Add image to header (right)
            try {
                pdf.addImage(
                    rightImage,
                    'PNG',
                    pageWidth - this.options.margins.right - 40, // Position from right margin
                    5,
                    40, // max width for header image
                    15  // max height for header image
                );
            } catch (err) {
                console.error('Error adding header right image:', err);
            }
        } else if (right) {
            const content = typeof right === 'function' ? right(pageNumber, totalPages) : String(right).replace('{page}', pageNumber).replace('{total}', totalPages);
            const rightX = pageWidth - this.options.margins.right - pdf.getTextWidth(content);
            pdf.text(content, rightX, 15);
        }

        // Restore state
        pdf.restoreGraphicsState();
    }

    addPageFooter(pdf, footerContent, pageNumber, totalPages) {
        const { left, right, leftImage, rightImage } = typeof footerContent === 'object' ? footerContent : {};
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        // Save current state
        pdf.saveGraphicsState();

        // Set font for footer
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(100, 100, 100);

        // Add left footer content (text or image)
        if (leftImage) {
            // Add image to footer (left)
            try {
                pdf.addImage(
                    leftImage,
                    'PNG',
                    this.options.margins.left,
                    pageHeight - 20, // Position from bottom
                    40, // max width for footer image
                    15  // max height for footer image
                );
            } catch (err) {
                console.error('Error adding footer left image:', err);
            }
        } else if (left) {
            if (typeof left === 'function') {
                pdf.text(left(pageNumber, totalPages), this.options.margins.left, pageHeight - 10);
            } else {
                pdf.text(String(left).replace('{page}', pageNumber).replace('{total}', totalPages), this.options.margins.left, pageHeight - 10);
            }
        }

        // Add right footer content (text or image)
        if (rightImage) {
            // Add image to footer (right)
            try {
                pdf.addImage(
                    rightImage,
                    'PNG',
                    pageWidth - this.options.margins.right - 40, // Position from right margin
                    pageHeight - 20, // Position from bottom
                    40, // max width for footer image
                    15  // max height for footer image
                );
            } catch (err) {
                console.error('Error adding footer right image:', err);
            }
        } else if (right) {
            const content = typeof right === 'function' ? right(pageNumber, totalPages) : String(right).replace('{page}', pageNumber).replace('{total}', totalPages);
            const rightX = pageWidth - this.options.margins.right - pdf.getTextWidth(content);
            pdf.text(content, rightX, pageHeight - 10);
        } else {
            // Default page numbering if no custom right footer
            const pageText = `Page ${pageNumber} of ${totalPages}`;
            const rightX = pageWidth - this.options.margins.right - pdf.getTextWidth(pageText);
            pdf.text(pageText, rightX, pageHeight - 10);
        }

        // Restore state
        pdf.restoreGraphicsState();
    }

    async exportPDF(content, filename = 'document.pdf', metadata = {}) {
        try {
            const pdf = await this.generatePDF(content, metadata);
            pdf.save(filename);
            return true;
        } catch (error) {
            console.error('Error exporting PDF:', error);
            return false;
        }
    }

    // Renders PDF in a new window
    async previewPDF(content, metadata = {}) {
        try {
            const pdf = await this.generatePDF(content, metadata);
            const blob = pdf.output('blob');
            const pdfUrl = URL.createObjectURL(blob);

            const w = window.open('', '_blank');
            if (!w) {
                throw new Error('Popup was blocked. Please allow popups for this site.');
            }

            w.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>${metadata.title || 'PDF Preview'}</title>
              <style>
                body { margin: 0; padding: 0; }
                iframe { border: none; width: 100vw; height: 100vh; }
              </style>
            </head>
            <body>
              <iframe src="${pdfUrl}"></iframe>
            </body>
          </html>
        `);

            w.document.close();

            // Clean up the URL object when the window is closed
            w.onunload = () => URL.revokeObjectURL(pdfUrl);

            return true;
        } catch (error) {
            console.error('Error previewing PDF:', error);
            throw error;
        }
    }
}

// Helper function to create an exporter with default settings
export function createPdfExporter(options) {
    return new PdfExporter(options);
}