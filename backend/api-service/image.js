// /backend/api-service/image.js
import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getUserDb, listUserDbIds } from './db.js';

export const imageRoutes = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const MAX_IMAGE_SIZE_BYTES = 1 * 1024 * 1024;
const IMAGE_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const IMAGE_PRUNE_BATCH_SIZE = 100;
const IMAGE_PRUNE_MIN_AGE_DAYS = 7;
const QUOTA_BYTES_ENV = Number(process.env.IMAGE_QUOTA_BYTES);
const QUOTA_BYTES = Number.isFinite(QUOTA_BYTES_ENV) && QUOTA_BYTES_ENV > 0 ? QUOTA_BYTES_ENV : null;

const ALLOWED_MIME_TO_EXTENSIONS = new Map([
    ['image/png', ['.png']],
    ['image/jpeg', ['.jpg', '.jpeg']],
    ['image/gif', ['.gif']],
    ['image/webp', ['.webp']],
    ['image/svg+xml', ['.svg']],
]);

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function normalizeExt(filename) {
    const ext = path.extname(filename || '').toLowerCase();
    return ext.startsWith('.') ? ext : `.${ext}`;
}

function isAllowedMime(mimeType) {
    return ALLOWED_MIME_TO_EXTENSIONS.has((mimeType || '').toLowerCase());
}

function matchesAllowedExtension(mimeType, originalName) {
    const allowedExtensions = ALLOWED_MIME_TO_EXTENSIONS.get((mimeType || '').toLowerCase()) || [];
    return allowedExtensions.includes(normalizeExt(originalName));
}

function getStorageExtension(mimeType) {
    const allowedExtensions = ALLOWED_MIME_TO_EXTENSIONS.get((mimeType || '').toLowerCase()) || [];
    return allowedExtensions[0] || '.bin';
}

function normalizeOriginalFilename(filename) {
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

function toImageUrl(imageId) {
    return `/images/${imageId}`;
}

function escapeLike(value) {
    return String(value).replace(/[!%_]/g, '!$&');
}

function getImageReferencePatterns(imageId) {
    const escapedId = escapeLike(imageId);
    return [`%/images/${escapedId}%`, `%/api/images/${escapedId}%`];
}

function resolveUploadPath(relativePath) {
    const absolutePath = path.resolve(UPLOADS_DIR, relativePath || '');
    const uploadsRoot = `${UPLOADS_DIR}${path.sep}`;
    if (absolutePath !== UPLOADS_DIR && !absolutePath.startsWith(uploadsRoot)) {
        return null;
    }
    return absolutePath;
}

function getImageUsage(db, imageId) {
    const [relPattern, apiPattern] = getImageReferencePatterns(imageId);

    const countRow = db.prepare(`
        SELECT COUNT(*) as count
        FROM notes
        WHERE content LIKE ? ESCAPE '!' OR content LIKE ? ESCAPE '!'
    `).get(relPattern, apiPattern);

    const noteRows = db.prepare(`
        SELECT id, title, updated_at
        FROM notes
        WHERE content LIKE ? ESCAPE '!' OR content LIKE ? ESCAPE '!'
        ORDER BY updated_at DESC, id ASC
        LIMIT 5
    `).all(relPattern, apiPattern);

    return {
        count: Number(countRow?.count || 0),
        notes: noteRows.map((note) => ({
            id: note.id,
            title: note.title || 'Untitled',
            updatedAt: note.updated_at,
        })),
    };
}

function getImageUsageCount(db, imageId) {
    const [relPattern, apiPattern] = getImageReferencePatterns(imageId);
    const row = db.prepare(`
        SELECT COUNT(*) as count
        FROM notes
        WHERE content LIKE ? ESCAPE '!' OR content LIKE ? ESCAPE '!'
    `).get(relPattern, apiPattern);

    return Number(row?.count || 0);
}

function encodeCursor(payload) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(value) {
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

function parseSort(rawSort) {
    const sort = String(rawSort || 'created_desc');
    if (['created_desc', 'created_asc', 'size_desc', 'size_asc'].includes(sort)) {
        return sort;
    }
    return 'created_desc';
}

function buildListQuery({ search, sort, cursor, limit }) {
    const whereClauses = ['user_id = ?'];
    const params = [];
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

function deleteImageRecordAndFile({ db, userId, imageId }) {
    const image = db.prepare(`
        SELECT id, path
        FROM images
        WHERE id = ? AND user_id = ?
    `).get(imageId, userId);

    if (!image) {
        return { deleted: false, reason: 'not-found' };
    }

    const absolutePath = resolveUploadPath(image.path);
    if (!absolutePath) {
        return { deleted: false, reason: 'forbidden' };
    }

    db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?').run(imageId, userId);

    try {
        if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath);
        }
    } catch (error) {
        console.warn(`[images] Failed to delete file from disk for ${imageId}:`, error.message);
    }

    return { deleted: true };
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const fileExt = getStorageExtension(file.mimetype);
        const uniqueFilename = `${uuidv4()}${fileExt}`;
        cb(null, uniqueFilename);
    },
});

