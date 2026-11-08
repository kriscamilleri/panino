// /backend/api-service/image.js
import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getDb, getHealthyDb, listUserDbIds } from './db.js';
import { resolveSpaceAccess } from './spaces.js';
import {
    resolveDatabaseUploadRoot,
    resolveStoredImagePath,
    toCanonicalImageUrl,
} from './spaceStorage.js';

export const imageRoutes = express.Router();

/** Largest image an upload may store, in bytes. */
export const MAX_IMAGE_SIZE_BYTES = 1 * 1024 * 1024;
const IMAGE_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const IMAGE_PRUNE_BATCH_SIZE = 100;
/** The daily prune removes images no Document references once they are this many days old. */
export const IMAGE_PRUNE_MIN_AGE_DAYS = 7;
const QUOTA_BYTES_ENV = Number(process.env.IMAGE_QUOTA_BYTES);
const QUOTA_BYTES = Number.isFinite(QUOTA_BYTES_ENV) && QUOTA_BYTES_ENV > 0 ? QUOTA_BYTES_ENV : null;
const SPACE_QUOTA_BYTES_ENV = Number(process.env.SPACE_IMAGE_QUOTA_BYTES);
const SPACE_QUOTA_BYTES = Number.isFinite(SPACE_QUOTA_BYTES_ENV) && SPACE_QUOTA_BYTES_ENV > 0
    ? SPACE_QUOTA_BYTES_ENV
    : 1024 * 1024 * 1024;

const ALLOWED_MIME_TO_EXTENSIONS = new Map([
    ['image/png', ['.png']],
    ['image/jpeg', ['.jpg', '.jpeg']],
    ['image/gif', ['.gif']],
    ['image/webp', ['.webp']],
    ['image/svg+xml', ['.svg']],
]);

/**
 * Headers for serving a stored image from the application's own origin.
 *
 * An SVG is a document: opened on its own (the preview's "open image in new
 * tab") it runs its scripts in this origin, where the session token is
 * readable. In a shared space the uploader and the viewer are different
 * people. The sandbox policy makes the response an inert document with an
 * opaque origin; inside an <img> nothing changes.
 *
 * The stored type is not trusted either. A personal images row is written
 * through /sync and copied by a Document transfer, so it can claim to be
 * text/html. Anything outside the upload allow-list is sent as a download.
 */
export function setImageResponseHeaders(res, storedMimeType) {
    const mimeType = String(storedMimeType || '').toLowerCase();
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    if (isAllowedMime(mimeType)) {
        res.set('Content-Type', mimeType);
    } else {
        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Disposition', 'attachment');
    }
}

function normalizeExt(filename) {
    const ext = path.extname(filename || '').toLowerCase();
    return ext.startsWith('.') ? ext : `.${ext}`;
}

/** @returns {boolean} the type is on the upload allow-list */
export function isAllowedMime(mimeType) {
    return ALLOWED_MIME_TO_EXTENSIONS.has((mimeType || '').toLowerCase());
}

/** @returns {boolean} the filename's extension is one the allow-list gives this type */
export function matchesAllowedExtension(mimeType, originalName) {
    const allowedExtensions = ALLOWED_MIME_TO_EXTENSIONS.get((mimeType || '').toLowerCase()) || [];
    return allowedExtensions.includes(normalizeExt(originalName));
}

/** @returns {string|null} the allow-listed type a filename's extension stands for */
export function allowedMimeForFilename(filename) {
    const ext = normalizeExt(filename);
    for (const [mimeType, extensions] of ALLOWED_MIME_TO_EXTENSIONS) {
        if (extensions.includes(ext)) return mimeType;
    }
    return null;
}

function getStorageExtension(mimeType) {
    const allowedExtensions = ALLOWED_MIME_TO_EXTENSIONS.get((mimeType || '').toLowerCase()) || [];
    return allowedExtensions[0] || '.bin';
}

/** Repair a multipart filename that arrived as UTF-8 bytes read as Latin-1. */
export function normalizeOriginalFilename(filename) {
    const raw = String(filename || '');
    if (!raw) return raw;

    if (!/[ÃÂâ]/.test(raw)) {
        return raw;
    }

    try {
        return Buffer.from(raw, 'latin1').toString('utf8');
    } catch {
        return raw;
    }
}

