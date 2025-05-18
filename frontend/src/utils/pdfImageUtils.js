// src/utils/pdfImageUtils.js

/**
 * Utility functions for handling images in PDF exports
 */

/**
 * Creates a data URL for a provided image source
 * Works with URLs, base64 strings, or Blob/File objects
 * 
 * @param {string|File|Blob} source - Image source 
 * @param {number} maxWidth - Maximum width in pixels
 * @param {number} maxHeight - Maximum height in pixels
 * @returns {Promise<string>} - Promise resolving to data URL
 */
export async function createImageDataUrl(source, maxWidth = 200, maxHeight = 60) {
    return new Promise((resolve, reject) => {
        // If source is already a data URL, optimize it if needed
        if (typeof source === 'string' && source.startsWith('data:')) {
            if (source.length > 100000) {
                // Very large data URL, resize it
                resizeDataUrlImage(source, maxWidth, maxHeight)
                    .then(resolve)
                    .catch(reject);
            } else {
                // Small enough data URL, use as is
                resolve(source);
            }
            return;
        }

        // For blob/file or URL sources, load into an image element
        const img = new Image();
        img.crossOrigin = 'Anonymous';

        img.onload = () => {
            // Resize if needed
            if (img.width > maxWidth || img.height > maxHeight) {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Calculate dimensions while maintaining aspect ratio
                const ratio = Math.min(maxWidth / img.width, maxHeight / img.height);
                const width = Math.round(img.width * ratio);
                const height = Math.round(img.height * ratio);

                canvas.width = width;
                canvas.height = height;

                // Draw and convert to data URL
                ctx.drawImage(img, 0, 0, width, height);
                try {
                    const dataUrl = canvas.toDataURL('image/png');
                    resolve(dataUrl);
                } catch (err) {
                    reject(new Error('Failed to convert image: ' + err.message));
                }
            } else {
                // Image is already small enough, convert directly
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                canvas.width = img.width;
                canvas.height = img.height;

                ctx.drawImage(img, 0, 0);
                try {
                    const dataUrl = canvas.toDataURL('image/png');
                    resolve(dataUrl);
                } catch (err) {
                    reject(new Error('Failed to convert image: ' + err.message));
                }
            }
        };

        img.onerror = () => {
            reject(new Error('Failed to load image'));
        };

        // Set source based on type
        if (source instanceof Blob || source instanceof File) {
            img.src = URL.createObjectURL(source);
        } else {
            img.src = source;
        }
    });
}

/**
 * Resize an existing data URL image
 * 
 * @param {string} dataUrl - Image data URL
 * @param {number} maxWidth - Maximum width in pixels 
 * @param {number} maxHeight - Maximum height in pixels
 * @returns {Promise<string>} - Promise resolving to resized data URL
 */
export function resizeDataUrlImage(dataUrl, maxWidth = 200, maxHeight = 60) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            // Resize if needed
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Calculate dimensions while maintaining aspect ratio
            const ratio = Math.min(maxWidth / img.width, maxHeight / img.height);
            const width = Math.round(img.width * ratio);
            const height = Math.round(img.height * ratio);

            canvas.width = width;
            canvas.height = height;

            // Draw and convert to data URL
            ctx.drawImage(img, 0, 0, width, height);
            try {
                const newDataUrl = canvas.toDataURL('image/png');
                resolve(newDataUrl);
            } catch (err) {
                reject(new Error('Failed to resize image: ' + err.message));
            }
        };

        img.onerror = () => {
            reject(new Error('Failed to load image from data URL'));
        };

        img.src = dataUrl;
    });
}

/**
 * Converts header/footer image content to usable form for PDF generation
 * 
 * @param {Object} settings - Print settings object
 * @returns {Promise<Object>} - Object with processed header/footer content 
 */
