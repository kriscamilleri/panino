// Image operations of the v1 API (docs/specs/proposed/ai-api-expansion.md §4.5): list,
// read, usage, upload and delete-if-unused, per database (personal or a space).
// Storing, listing, usage and deletion are the app's own functions in image.js, so the
// limits, quota, upload roots and UUID storage names are the app's. On top of them the
// API checks that uploaded bytes are the type they claim to be (the app does not).
import fs from 'fs';
import { validate as validateUuid } from 'uuid';
import {
    allowedMimeForFilename,
    databaseImageTarget,
    decodeImageListCursor,
    deleteImageRecordAndFile,
    findImage,
    getImageStats,
    getImageUsage,
    getImageUsageCount,
    IMAGE_LIST_SORTS,
    IMAGE_PRUNE_MIN_AGE_DAYS,
    ImageStoreError,
    isAllowedMime,
    listImages as listDatabaseImages,
    matchesAllowedExtension,
    MAX_IMAGE_SIZE_BYTES,
    storeImage,
} from '../../image.js';
import { resolveStoredImagePath, toCanonicalImageUrl } from '../../spaceStorage.js';
import { apiBaseUrl } from './config.js';
import { announce, ApiError, reachableTargets, requireAgentScope, resolveOne, writableDb } from './serviceCore.js';

export { IMAGE_PRUNE_MIN_AGE_DAYS, MAX_IMAGE_SIZE_BYTES };

/** Most Documents get_image_usage and IMAGE_IN_USE list. */
export const USAGE_LIST_CAP = 50;
const MAX_FILENAME_LENGTH = 255;
const MAX_SEARCH_LENGTH = 200;
const IMAGE_COLUMNS = 'id, filename, mime_type, size_bytes, created_at, path';

const imageNotFound = () => new ApiError(404, 'IMAGE_NOT_FOUND', 'Image not found.');
const fileMissing = () => new ApiError(404, 'IMAGE_FILE_MISSING', 'The image\'s file is not on the server.');
const tooLarge = () => new ApiError(413, 'IMAGE_TOO_LARGE', 'Images can be at most 1 MB.');
const typeNotAllowed = () => new ApiError(415, 'IMAGE_TYPE_NOT_ALLOWED',
    'Only PNG, JPEG, GIF, WebP and SVG images are allowed.');
const extensionMismatch = () => new ApiError(400, 'IMAGE_EXTENSION_MISMATCH',
    'The filename\'s extension does not match the image type.');
const quotaExceeded = () => new ApiError(413, 'IMAGE_QUOTA_EXCEEDED', 'This database\'s image storage is full.');

/** The ApiError for one of storeImage's refusals. */
function storeRefusal(error) {
    switch (error.code) {
        case 'IMAGE_TYPE_NOT_ALLOWED': return typeNotAllowed();
        case 'IMAGE_EXTENSION_MISMATCH': return extensionMismatch();
        case 'IMAGE_TOO_LARGE': return tooLarge();
        case 'IMAGE_QUOTA_EXCEEDED': return quotaExceeded();
        default: return error;
    }
}

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/**
 * The path the app's own links start with: in production the API sits under
 * `/api` on the app's origin, and the editor writes `/api/images/<id>` there
 * (frontend Editor.vue). A bare `/images/<id>` would resolve against the app's
 * origin and miss the API. In development the API has its own origin and the
 * prefix is empty, which the Preview resolves against that origin.
 */
function linkPrefix() {
    const base = apiBaseUrl();
    if (!base) return '';
    try {
        return new URL(base).pathname.replace(/\/+$/, '');
    } catch {
        return '';
    }
}

/** Markdown alt text: brackets and backslashes escaped so the link stays one link. */
function altText(filename) {
    return String(filename || 'Image').replace(/[\\[\]]/g, '\\$&');
}

