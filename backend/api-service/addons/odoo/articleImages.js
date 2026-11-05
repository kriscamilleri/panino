/**
 * Images inside a Knowledge article (docs/specs/active/odoo-integration.md §7, Phase 6).
 * Panino image URLs need a Panino session, so they would break in Odoo. Each of this
 * installation's own images is uploaded as an `ir.attachment` on the article and the
 * `<img src>` rewritten to Odoo's `/web/image/<id>`, which the article's readers may
 * open because the attachment belongs to the article. An image uploaded before (same
 * article, same checksum) is reused, so resends do not pile up attachments.
 */

import crypto from 'node:crypto';
import { JSDOM } from 'jsdom';
import { OdooError, fileField, verifyAttachment } from './client.js';
import { parseInternalImageSource } from '../../pdf.js';

const MODEL = 'knowledge.article';
const ATTACHMENT = 'ir.attachment';
const UPLOAD_LIMITS = { timeoutMs: 60000 };
/** Per image; Knowledge's editor refuses much larger ones too. */
export const MAX_ARTICLE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ARTICLE_IMAGES = 50;
export const IMAGE_PLACEHOLDER = 'Image not sent';

const window = new JSDOM('').window;

function placeholderFor(doc, alt) {
    const span = doc.createElement('span');
    span.className = 'o_panino_image_placeholder';
    span.textContent = alt ? `${IMAGE_PLACEHOLDER}: ${alt}` : IMAGE_PLACEHOLDER;
    return span;
}

/**
 * The internal image sources in a body, in document order, each once.
 *
 * @param {string} body
 * @returns {string[]}
 */
export function internalImageSources(body) {
    const doc = new window.DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');
    const sources = [];
    for (const img of doc.body.querySelectorAll('img[src]')) {
        const src = img.getAttribute('src');
        if (parseInternalImageSource(src) && !sources.includes(src)) sources.push(src);
    }
    return sources;
}

/**
 * Upload the body's internal images onto the article and point the body at them.
 * An image that cannot be read or stored becomes a placeholder and is counted in
 * `missing`; the others still go through. `failed` is the part of `missing` that
 * Odoo refused (a failed upload), as opposed to an image Panino could not read: a
 * sync retries those on its next run.
 *
 * @param {object} options
 * @param {ReturnType<import('./client.js').createOdooClient>} options.client
 * @param {string} options.odooTarget
 * @param {number} options.articleId
 * @param {string} options.body with Panino `<img src>` values
 * @param {(src: string) => ({ imageId: string, mimeType: string, buffer: Buffer } | null)} options.readImage
 * @returns {Promise<{ body: string, uploaded: number, reused: number, missing: number, failed: number }>}
 */
export async function uploadArticleImages({ client, odooTarget, articleId, body, readImage }) {
    const doc = new window.DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');
    const images = [...doc.body.querySelectorAll('img[src]')].filter((img) => parseInternalImageSource(img.getAttribute('src')));
    if (images.length === 0) return { body, uploaded: 0, reused: 0, missing: 0, failed: 0 };

    // Detected on the first upload only: a body whose images all fail to read never calls Odoo.
    let field = null;
    const uploadField = async () => {
        field = field || await fileField(client, odooTarget, ATTACHMENT);
        return field;
    };
    const bySource = new Map();
    let uploaded = 0;
    let reused = 0;
    let missing = 0;
    let failed = 0;
    let count = 0;

    for (const img of images) {
        const src = img.getAttribute('src');
        // `/images/<id>` and `/api/images/<id>?space=…` are the same image: one upload.
        const link = parseInternalImageSource(src);
        const identity = `${link.spaceId || ''}|${link.imageId}`;
        let attachmentId = bySource.get(identity);
        if (attachmentId === undefined) {
            attachmentId = null;
            const image = count < MAX_ARTICLE_IMAGES ? readImage(src) : null;
            count += 1;
            if (image && image.buffer.length > 0 && image.buffer.length <= MAX_ARTICLE_IMAGE_BYTES) {
                try {
                    const result = await findOrUpload(client, uploadField, articleId, image);
                    attachmentId = result.id;
                    if (result.reused) reused += 1;
                    else uploaded += 1;
                } catch (error) {
                    if (!(error instanceof OdooError)) throw error;
                    // A rejected key or a vanished article fails the whole send; a single bad
                    // upload only loses this image.
                    if (['key_rejected', 'access_denied', 'record_gone', 'missing_app', 'blocked', 'unreachable', 'not_odoo'].includes(error.code)) throw error;
                    failed += 1;
                }
            }
            bySource.set(identity, attachmentId);
        }
        if (attachmentId) {
            img.setAttribute('src', `/web/image/${attachmentId}`);
        } else {
            missing += 1;
            img.replaceWith(placeholderFor(doc, img.getAttribute('alt')));
        }
    }
    return { body: doc.body.innerHTML.trim(), uploaded, reused, missing, failed };
}

async function findOrUpload(client, uploadField, articleId, image) {
    const checksum = crypto.createHash('sha1').update(image.buffer).digest('hex');
    const existing = await client.call(ATTACHMENT, 'search_read', {
        domain: [['res_model', '=', MODEL], ['res_id', '=', articleId], ['checksum', '=', checksum]],
        fields: ['id'],
        limit: 1,
    });
    if (Array.isArray(existing) && Number.isInteger(existing[0]?.id)) return { id: existing[0].id, reused: true };

    const field = await uploadField();
    const ids = await client.call(ATTACHMENT, 'create', {
        vals_list: [{
            name: attachmentName(image),
            [field]: image.buffer.toString('base64'),
            mimetype: image.mimeType,
            res_model: MODEL,
            res_id: articleId,
        }],
    }, UPLOAD_LIMITS);
    const id = Array.isArray(ids) ? ids[0] : null;
    if (!Number.isInteger(id)) throw new OdooError('odoo_error');
    await verifyAttachment(client, id, image.buffer);
    return { id, reused: false };
}

function attachmentName(image) {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[image.mimeType] || 'img';
    return `${image.imageId}.${ext}`;
}