export async function processHeaderFooterImages(settings) {
    const result = {
        headerContent: { left: '', right: '' },
        footerContent: { left: '', right: '' }
    };

    try {
        // Process header left
        if (settings.pageHeaderLeftType === 'image' && settings.pageHeaderLeftContent) {
            const dataUrl = await createImageDataUrl(settings.pageHeaderLeftContent, 150, 40);
            // We'll handle this in the PDF generator
            result.headerContent.leftImage = dataUrl;
        } else if (settings.pageHeaderLeftType === 'text') {
            result.headerContent.left = settings.pageHeaderLeftContent || '';
        }

        // Process header right
        if (settings.pageHeaderRightType === 'image' && settings.pageHeaderRightContent) {
            const dataUrl = await createImageDataUrl(settings.pageHeaderRightContent, 150, 40);
            result.headerContent.rightImage = dataUrl;
        } else if (settings.pageHeaderRightType === 'text') {
            result.headerContent.right = settings.pageHeaderRightContent || '';
        }

        // Process footer left
        if (settings.pageFooterLeftType === 'image' && settings.pageFooterLeftContent) {
            const dataUrl = await createImageDataUrl(settings.pageFooterLeftContent, 150, 40);
            result.footerContent.leftImage = dataUrl;
        } else if (settings.pageFooterLeftType === 'text') {
            result.footerContent.left = settings.pageFooterLeftContent || '';
        }

        // Process footer right
        if (settings.pageFooterRightType === 'image' && settings.pageFooterRightContent) {
            const dataUrl = await createImageDataUrl(settings.pageFooterRightContent, 150, 40);
            result.footerContent.rightImage = dataUrl;
        } else if (settings.pageFooterRightType === 'text') {
            result.footerContent.right = settings.pageFooterRightContent || 'Page {page} of {total}';
        }
    } catch (error) {
        console.error('Error processing header/footer images:', error);
    }

    return result;
}

/**
 * Pre-processes images in HTML content to ensure they're properly loaded
 * This function fixes broken base64 images that are common in PDF output
 * 
 * @param {string} htmlContent - HTML content with images
 * @returns {Promise<string>} - HTML with processed images
 */
export async function preProcessHtmlImages(htmlContent) {
    // Create a temporary DOM element
    const container = document.createElement('div');
    container.innerHTML = htmlContent;

    // Look for broken base64 image data
    const baseImageRegex = /data:image\/\w+;base64,(\S+)/g;
    let textNodes = [];

    // Find all text nodes that might contain broken base64 data
    // This is a common issue when inline images are improperly rendered
    const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    while (walker.nextNode()) {
        const textNode = walker.currentNode;
        if (textNode.nodeValue.includes('data:image') && textNode.nodeValue.includes('base64')) {
            textNodes.push(textNode);
        }
    }

    // Replace text nodes containing base64 image data with actual images
    for (const textNode of textNodes) {
        const text = textNode.nodeValue;
        const matches = [...text.matchAll(baseImageRegex)];

        if (matches.length) {
            const parent = textNode.parentNode;
            const nextSibling = textNode.nextSibling;
            parent.removeChild(textNode);

            let lastIndex = 0;

            for (const match of matches) {
                // Add text before the match
                if (match.index > lastIndex) {
                    parent.insertBefore(
                        document.createTextNode(text.substring(lastIndex, match.index)),
                        nextSibling
                    );
                }

                // Create and add the image element
                try {
                    const img = document.createElement('img');
                    img.src = match[0]; // The full data URI
                    img.style.maxWidth = '100%';
                    img.style.height = 'auto';
                    img.style.display = 'block';
                    img.style.margin = '10px auto';

                    parent.insertBefore(img, nextSibling);
                } catch (err) {
                    console.warn('Error creating image from base64 data:', err);
                    parent.insertBefore(
                        document.createTextNode('[Image Processing Error]'),
                        nextSibling
                    );
                }

                lastIndex = match.index + match[0].length;
            }

            // Add any remaining text
            if (lastIndex < text.length) {
                parent.insertBefore(
                    document.createTextNode(text.substring(lastIndex)),
                    nextSibling
                );
            }
        }
    }

    // Find all images
    const images = container.querySelectorAll('img');
    if (images.length === 0) {
        return htmlContent; // No images to process
    }

    // Process each image
    const imagePromises = Array.from(images).map(async (img) => {
        try {
            // Fix broken/cut-off base64 images
            if (img.src.includes('data:image') && !img.src.includes(';base64,')) {
                const parts = img.src.split('data:image');
                if (parts.length > 1) {
                    // Try to reconstruct the base64 URL
                    const typeAndDataParts = parts[1].split(',');
                    if (typeAndDataParts.length === 2) {
                        const mimeType = typeAndDataParts[0].trim();
                        const base64Data = typeAndDataParts[1].trim();
                        img.src = `data:image${mimeType};base64,${base64Data}`;
                    }
                }
            }

            // Ensure image has dimensions constraint for better PDF rendering
            if (!img.hasAttribute('style')) {
                img.setAttribute('style', 'max-width: 100%; height: auto; display: block; margin: 1em auto;');
            }
        } catch (error) {
            console.warn('Failed to process image:', error);
            // Replace with placeholder for broken image
            img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlZWVlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgZmlsbD0iIzk5OTk5OSI+SW1hZ2UgTG9hZCBFcnJvcjwvdGV4dD48L3N2Zz4=';
        }
    });

    // Wait for all images to be processed
    await Promise.all(imagePromises);

    // Return processed HTML
    return container.innerHTML;
}