function escapeLike(value) {
    return String(value).replace(/[!%_]/g, '!$&');
}

// Every link to an image contains `/images/<id>`: relative, `/api`-prefixed or absolute, with
// or without `?space=`. One LIKE finds them all (it also folds ASCII case, as before).
function imageReferencePattern(imageId) {
    return `%/images/${escapeLike(imageId)}%`;
}

function resolveImageTarget(req, res, operation, { healthy = false } = {}) {
    const userId = req.user.user_id;
    const rawSpaceId = req.query.space;
    if (rawSpaceId === undefined) {
        const dbKey = `user:${userId}`;
        return {
            dbKey,
            db: healthy ? getHealthyDb(dbKey, operation) : getDb(dbKey),
            isSpace: false,
            quotaBytes: QUOTA_BYTES,
            userId,
        };
    }

    // Even rejected qualified requests must not be stored by an intermediary.
    res.set('Cache-Control', 'private, no-store');
    if (typeof rawSpaceId !== 'string') return null;
    const access = resolveSpaceAccess(rawSpaceId, userId);
    if (!access) return null;
    const dbKey = `space:${access.spaceId}`;
    return {
        dbKey,
        db: healthy ? getHealthyDb(dbKey, operation) : getDb(dbKey),
        isSpace: true,
        quotaBytes: SPACE_QUOTA_BYTES,
        userId,
    };
}

function imageScopeClause(target) {
    return target.isSpace ? { sql: '', params: [] } : { sql: ' AND user_id = ?', params: [target.userId] };
}

/**
 * The image target of one database, as resolveImageTarget builds it from a
 * request: `userId` is the personal database's owner, or in a space the person
 * an upload is recorded for.
 *
 * @param {string} dbKey `user:<uuid>` or `space:<uuid>`
 * @param {import('better-sqlite3').Database} db that database's connection (a healthy one for writes)
 * @param {string} userId the acting user
 */
export function databaseImageTarget(dbKey, db, userId) {
    const isSpace = dbKey.startsWith('space:');
    return {
        dbKey,
        db,
        isSpace,
        quotaBytes: isSpace ? SPACE_QUOTA_BYTES : QUOTA_BYTES,
        userId: isSpace ? userId : dbKey.slice('user:'.length),
    };
}

/** An image row of the target's database (personal rows also by owner), or undefined. */
export function findImage(target, imageId, columns = 'id') {
    const scope = imageScopeClause(target);
    return target.db.prepare(`SELECT ${columns} FROM images WHERE id = ?${scope.sql}`).get(imageId, ...scope.params);
}

function imageStats(target) {
    const scope = imageScopeClause(target);
    return target.db.prepare(`
        SELECT COUNT(*) as image_count, COALESCE(SUM(size_bytes), 0) as total_image_bytes
        FROM images
        WHERE 1 = 1${scope.sql}
    `).get(...scope.params);
}

/** What GET /images/stats answers: how many images, their bytes, and the quota (null: unlimited). */
export function getImageStats(target) {
    const stats = imageStats(target);
    return {
        imageCount: Number(stats?.image_count || 0),
        totalImageBytes: Number(stats?.total_image_bytes || 0),
        quotaBytes: target.quotaBytes,
    };
}

/**
 * How much image storage a database holds and may hold. Every path that adds
 * image bytes has to ask, not only the upload route: a Document transfer copies
 * images too, and used to grow a space past its limit unchecked.
 *
 * @param {string} dbKey `user:<uuid>` or `space:<uuid>`
 * @param {import('better-sqlite3').Database} db that database's connection
 * @returns {{ usedBytes: number, quotaBytes: number | null }} `quotaBytes` is null when unlimited
 */
export function imageStorageUsage(dbKey, db) {
    const isSpace = dbKey.startsWith('space:');
    const target = { db, isSpace, userId: isSpace ? null : dbKey.slice('user:'.length) };
    return {
        usedBytes: Number(imageStats(target)?.total_image_bytes || 0),
        quotaBytes: isSpace ? SPACE_QUOTA_BYTES : QUOTA_BYTES,
    };
}

function respondImageTargetError(res, error, event) {
    console.error('[images]', JSON.stringify({
        event,
        category: error?.code || 'image_target_error',
    }));
    return res.status(500).json({ error: 'Internal server error' });
}