/** The Markdown that shows an image in a Document of its database. */
export function imageMarkdown(filename, imageId, dbKey) {
    return `![${altText(filename)}](${linkPrefix()}${toCanonicalImageUrl(imageId, dbKey)})`;
}

function imageShape(row, target, usageCount) {
    return {
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type ?? row.mimeType,
        sizeBytes: Number((row.size_bytes ?? row.sizeBytes) || 0),
        createdAt: row.created_at ?? row.createdAt,
        usageCount,
        url: toCanonicalImageUrl(row.id, target.dbKey),
        markdown: imageMarkdown(row.filename, row.id, target.dbKey),
        space: target.spaceId,
    };
}

function usageDocuments(usage) {
    return usage.notes.map((note) => ({ id: note.id, title: note.title, updatedAt: note.updatedAt }));
}

/* ------------------------------------------------------------------ *
 * Finding an image
 * ------------------------------------------------------------------ */

const imageTargetOf = (ctx, target, db = target.db) => databaseImageTarget(target.dbKey, db, ctx.userId);

/**
 * The database holding an image. With `space` given it is that database;
 * without, every reachable database is searched, as for Documents. An image in
 * a space the agent cannot reach is not found.
 */
function locateImage(ctx, space, id) {
    if (typeof id !== 'string' || !validateUuid(id)) throw imageNotFound();
    const candidates = space === undefined || space === null || space === '' ? reachableTargets(ctx) : [resolveOne(ctx, space)];
    for (const target of candidates) {
        const row = findImage(imageTargetOf(ctx, target), id, IMAGE_COLUMNS);
        if (row) return { target, row };
    }
    throw imageNotFound();
}