const upload = multer({
    storage,
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
        const db = getUserDb(req.user.user_id);
        const stats = db.prepare(`
            SELECT COUNT(*) as image_count, COALESCE(SUM(size_bytes), 0) as total_image_bytes
            FROM images
            WHERE user_id = ?
        `).get(req.user.user_id);

        res.json({
            imageCount: Number(stats?.image_count || 0),
            totalImageBytes: Number(stats?.total_image_bytes || 0),
            quotaBytes: QUOTA_BYTES,
        });
    } catch (error) {
        console.error('Image stats error:', error);
        res.status(500).json({ error: 'Failed to load image stats' });
    }
});

imageRoutes.get('/images', (req, res) => {
    const userId = req.user.user_id;
    const limit = parseLimit(req.query.limit);
    const search = String(req.query.search || '').trim();
    const sort = parseSort(req.query.sort);
    const cursor = decodeCursor(req.query.cursor);

    try {
        const db = getUserDb(userId);
        const { sql, params } = buildListQuery({ search, sort, cursor, limit });
        const rows = db.prepare(sql).all(userId, ...params);

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;

        const images = pageRows.map((row) => ({
            id: row.id,
            filename: row.filename,
            mimeType: row.mime_type,
            sizeBytes: Number(row.size_bytes || 0),
            createdAt: row.created_at,
            url: toImageUrl(row.id),
            usageCount: getImageUsageCount(db, row.id),
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

        res.json({ images, nextCursor });
    } catch (error) {
        console.error('Image list error:', error);
        res.status(500).json({ error: 'Failed to list images' });
    }
});

imageRoutes.get('/images/:id/usage', (req, res) => {
    const userId = req.user.user_id;
    const imageId = req.params.id;

    try {
        const db = getUserDb(userId);
        const image = db.prepare('SELECT id FROM images WHERE id = ? AND user_id = ?').get(imageId, userId);
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }

        const usage = getImageUsage(db, imageId);
        return res.json({ imageId, usage });
    } catch (error) {
        console.error('Image usage lookup error:', error);
        return res.status(500).json({ error: 'Failed to load image usage' });
    }
});

imageRoutes.post('/images', (req, res) => {
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

        const userId = req.user.user_id;
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const { originalname, mimetype, filename, path: filePath, size } = req.file;
        const normalizedOriginalName = normalizeOriginalFilename(originalname);
        const imageId = uuidv4();
        const relativePath = filename;
        const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

        try {
            const db = getUserDb(userId);
            db.prepare(`
                INSERT INTO images (id, user_id, filename, mime_type, path, size_bytes, sha256, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(imageId, userId, normalizedOriginalName, mimetype, relativePath, size, sha256, new Date().toISOString());

            res.status(201).json({ id: imageId, url: toImageUrl(imageId) });
        } catch (error) {
            console.error('Image upload error:', error);
            fs.unlink(req.file.path, (unlinkErr) => {
                if (unlinkErr) console.error('Error cleaning up orphaned file:', unlinkErr);
            });
            res.status(500).json({ error: 'Upload failed' });
        }
    });
});

imageRoutes.delete('/images/:id', (req, res) => {
    const userId = req.user.user_id;
    const imageId = req.params.id;
    const force = req.body?.force === true;

    try {
        const db = getUserDb(userId);
        const image = db.prepare('SELECT id FROM images WHERE id = ? AND user_id = ?').get(imageId, userId);
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }

        const usage = getImageUsage(db, imageId);
        if (!force && usage.count > 0) {
            return res.status(409).json({
                error: 'Image is referenced by notes',
                usage,
            });
        }

        const deletion = deleteImageRecordAndFile({ db, userId, imageId });
        if (!deletion.deleted && deletion.reason === 'forbidden') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        return res.json({ deleted: true, id: imageId });
    } catch (error) {
        console.error('Image delete error:', error);
        return res.status(500).json({ error: 'Failed to delete image' });
    }
});

imageRoutes.post('/images/bulk-delete', (req, res) => {
    const userId = req.user.user_id;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const force = req.body?.force === true;

    if (ids.length === 0) {
        return res.status(400).json({ error: 'No image ids provided' });
    }

    try {
        const db = getUserDb(userId);
        const uniqueIds = [...new Set(ids.map((id) => String(id)).filter(Boolean))];

        const results = uniqueIds.map((imageId) => {
            const image = db.prepare('SELECT id FROM images WHERE id = ? AND user_id = ?').get(imageId, userId);
            if (!image) {
                return { id: imageId, deleted: false, reason: 'not-found' };
            }

            const usage = getImageUsage(db, imageId);
            if (!force && usage.count > 0) {
                return {
                    id: imageId,
                    deleted: false,
                    reason: 'in-use',
                    usageCount: usage.count,
                };
            }

            const deletion = deleteImageRecordAndFile({ db, userId, imageId });
            if (!deletion.deleted && deletion.reason === 'forbidden') {
                return { id: imageId, deleted: false, reason: 'forbidden' };
            }

            return { id: imageId, deleted: true };
        });

        return res.json({ results });
    } catch (error) {
        console.error('Bulk image delete error:', error);
        return res.status(500).json({ error: 'Failed to delete images' });
    }
});

imageRoutes.get('/images/:id', (req, res) => {
    const userId = req.user.user_id;
    const { id } = req.params;

    try {
        const db = getUserDb(userId);
        const image = db.prepare('SELECT mime_type, path FROM images WHERE id = ? AND user_id = ?').get(id, userId);

        if (!image || !image.path) {
            return res.status(404).json({ error: 'Image not found or access denied' });
        }

        const absolutePath = resolveUploadPath(image.path);

        if (!absolutePath) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (!fs.existsSync(absolutePath)) {
            console.error(`File is in DB but not on disk: ${absolutePath}`);
            return res.status(404).json({ error: 'Image file not found on server' });
        }

        res.set('Content-Type', image.mime_type);
        res.set('Cache-Control', 'public, max-age=31536000');
        res.sendFile(absolutePath);
    } catch (error) {
        console.error('Error serving image:', error);
        res.status(500).json({ error: 'Failed to serve image' });
    }
});

export function pruneOrphanImagesForUser(userId, options = {}) {
    const maxDeletes = Number(options.maxDeletes) > 0 ? Math.floor(options.maxDeletes) : IMAGE_PRUNE_BATCH_SIZE;
    const olderThanDays = Number(options.olderThanDays) > 0 ? Math.floor(options.olderThanDays) : IMAGE_PRUNE_MIN_AGE_DAYS;
    const cutoff = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000)).toISOString();

    const db = getUserDb(userId);
    const candidates = db.prepare(`
        SELECT id
        FROM images
        WHERE user_id = ? AND created_at <= ?
        ORDER BY created_at ASC, id ASC
        LIMIT ?
    `).all(userId, cutoff, maxDeletes * 5);

    let deletedCount = 0;
    for (const candidate of candidates) {
        if (deletedCount >= maxDeletes) {
            break;
        }

        const usageCount = getImageUsageCount(db, candidate.id);
        if (usageCount > 0) {
            continue;
        }

        const result = deleteImageRecordAndFile({ db, userId, imageId: candidate.id });
        if (result.deleted) {
            deletedCount += 1;
        }
    }

    return deletedCount;
}

export function runDailyImageOrphanPrune() {
    const userDbIds = listUserDbIds();
    let totalDeleted = 0;

    for (const userId of userDbIds) {
        try {
            totalDeleted += pruneOrphanImagesForUser(userId, {
                maxDeletes: IMAGE_PRUNE_BATCH_SIZE,
                olderThanDays: IMAGE_PRUNE_MIN_AGE_DAYS,
            });
        } catch (error) {
            console.error(`[images] Daily prune failed for user ${userId}:`, error);
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