/**
 * The Documents whose body references an image: how many, and the most
 * recently updated of them (5 unless `limit` says otherwise).
 */
/**
 * The Documents and templates whose text references an image. A template counts: a
 * Document made from it would show the image, so deleting it would break that Document.
 * `count` is both together, so callers that refuse an image "in use" keep refusing it.
 * @returns {{ count: number, documentCount: number, notes: Array<{ id: string, title: string, updatedAt: string }>,
 *   templateCount: number, templates: Array<{ id: string, name: string, updatedAt: string }> }}
 */
export function getImageUsage(db, imageId, { limit = 5 } = {}) {
    const pattern = imageReferencePattern(imageId);
    // One scan of the bodies for the count and the first rows.
    const noteRows = db.prepare(`
        SELECT id, title, updated_at, COUNT(*) OVER () AS total
        FROM notes
        WHERE content LIKE ? ESCAPE '!'
        ORDER BY updated_at DESC, id ASC
        LIMIT ?
    `).all(pattern, Math.max(1, limit));
    const templateRows = db.prepare(`
        SELECT id, name, updated_at
        FROM templates
        WHERE content LIKE ? ESCAPE '!'
        ORDER BY updated_at DESC, id ASC
    `).all(pattern);
    const documentCount = noteRows.length ? Number(noteRows[0].total) : 0;

    return {
        count: documentCount + templateRows.length,
        documentCount,
        notes: noteRows.map((note) => ({
            id: note.id,
            title: note.title || 'Untitled',
            updatedAt: note.updated_at,
        })),
        templateCount: templateRows.length,
        templates: templateRows.slice(0, limit).map((template) => ({
            id: template.id,
            name: template.name || 'Untitled template',
            updatedAt: template.updated_at,
        })),
    };
}

/** How many Documents and templates reference an image. */
export function getImageUsageCount(db, imageId) {
    return getImageUsageCounts(db, [imageId]).get(imageId) ?? 0;
}

const IMAGE_ID_SHAPE = /^[0-9a-f-]{36}$/i;
const IMAGE_LINK = /\/images\/([0-9a-f-]{36})/gi;

/**
 * Usage counts (Documents plus templates) of several images in one database, in one pass:
 * the bodies that link to any image are read once, one row at a time, instead of one scan
 * per image (a page of 200 images took 2.7 s on 87 MB of Documents). Same rule as
 * getImageUsage: a body counts once per image it contains `/images/<id>` for, ignoring
 * ASCII case. An id not shaped like a UUID is counted with its own LIKE.
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} imageIds
 * @returns {Map<string, number>}
 */
