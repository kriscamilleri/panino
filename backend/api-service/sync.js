// backend/api-service/sync.js
import express from 'express';
import { getUserDb } from './db.js';

const router = express.Router();

const ACCEPTED_TYPES = ['number', 'string', 'bigint']; // plus Buffer & null
const SITE_ID_LEN = 16;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Convert common "byte array like" shapes (Buffer, Array, {0:..}, hex/base64/uuid strings)
 * to a Buffer. Returns null if it can't reasonably convert.
 */function toBufferLike(v) {
    if (v == null) return null;
    if (Buffer.isBuffer(v)) return Buffer.from(v);
    if (Array.isArray(v)) return Buffer.from(v.map(n => Number(n) & 0xff));
    if (typeof v === 'object') {
        const keys = Object.keys(v);
        if (keys.length && keys.every(k => /^\d+$/.test(k))) {
            const arr = keys.sort((a, b) => a - b).map(k => Number(v[k]) & 0xff);
            return Buffer.from(arr);
        }
        return null;
    }
    if (typeof v === 'string') {
        if (v.startsWith('{') && v.endsWith('}')) {
            try { return toBufferLike(JSON.parse(v)); } catch {/* ignore */ }
        }
        if (/^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/.test(v)) {
            return Buffer.from(v.replace(/-/g, ''), 'hex');
        }
        if (/^[0-9a-fA-F]{32}$/.test(v)) {
            return Buffer.from(v, 'hex');
        }
        try {
            const b = Buffer.from(v, 'base64');
            if (b.length) return b;
        } catch {/* ignore */ }
        return Buffer.from(v, 'utf8');
    }
    return null;
}
function toSiteIdBlob(v) {
    const buf = toBufferLike(v);
    if (!buf) return null;
    return buf.length === SITE_ID_LEN ? buf : buf.subarray(0, SITE_ID_LEN);
}
function toPkValue(v) {
    const b = toBufferLike(v);
    if (b) return b;
    try { return JSON.stringify(v); } catch { return String(v); }
}
function toSqliteScalar(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') return v;
    if (typeof v === 'bigint') return v;
    if (Buffer.isBuffer(v)) return v;
    try { return JSON.stringify(v); } catch { return String(v); }
}
function assertBindable(obj) {
    for (const [k, v] of Object.entries(obj)) {
        if (
            v === null ||
            Buffer.isBuffer(v) ||
            ACCEPTED_TYPES.includes(typeof v)
        ) continue;
        throw new TypeError(`Param ${k} has invalid type ${typeof v}`);
    }
}
function extractUserId(req) {
    if (req.user?.user_id) return req.user.user_id;
    if (req.body?.user_id) return req.body.user_id;
    if (req.body?.userId) return req.body.userId;
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
        const token = auth.slice(7);
        try {
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
            return payload.user_id || payload.userId || payload.sub;
        } catch {/* ignore */ }
    }
    return undefined;
}


router.post('/sync', (req, res, next) => {
    const userId = extractUserId(req);
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const since = Number(req.body?.since ?? 0);
    const siteId = req.body?.siteId ?? null;
    const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];

    if (changes.length > 0) {
        console.log(`SERVER: Received ${changes.length} changes for user ${userId}`);
    }

    let db;
    try {
        db = getUserDb(userId);
    } catch (e) {
        return next(e);
    }

    try {
        if (changes.length) {
            const insertSQL = `
        INSERT INTO crsql_changes
          ("table", pk, cid, val, col_version, db_version, site_id, seq, cl)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
            const insertStmt = db.prepare(insertSQL);
            const applyChanges = db.transaction((rows) => {
                for (const ch of rows) {
                    const row = {
                        table: toSqliteScalar(ch.table),
                        pk: toPkValue(ch.pk),
                        cid: toSqliteScalar(ch.cid),
                        val: toSqliteScalar(ch.val),
                        col_version: Number(ch.col_version) || 0,
                        db_version: Number(ch.db_version) || 0,
                        site_id: toSiteIdBlob(ch.site_id),
                        seq: Number(ch.seq) || 0,
                        cl: Number(ch.cl) || 0
                    };
                    assertBindable(row);
                    insertStmt.run(Object.values(row));
                }
            });
            applyChanges(changes);

            // ✅ NOTIFY other clients after applying changes
            const { clients } = req;
            const requestorSiteIdHex = siteId ? toSiteIdBlob(siteId).toString('hex') : null;

            clients.forEach((clientUserId, clientWs) => {
                // Poke all other clients for the same user
                if (clientUserId === userId) {
                    // A more robust check would involve comparing site IDs, but for simplicity,
                    // we poke all clients for this user. The originating client will just
                    // perform a harmless extra sync.
                    if (clientWs.readyState === 1) { // WebSocket.OPEN
                        clientWs.send(JSON.stringify({ type: 'sync' }));
                    }
                }
            });
        }

        const mySiteBlob = toSiteIdBlob(siteId);
        const remote = db.prepare(`
      SELECT "table", hex(pk) as pk, cid, val, col_version, db_version,
             hex(site_id) AS site_id, seq, cl
      FROM crsql_changes
      WHERE db_version > ?
        AND (? IS NULL OR site_id != ?)
      ORDER BY db_version ASC
    `).all(since, mySiteBlob, mySiteBlob);

        const clockRow = db.prepare(`SELECT max(db_version) as version FROM crsql_changes`).get();
        const newClock = clockRow.version ?? since;

        res.json({ changes: remote, clock: newClock });
    } catch (err) {
        next(err);
    }
});

export const syncRoutes = router;
export default router;