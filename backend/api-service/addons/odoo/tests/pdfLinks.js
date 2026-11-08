import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';

/** A Document id the tests link to. */
export const LINKED_DOCUMENT = '6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c';

/**
 * The URI link annotations in a PDF, in page order.
 *
 * @param {Uint8Array} buffer
 * @returns {Promise<string[]>}
 */
export async function pdfLinkUris(buffer) {
    const pdf = await PDFDocument.load(buffer);
    const uris = [];
    for (const page of pdf.getPages()) {
        const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
        if (!annots) continue;
        for (let i = 0; i < annots.size(); i += 1) {
            const action = annots.lookup(i, PDFDict).lookupMaybe(PDFName.of('A'), PDFDict);
            const uri = action?.lookup(PDFName.of('URI'));
            if (uri) uris.push(uri.decodeText());
        }
    }
    return uris;
}

/**
 * Run with environment variables set, then restore them.
 *
 * @template T
 * @param {Record<string, string|undefined>} values
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withEnv(values, fn) {
    const saved = {};
    for (const [key, value] of Object.entries(values)) {
        saved[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return await fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}