export function getImageUsageCounts(db, imageIds) {
    const counts = new Map(imageIds.map((id) => [id, 0]));
    const byKey = new Map();
    for (const id of imageIds) {
        if (!IMAGE_ID_SHAPE.test(String(id))) {
            const pattern = imageReferencePattern(id);
            const total = ['notes', 'templates'].reduce((sum, table) => sum
                + Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE content LIKE ? ESCAPE '!'`).get(pattern)?.count || 0), 0);
            counts.set(id, total);
            continue;
        }
        const key = String(id).toLowerCase();
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(id);
    }
    if (byKey.size === 0) return counts;
    for (const table of ['notes', 'templates']) {
        const rows = db.prepare(`SELECT content FROM ${table} WHERE content LIKE '%/images/%'`).pluck();
        for (const content of rows.iterate()) {
            const seen = new Set();
            for (const match of String(content).matchAll(IMAGE_LINK)) {
                const key = match[1].toLowerCase();
                if (seen.has(key) || !byKey.has(key)) continue;
                seen.add(key);
                for (const id of byKey.get(key)) counts.set(id, counts.get(id) + 1);
            }
        }
    }
    return counts;
}

function encodeCursor(payload) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** @returns {object|null} a list cursor's contents, or null when it is not one */
export function decodeImageListCursor(value) {
    if (!value) return null;
    try {
        return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

function parseLimit(rawLimit) {
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 50;
    }
    return Math.min(Math.floor(parsed), 200);
}

export const IMAGE_LIST_SORTS = Object.freeze(['created_desc', 'created_asc', 'size_desc', 'size_asc']);

function parseSort(rawSort) {
    const sort = String(rawSort || 'created_desc');
    if (IMAGE_LIST_SORTS.includes(sort)) {
        return sort;
    }
    return 'created_desc';
}

function buildListQuery({ target, search, sort, cursor, limit }) {
    const scope = imageScopeClause(target);
    const whereClauses = [target.isSpace ? '1 = 1' : 'user_id = ?'];
    const params = [...scope.params];
    const orderByMap = {
        created_desc: 'created_at DESC, id DESC',
        created_asc: 'created_at ASC, id ASC',
        size_desc: 'size_bytes DESC, id DESC',
        size_asc: 'size_bytes ASC, id ASC',
    };

    if (search) {
        whereClauses.push("filename LIKE ? ESCAPE '!'");
        params.push(`%${escapeLike(search)}%`);
    }

    if (cursor && cursor.sort === sort && cursor.id) {
        if (sort === 'created_desc') {
            whereClauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
            params.push(cursor.value, cursor.value, cursor.id);
        } else if (sort === 'created_asc') {
            whereClauses.push('(created_at > ? OR (created_at = ? AND id > ?))');
            params.push(cursor.value, cursor.value, cursor.id);
        } else if (sort === 'size_desc') {
            whereClauses.push('(size_bytes < ? OR (size_bytes = ? AND id < ?))');
            params.push(Number(cursor.value) || 0, Number(cursor.value) || 0, cursor.id);
        } else if (sort === 'size_asc') {
            whereClauses.push('(size_bytes > ? OR (size_bytes = ? AND id > ?))');
            params.push(Number(cursor.value) || 0, Number(cursor.value) || 0, cursor.id);
        }
    }

    const sql = `
        SELECT id, filename, mime_type, size_bytes, created_at
        FROM images
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY ${orderByMap[sort]}
        LIMIT ?
    `;

    return {
        sql,
        params: [...params, limit + 1],
    };
}

/**
 * Remove an image's row and its file. Callers check usage first. A missing
 * file is tolerated; a stored path outside the upload root is refused.
 * @returns {{ deleted: true } | { deleted: false, reason: 'not-found' | 'forbidden' }}
 */
export function deleteImageRecordAndFile({ target, imageId }) {
    const image = findImage(target, imageId, 'id, path');

    if (!image) {
        return { deleted: false, reason: 'not-found' };
    }

    const absolutePath = resolveStoredImagePath(target.dbKey, image.path);
    if (!absolutePath) {
        return { deleted: false, reason: 'forbidden' };
    }

    const scope = imageScopeClause(target);
    target.db.prepare(`DELETE FROM images WHERE id = ?${scope.sql}`).run(imageId, ...scope.params);

    try {
        if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath);
        }
    } catch (error) {
        console.warn(`[images] Failed to delete file from disk for ${imageId}:`, error.message);
    }

    return { deleted: true };
}

/**
 * One page of a database's images, as GET /images answers it.
 *
 * @param {object} target from resolveImageTarget or databaseImageTarget
 * @param {{ limit?: unknown, search?: string, sort?: unknown, cursor?: object|null }} options
 *   `cursor` already decoded (decodeImageListCursor); one made for another sort is ignored
 */
export function listImages(target, { limit: rawLimit, search = '', sort: rawSort, cursor = null } = {}) {
    const limit = parseLimit(rawLimit);
    const sort = parseSort(rawSort);
    const { sql, params } = buildListQuery({ target, search, sort, cursor, limit });
    const rows = target.db.prepare(sql).all(...params);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const usage = getImageUsageCounts(target.db, pageRows.map((row) => row.id));
    const images = pageRows.map((row) => ({
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes || 0),
        createdAt: row.created_at,
        url: toCanonicalImageUrl(row.id, target.dbKey),
        usageCount: usage.get(row.id) ?? 0,
    }));

    let nextCursor = null;
    if (hasMore && pageRows.length > 0) {
        const last = pageRows[pageRows.length - 1];
        const cursorValue = sort.startsWith('created') ? last.created_at : Number(last.size_bytes || 0);
        nextCursor = encodeCursor({
            sort,
            value: cursorValue,
            id: last.id,
        });
    }

    return { images, nextCursor };
}

/** Why storeImage refused an image. `code` is closed; `message` is the app's fixed text. */
export class ImageStoreError extends Error {
    /**
     * @param {'IMAGE_TYPE_NOT_ALLOWED'|'IMAGE_EXTENSION_MISMATCH'|'IMAGE_TOO_LARGE'|'IMAGE_QUOTA_EXCEEDED'} code
     * @param {string} message
     */
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/**
 * Store an uploaded image in a database: the type allow-list, the extension
 * check, the size limit and the quota, then the bytes under a fresh UUID name
 * in that database's upload root and the images row. The upload route below
 * and the AI agents add-on both store through here.
 *
 * `target.db` must be a healthy connection (getHealthyDb): `images` is a CRR,
 * and a write on a handle whose sync bit a failed merge left set would never
 * reach devices (docs/architecture/crsqlite-sync.md, "The sync bit").
 *
 * The bytes are not inspected. A caller that needs them to match the declared
 * type checks that first.
 *
 * @param {object} target from resolveImageTarget or databaseImageTarget
 * @param {{ buffer: Buffer, originalName: string, mimeType: string }} image
 * @returns {{ id: string, filename: string, mimeType: string, sizeBytes: number,
 *   sha256: string, createdAt: string, url: string }}
 * @throws {ImageStoreError} for a refusal; anything else is a server fault
 *   (a file already written is removed again)
 */
export function storeImage(target, { buffer, originalName, mimeType }) {
    if (!isAllowedMime(mimeType)) {
        throw new ImageStoreError('IMAGE_TYPE_NOT_ALLOWED', 'Unsupported image type');
    }
    if (!matchesAllowedExtension(mimeType, originalName)) {
        throw new ImageStoreError('IMAGE_EXTENSION_MISMATCH', 'File extension does not match MIME type');
    }
    const size = buffer.length;
    if (size > MAX_IMAGE_SIZE_BYTES) {
        throw new ImageStoreError('IMAGE_TOO_LARGE', 'File size exceeds 1MB limit');
    }
    const currentBytes = Number(imageStats(target)?.total_image_bytes || 0);
    if (target.quotaBytes && currentBytes + size > target.quotaBytes) {
        throw new ImageStoreError('IMAGE_QUOTA_EXCEEDED', 'Image storage quota exceeded');
    }

    const targetRoot = resolveDatabaseUploadRoot(target.dbKey);
    fs.mkdirSync(targetRoot, { recursive: true });
    const relativePath = `${uuidv4()}${getStorageExtension(mimeType)}`;
    const absolutePath = path.join(targetRoot, relativePath);
    fs.writeFileSync(absolutePath, buffer, { flag: 'wx' });

    const imageId = uuidv4();
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const createdAt = new Date().toISOString();
    try {
        target.db.prepare(`
            INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(imageId, target.userId, originalName, mimeType, relativePath, size, sha256, createdAt);
    } catch (error) {
        fs.unlink(absolutePath, (unlinkErr) => {
            if (unlinkErr) console.error('Error cleaning up orphaned file:', unlinkErr);
        });
        throw error;
    }

    return {
        id: imageId,
        filename: originalName,
        mimeType,
        sizeBytes: size,
        sha256,
        createdAt,
        url: toCanonicalImageUrl(imageId, target.dbKey),
    };
}

// Type, extension and size are checked while the request streams in; the bytes
// are then stored through storeImage.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    fileFilter(req, file, cb) {
        if (!isAllowedMime(file.mimetype)) {
            req.fileValidationError = 'Unsupported image type';
            cb(null, false);
            return;
        }

        if (!matchesAllowedExtension(file.mimetype, file.originalname)) {
            req.fileValidationError = 'File extension does not match MIME type';
            cb(null, false);
            return;
        }

        cb(null, true);
    },
});