function storedFile(target, row) {
    const absolutePath = row.path ? resolveStoredImagePath(target.dbKey, row.path) : null;
    if (!absolutePath) throw fileMissing();
    let stat;
    try {
        stat = fs.statSync(absolutePath);
    } catch {
        throw fileMissing();
    }
    if (!stat.isFile()) throw fileMissing();
    return { absolutePath, sizeOnDisk: stat.size };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** One page of a database's images, with its totals and quota. */
export function listImages(ctx, { space, search, sort, cursor, limit } = {}) {
    const target = resolveOne(ctx, space);
    if (search !== undefined && (typeof search !== 'string' || search.length > MAX_SEARCH_LENGTH)) {
        throw new ApiError(400, 'INVALID_INPUT', 'search must be text of at most 200 characters.');
    }
    if (sort !== undefined && sort !== '' && !IMAGE_LIST_SORTS.includes(sort)) {
        throw new ApiError(400, 'INVALID_INPUT', `sort must be one of ${IMAGE_LIST_SORTS.join(', ')}.`);
    }
    const effectiveSort = sort || 'created_desc';
    let position = null;
    if (cursor !== undefined && cursor !== null && cursor !== '') {
        position = typeof cursor === 'string' ? decodeImageListCursor(cursor) : null;
        if (!position || position.sort !== effectiveSort || !position.id) {
            throw new ApiError(400, 'INVALID_INPUT', 'The cursor is not valid. Use next_cursor from the previous call with the same sort.');
        }
    }
    const imageTarget = imageTargetOf(ctx, target);
    const page = listDatabaseImages(imageTarget, {
        limit, search: (search || '').trim(), sort: effectiveSort, cursor: position,
    });
    return {
        images: page.images.map((image) => ({
            ...image,
            markdown: imageMarkdown(image.filename, image.id, target.dbKey),
            space: target.spaceId,
        })),
        nextCursor: page.nextCursor,
        stats: getImageStats(imageTarget),
        space: target.spaceId,
    };
}

/** An image's metadata and the path of its file, checked to exist inside its upload root. */
export function locateImageFile(ctx, { id, space } = {}) {
    const { target, row } = locateImage(ctx, space, id);
    const { absolutePath, sizeOnDisk } = storedFile(target, row);
    const usageCount = getImageUsageCount(target.db, row.id);
    return { image: imageShape(row, target, usageCount), absolutePath, sizeOnDisk, storedMimeType: row.mime_type };
}

/**
 * An image's metadata and bytes, for a result that carries them (MCP). Limited
 * to the upload limit, and only for a stored type on the upload allow-list.
 */
export function readImage(ctx, { id, space } = {}) {
    const { image, absolutePath, sizeOnDisk, storedMimeType } = locateImageFile(ctx, { id, space });
    if (!isAllowedMime(storedMimeType)) throw typeNotAllowed();
    if (sizeOnDisk > MAX_IMAGE_SIZE_BYTES) throw tooLarge();
    let buffer;
    try {
        buffer = fs.readFileSync(absolutePath);
    } catch {
        throw fileMissing();
    }
    return { image: { ...image, mimeType: String(storedMimeType).toLowerCase() }, buffer };
}

/** The Documents in the image's database whose text references it. */
export function getImageUsageReport(ctx, { id, space } = {}) {
    const { target, row } = locateImage(ctx, space, id);
    const usage = getImageUsage(target.db, row.id, { limit: USAGE_LIST_CAP });
    return {
        image: imageShape(row, target, usage.count),
        usageCount: usage.count,
        documents: usageDocuments(usage),
        truncated: usage.count > usage.notes.length,
    };
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * An SVG document: UTF-8 text whose root element is <svg>, after an optional
 * BOM, XML declaration, comments and a DOCTYPE without an internal subset (no
 * entity definitions).
 */
function looksLikeSvg(buffer) {
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        return false;
    }
    let rest = text.replace(/^\uFEFF/, '');
    const prolog = /^\s*(?:<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE\s+svg\b[^[>]*>)/i;
    for (let match = prolog.exec(rest); match; match = prolog.exec(rest)) rest = rest.slice(match[0].length);
    rest = rest.trimStart();
    if (!/^<svg[\s/>]/.test(rest)) return false;
    return /<\/svg\s*>\s*$/.test(rest) || /^<svg\b[^>]*\/>\s*$/.test(rest);
}

/** @returns {boolean} the bytes start the way an image of this type does */
export function bytesMatchType(buffer, mimeType) {
    switch (mimeType) {
        case 'image/png':
            return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
        case 'image/jpeg':
            return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
        case 'image/gif': {
            const head = buffer.subarray(0, 6).toString('latin1');
            return head === 'GIF87a' || head === 'GIF89a';
        }
        case 'image/webp':
            return buffer.length >= 12
                && buffer.subarray(0, 4).toString('latin1') === 'RIFF'
                && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
        case 'image/svg+xml':
            return looksLikeSvg(buffer);
        default:
            return false;
    }
}

function requireFilename(value) {
    if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, 'INVALID_INPUT', 'filename is required, for example "diagram.png".');
    const filename = value.trim();
    // eslint-disable-next-line no-control-regex
    if (filename.length > MAX_FILENAME_LENGTH || /[\u0000-\u001f\u007f/\\]/.test(filename)) {
        throw new ApiError(400, 'INVALID_INPUT', 'filename must be one line of at most 255 characters, without slashes.');
    }
    return filename;
}

/** The base64 text of `data` (a data: URL prefix is allowed) as bytes, within the size limit. */
export function decodeImageData(data) {
    if (typeof data !== 'string' || !data) throw new ApiError(400, 'INVALID_INPUT', 'data must be the image\'s bytes as base64 text.');
    // Base64 of the largest allowed image, with room for line breaks and a data: prefix.
    if (data.length > Math.ceil(MAX_IMAGE_SIZE_BYTES / 3) * 4 * 1.1 + 200) throw tooLarge();
    const encoded = data.replace(/^data:[\w.+-]+\/[\w.+-]+;base64,/i, '').replace(/\s+/g, '');
    if (!encoded || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
        throw new ApiError(400, 'INVALID_INPUT', 'data must be the image\'s bytes as base64 text.');
    }
    const buffer = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (buffer.length > MAX_IMAGE_SIZE_BYTES) throw tooLarge();
    return buffer;
}

/** Refuse a read-only connection or an unreachable space before an upload is read. */
export function assertCanUpload(ctx, space) {
    requireAgentScope(ctx, 'write');
    resolveOne(ctx, space);
}

/**
 * Store an image in a database, with the app's checks (allow-list, extension,
 * 1 MB, quota) through the app's own storing code, after checking the bytes are
 * the declared type. `mimeType` may be left out: the filename's extension says.
 * Give the bytes as `buffer` (multipart) or base64 `data` (JSON, MCP).
 */
export function uploadImage(ctx, { space, filename, mimeType, data, buffer } = {}) {
    requireAgentScope(ctx, 'write');
    const target = resolveOne(ctx, space);
    const name = requireFilename(filename);
    let type;
    if (mimeType === undefined || mimeType === null || mimeType === '') {
        type = allowedMimeForFilename(name);
        if (!type) throw typeNotAllowed();
    } else {
        if (typeof mimeType !== 'string') throw new ApiError(400, 'INVALID_INPUT', 'mimeType must be text.');
        type = mimeType.trim().toLowerCase();
    }
    if (!isAllowedMime(type)) throw typeNotAllowed();
    if (!matchesAllowedExtension(type, name)) throw extensionMismatch();

    const bytes = buffer === undefined ? decodeImageData(data) : buffer;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new ApiError(400, 'INVALID_INPUT', 'The image is empty.');
    if (bytes.length > MAX_IMAGE_SIZE_BYTES) throw tooLarge();
    if (!bytesMatchType(bytes, type)) {
        throw new ApiError(400, 'IMAGE_CONTENT_MISMATCH', 'The bytes are not an image of the declared type.');
    }

    const imageTarget = imageTargetOf(ctx, target, writableDb(target, 'upload-image'));
    let stored;
    try {
        stored = storeImage(imageTarget, { buffer: bytes, originalName: name, mimeType: type });
    } catch (error) {
        if (error instanceof ImageStoreError) throw storeRefusal(error);
        throw error;
    }
    announce(ctx, target);
    return { image: imageShape(stored, target, 0), pruneAfterDays: IMAGE_PRUNE_MIN_AGE_DAYS };
}

/* ------------------------------------------------------------------ *
 * Delete
 * ------------------------------------------------------------------ */

/**
 * Delete an image no Document in its database references: the row and the
 * file, through the app's own deletion. Permanent. Refused while in use.
 */
export function deleteImage(ctx, { id, space } = {}) {
    requireAgentScope(ctx, 'write');
    const { target } = locateImage(ctx, space, id);
    const db = writableDb(target, 'delete-image');
    const imageTarget = imageTargetOf(ctx, target, db);
    const row = findImage(imageTarget, id, IMAGE_COLUMNS);
    if (!row) throw imageNotFound();

    const usage = getImageUsage(db, row.id, { limit: USAGE_LIST_CAP });
    if (usage.count > 0) {
        throw new ApiError(409, 'IMAGE_IN_USE', 'Documents still reference this image.', {
            usageCount: usage.count,
            documents: usageDocuments(usage),
        });
    }

    const deletion = deleteImageRecordAndFile({ target: imageTarget, imageId: row.id });
    if (!deletion.deleted) throw deletion.reason === 'not-found' ? imageNotFound() : fileMissing();
    console.info('[images]', JSON.stringify({
        event: 'image_prune_delete',
        dbKind: target.kind === 'space' ? 'space' : 'user',
        imageId: `${String(row.id).slice(0, 2)}…${String(row.id).slice(-2)}`,
        reason: 'api-delete',
        syncBit: 0,
    }));
    announce(ctx, target);
    return { deleted: true, image: imageShape(row, target, 0) };
}