imageRoutes.get('/images/stats', (req, res) => {
    try {
        const target = resolveImageTarget(req, res, 'image-stats');
        if (!target) return res.status(404).json({ error: 'Not found', code: 'SPACE_NOT_FOUND' });
        res.json(getImageStats(target));
    } catch (error) {
        return respondImageTargetError(res, error, 'image_stats_failed');
    }
});

imageRoutes.get('/images', (req, res) => {
    const search = String(req.query.search || '').trim();
    const cursor = decodeImageListCursor(req.query.cursor);

    try {
        const target = resolveImageTarget(req, res, 'image-list');
        if (!target) return res.status(404).json({ error: 'Not found', code: 'SPACE_NOT_FOUND' });
        res.json(listImages(target, { limit: req.query.limit, search, sort: req.query.sort, cursor }));
    } catch (error) {
        return respondImageTargetError(res, error, 'image_list_failed');
    }
});

imageRoutes.get('/images/:id/usage', (req, res) => {
    const imageId = req.params.id;

    try {
        const target = resolveImageTarget(req, res, 'image-usage');
        if (!target) return res.status(404).json({ error: 'Not found', code: 'SPACE_NOT_FOUND' });
        const image = findImage(target, imageId);
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }

        const usage = getImageUsage(target.db, imageId);
        return res.json({ imageId, usage });
    } catch (error) {
        return respondImageTargetError(res, error, 'image_usage_failed');
    }
});

imageRoutes.post('/images', (req, res) => {
    let target;
    try {
        target = resolveImageTarget(req, res, 'image-upload', { healthy: true });
    } catch (error) {
        return respondImageTargetError(res, error, 'image_upload_authorization_failed');
    }
    if (!target) return res.status(404).json({ error: 'Not found', code: 'SPACE_NOT_FOUND' });

    upload.single('image')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File size exceeds 1MB limit' });
            }
            return res.status(400).json({ error: err.message });
        } else if (err) {
            return res.status(500).json({ error: 'Upload failed' });
        }

        if (req.fileValidationError) {
            return res.status(400).json({ error: req.fileValidationError });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const { originalname, mimetype, buffer } = req.file;

        try {
            const stored = storeImage(target, {
                buffer,
                originalName: normalizeOriginalFilename(originalname),
                mimeType: mimetype,
            });
            return res.status(201).json({ id: stored.id, url: stored.url });
        } catch (error) {
            if (error instanceof ImageStoreError && error.code === 'IMAGE_QUOTA_EXCEEDED') {
                return res.status(413).json({
                    error: 'Image storage quota exceeded',
                    code: 'IMAGE_QUOTA_EXCEEDED',
                });
            }
            console.error('[images]', JSON.stringify({
                event: 'image_upload_failed',
                category: error?.code || 'upload_error',
            }));
            return res.status(500).json({ error: 'Upload failed' });
        }
    });
});

imageRoutes.delete('/images/:id', (req, res) => {
    const imageId = req.params.id;
    const force = req.body?.force === true;

    try {
        const target = resolveImageTarget(req, res, 'image-delete', { healthy: true });
        if (!target) return res.status(404).json({ error: 'Not found', code: 'SPACE_NOT_FOUND' });
        const image = findImage(target, imageId);
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }

        const usage = getImageUsage(target.db, imageId);
        if (!force && usage.count > 0) {
            return res.status(409).json({
                error: 'Image is referenced by notes',
                usage,
            });
        }

        const deletion = deleteImageRecordAndFile({ target, imageId });
        if (deletion.deleted) {
            console.info('[images]', JSON.stringify({
                event: 'image_prune_delete',
                dbKind: target.isSpace ? 'space' : 'user',
                imageId: `${String(imageId).slice(0, 2)}…${String(imageId).slice(-2)}`,
                reason: 'user-delete',
                syncBit: 0,
            }));
        }
        if (!deletion.deleted && deletion.reason === 'forbidden') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        return res.json({ deleted: true, id: imageId });
    } catch (error) {
        return respondImageTargetError(res, error, 'image_delete_failed');
    }
});

imageRoutes.post('/images/bulk-delete', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const force = req.body?.force === true;

    try {
        const target = resolveImageTarget(req, res, 'image-bulk-delete', { healthy: true });
        if (!target) return res.status(404).json({ error: 'Not found', code: 'SPACE_NOT_FOUND' });
        if (ids.length === 0) {
            return res.status(400).json({ error: 'No image ids provided' });
        }
        const uniqueIds = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
        const usage = force ? new Map() : getImageUsageCounts(target.db, uniqueIds);

        const results = uniqueIds.map((imageId) => {
            const image = findImage(target, imageId);
            if (!image) {
                return { id: imageId, deleted: false, reason: 'not-found' };
            }

            const usageCount = usage.get(imageId) ?? 0;
            if (!force && usageCount > 0) {
                return {
                    id: imageId,
                    deleted: false,
                    reason: 'in-use',
                    usageCount,
                };
            }

            const deletion = deleteImageRecordAndFile({ target, imageId });
            if (!deletion.deleted && deletion.reason === 'forbidden') {
                return { id: imageId, deleted: false, reason: 'forbidden' };
            }

            return { id: imageId, deleted: true };
        });

        return res.json({ results });
    } catch (error) {
        return respondImageTargetError(res, error, 'image_bulk_delete_failed');
    }
});

imageRoutes.get('/images/:id', (req, res) => {
    const { id } = req.params;

    try {
        const target = resolveImageTarget(req, res, 'image-read');
        if (!target) return res.status(404).json({ error: 'Not found', code: 'SPACE_NOT_FOUND' });
        const image = findImage(target, id, 'mime_type, path');

        if (!image || !image.path) {
            return res.status(404).json({ error: 'Image not found or access denied' });
        }

        const absolutePath = resolveStoredImagePath(target.dbKey, image.path);

        if (!absolutePath) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (!fs.existsSync(absolutePath)) {
            console.error(`File is in DB but not on disk: ${absolutePath}`);
            return res.status(404).json({ error: 'Image file not found on server' });
        }

        setImageResponseHeaders(res, image.mime_type);
        res.set('Cache-Control', target.isSpace ? 'private, no-store' : 'public, max-age=31536000');
        res.sendFile(absolutePath);
    } catch (error) {
        return respondImageTargetError(res, error, 'image_read_failed');
    }
});

export function pruneOrphanImagesForDb(dbKey, options = {}) {
    const maxDeletes = Number(options.maxDeletes) > 0 ? Math.floor(options.maxDeletes) : IMAGE_PRUNE_BATCH_SIZE;
    const olderThanDays = Number(options.olderThanDays) > 0 ? Math.floor(options.olderThanDays) : IMAGE_PRUNE_MIN_AGE_DAYS;
    const cutoff = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000)).toISOString();

    const isSpace = dbKey.startsWith('space:');
    const target = {
        dbKey,
        db: getHealthyDb(dbKey, 'image-orphan-prune'),
        isSpace,
        userId: isSpace ? null : dbKey.slice('user:'.length),
    };
    const scope = imageScopeClause(target);
    const candidates = target.db.prepare(`
        SELECT id
        FROM images
        WHERE created_at <= ?${scope.sql}
        ORDER BY created_at ASC, id ASC
        LIMIT ?
    `).all(cutoff, ...scope.params, maxDeletes * 5);

    let deletedCount = 0;
    const usage = getImageUsageCounts(target.db, candidates.map((candidate) => candidate.id));
    for (const candidate of candidates) {
        if (deletedCount >= maxDeletes) {
            break;
        }

        if (usage.get(candidate.id) > 0) {
            continue;
        }

        const result = deleteImageRecordAndFile({ target, imageId: candidate.id });
        if (result.deleted) {
            deletedCount += 1;
            console.info('[images]', JSON.stringify({
                event: 'image_prune_delete',
                dbKind: isSpace ? 'space' : 'user',
                imageId: `${String(candidate.id).slice(0, 2)}…${String(candidate.id).slice(-2)}`,
                reason: 'unused',
                syncBit: 0,
            }));
        }
    }

    return deletedCount;
}

export function pruneOrphanImagesForUser(userId, options = {}) {
    return pruneOrphanImagesForDb(`user:${userId}`, options);
}

export function runDailyImageOrphanPrune() {
    let totalDeleted = 0;

    for (const dbKey of listUserDbIds()) {
        try {
            totalDeleted += pruneOrphanImagesForDb(dbKey, {
                maxDeletes: IMAGE_PRUNE_BATCH_SIZE,
                olderThanDays: IMAGE_PRUNE_MIN_AGE_DAYS,
            });
        } catch (error) {
            console.error(`[images] Daily prune failed for ${dbKey}:`, error);
        }
    }

    console.log(`[images] Daily orphan prune completed. Deleted ${totalDeleted} images.`);
    return totalDeleted;
}

export function startImageOrphanPruneJob() {
    if (process.env.NODE_ENV === 'test' || process.env.IMAGE_PRUNE_DISABLED === '1') {
        return null;
    }

    return setInterval(() => {
        runDailyImageOrphanPrune();
    }, IMAGE_PRUNE_INTERVAL_MS);
}
