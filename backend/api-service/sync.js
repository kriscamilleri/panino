// backend/api-service/sync.js
import express from "express";
import { getUserDb, invalidateUserDb } from "./db.js";
import { triggerDailyAutoBackup } from "./backup.js";
import {
  createRevisionSnapshot,
  deleteNoteRevisionsForDeletedNote,
} from "./revision.js";

const router = express.Router();

const ACCEPTED_TYPES = ["number", "string", "bigint"]; // plus Buffer & null
const SITE_ID_LEN = 16;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Convert common "byte array like" shapes (Buffer, Array, {0:..}, hex/base64/uuid strings)
 * to a Buffer. Returns null if it can't reasonably convert.
 */
export function toBufferLike(v) {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return Buffer.from(v);
  if (Array.isArray(v)) return Buffer.from(v.map((n) => Number(n) & 0xff));
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
      const arr = keys.sort((a, b) => a - b).map((k) => Number(v[k]) & 0xff);
      return Buffer.from(arr);
    }
    return null;
  }
  if (typeof v === "string") {
    if (v.startsWith("{") && v.endsWith("}")) {
      try {
        return toBufferLike(JSON.parse(v));
      } catch {
        /* ignore */
      }
    }
    if (
      /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/.test(
        v,
      )
    ) {
      return Buffer.from(v.replace(/-/g, ""), "hex");
    }
    if (/^[0-9a-fA-F]{32}$/.test(v)) {
      return Buffer.from(v, "hex");
    }
    try {
      const b = Buffer.from(v, "base64");
      if (b.length) return b;
    } catch {
      /* ignore */
    }
    return Buffer.from(v, "utf8");
  }
  return null;
}

export function toSiteIdBlob(v) {
  const buf = toBufferLike(v);
  if (!buf) return null;
  return buf.length === SITE_ID_LEN ? buf : buf.subarray(0, SITE_ID_LEN);
}
function toPkValue(v) {
  // Parse JSON array format FIRST: '["value"]' -> 'value'
  // CR-SQLite expects single unpacked value, not JSON string or Buffer
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed[0]; // Extract first pk value
    }
    return parsed;
  } catch {
    // Not JSON, try buffer
    const b = toBufferLike(v);
    if (b) return b;
    return String(v);
  }
}
function toSqliteScalar(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v;
  if (typeof v === "bigint") return v;
  if (Buffer.isBuffer(v)) return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function assertBindable(obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || Buffer.isBuffer(v) || ACCEPTED_TYPES.includes(typeof v))
      continue;
    throw new TypeError(`Param ${k} has invalid type ${typeof v}`);
  }
}

function parsePkId(pk) {
  try {
    const parsed = typeof pk === "string" ? JSON.parse(pk) : pk;
    if (Array.isArray(parsed) && parsed.length > 0) return String(parsed[0]);

    if (parsed && typeof parsed === "object") {
      const packed = toBufferLike(parsed);
      const unpacked = packed.toString("utf8");
      const uuidMatch = unpacked.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      if (uuidMatch) return uuidMatch[0];

      const printable = unpacked.replace(/[^\x20-\x7E]/g, "");
      const jsonArrayMatch = printable.match(/\["([^"\\]+)"\]/);
      if (jsonArrayMatch) return jsonArrayMatch[1];

      const dollarValueMatch = printable.match(/\$([A-Za-z0-9._:-]+)/);
      if (dollarValueMatch) return dollarValueMatch[1];

      const plainTokenMatch = printable.match(/[A-Za-z0-9][A-Za-z0-9._:-]*/);
      if (plainTokenMatch) return plainTokenMatch[0];

      return null;
    }

    if (parsed != null && typeof parsed !== "object") return String(parsed);
  } catch {
    return null;
  }
  return null;
}

function parseChangeValue(value) {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isNotesDeleteTombstone(change) {
  if (!change || change.table !== "notes") return false;
  // A crsqlite delete tombstone is signalled by the delete sentinel cid
  // (cid == null / "" / "-1") together with cl > 0 (one or more column
  // versions were lost, which is what triggers crsqlite's merge_delete to
  // DELETE the parent row). cl is not always 1; a real-world tombstone for a
  // note whose columns had N delta records arrives with cl=N. A regular
  // update change has both a real column name in cid and cl === 0.
  return (
    Number(change.cl) > 0 &&
    (change.cid == null || change.cid === "" || String(change.cid) === "-1")
  );
}

function extractNoteMutations(changes) {
  const byNoteId = new Map();

  for (const change of changes) {
    if (change?.table !== "notes") continue;
    const noteId = parsePkId(change.pk);
    if (!noteId) continue;

    const current = byNoteId.get(noteId) || {
      noteId,
      contentChanged: false,
      titleChanged: false,
      content: undefined,
      title: undefined,
      deleted: false,
    };

    if (isNotesDeleteTombstone(change)) {
      current.deleted = true;
    }

    if (change.cid === "content") {
      current.contentChanged = true;
      current.content = parseChangeValue(change.val);
    }

    if (change.cid === "title") {
      current.titleChanged = true;
      current.title = parseChangeValue(change.val);
    }

    byNoteId.set(noteId, current);
  }

  return [...byNoteId.values()];
}

router.post("/sync", (req, res, next) => {
  const userId = req.user?.user_id;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const since = Number(req.body?.since ?? 0);
  const siteId = req.body?.siteId ?? null;
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];

  if (changes.length > 0) {
    console.log(
      `SERVER: Received ${changes.length} changes for user ${userId}`,
    );
  }

  let db;
  try {
    db = getUserDb(userId);
  } catch (e) {
    return next(e);
  }

  let mergeAttempted = false;
  let mergeChange = null;
  try {
    if (changes.length) {
      const noteMutations = extractNoteMutations(changes);
      const insertSQL = `
        INSERT INTO crsql_changes
          ("table", pk, cid, val, col_version, db_version, site_id, cl, seq)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const insertStmt = db.prepare(insertSQL);
      const getNoteBase = db.prepare(
        "SELECT title, content FROM notes WHERE id = ?",
      );

      const applyChanges = db.transaction((rows, extractedMutations) => {
        // Defense-in-depth: defer FK checks until COMMIT so any future
        // local child table whose cleanup is ordered after a CRR parent
        // delete does not abort mid-transaction. The note_revisions
        // FK now uses ON DELETE CASCADE (see ensureNoteRevisionsSchema),
        // which is the structural fix; this is the safety net.
        db.prepare("PRAGMA defer_foreign_keys = ON").run();

        for (const ch of rows) {
          let pkBytes;
          try {
            const parsed = JSON.parse(ch.pk);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const pkValue = parsed[0];
              const packResult = db
                .prepare("SELECT crsql_pack_columns(?) as pk")
                .get(pkValue);
              pkBytes = packResult.pk;
            } else {
              pkBytes = toBufferLike(ch.pk);
            }
          } catch {
            pkBytes = toBufferLike(ch.pk);
          }

          const row = {
            table: toSqliteScalar(ch.table),
            pk: pkBytes,
            cid: toSqliteScalar(ch.cid),
            val: toSqliteScalar(ch.val),
            col_version: Number(ch.col_version) || 0,
            db_version: Number(ch.db_version) || 0,
            site_id: toSiteIdBlob(ch.site_id),
            cl: Number(ch.cl) || 0,
            seq: Number(ch.seq) || 0,
          };

          assertBindable(row);
          mergeAttempted = true;
          mergeChange = ch;
          insertStmt.run(Object.values(row));
        }

        for (const mutation of extractedMutations) {
          if (mutation.deleted) {
            deleteNoteRevisionsForDeletedNote(db, mutation.noteId);
            continue;
          }

          if (!mutation.contentChanged && !mutation.titleChanged) continue;

          const base = getNoteBase.get(mutation.noteId);
          if (!base) continue;

          const snapshotTitle = mutation.titleChanged
            ? mutation.title
            : base.title;
          const snapshotContent = mutation.contentChanged
            ? mutation.content
            : base.content;

          createRevisionSnapshot(db, {
            noteId: mutation.noteId,
            title: snapshotTitle,
            content: snapshotContent,
            type: "auto",
            skipDuplicateCheck: false,
            enforceAutoThrottle: true,
            runPruneGate: true,
          });
        }
      });
      applyChanges(changes, noteMutations);

      // ✅ FIX: Notify other clients, excluding the one that sent the changes.
      const { clients } = req;
      const requestorSiteId = siteId; // The siteId from the POST body is the sender's ID

      clients.forEach((clientInfo, clientWs) => {
        // clientInfo is now an object: { userId, siteId }
        // Poke all clients for the same user EXCEPT the one who sent the changes.
        if (
          clientInfo.userId === userId &&
          clientInfo.siteId !== requestorSiteId
        ) {
          if (clientWs.readyState === 1) {
            // WebSocket.OPEN
            console.log(`Poking client with siteId: ${clientInfo.siteId}`);
            clientWs.send(JSON.stringify({ type: "sync" }));
          }
        }
      });
    }

    const mySiteBlob = toSiteIdBlob(siteId);
    const remote = db
      .prepare(
        `
      SELECT "table", hex(pk) as pk, cid, val, col_version, db_version,
             hex(site_id) AS site_id, seq, cl
      FROM crsql_changes
      WHERE db_version > ?
        AND (? IS NULL OR site_id != ?)
      ORDER BY db_version ASC
    `,
      )
      .all(since, mySiteBlob, mySiteBlob);

    const clockRow = db
      .prepare(`SELECT max(db_version) as version FROM crsql_changes`)
      .get();
    const newClock = clockRow.version ?? since;

    res.json({
      changes: remote,
      clock: newClock,
      skipped: 0,
    });
    void triggerDailyAutoBackup(userId);
  } catch (err) {
    if (mergeAttempted) {
      const failedChange = mergeChange;
      const pk = failedChange?.pk;
      const invalidated = invalidateUserDb(userId, db, "crsqlite-merge-failure");
      console.error("[sync]", JSON.stringify({
        event: "sync_crsqlite_merge_failure",
        userId: String(userId).slice(0, 2) + "…" + String(userId).slice(-2),
        table: failedChange?.table || "unknown",
        pk: typeof pk === "string" ? pk.slice(0, 80) : "unavailable",
        category: err?.code || "crsqlite-merge-error",
        requestId: req.id || req.get("x-request-id") || null,
        connectionInvalidated: invalidated,
      }));
      return res.status(503).json({
        error: "Sync temporarily unavailable",
        code: "SYNC_CONNECTION_RESET",
      });
    }
    console.error("Sync endpoint error:", err.message);
    next(err);
  }
});

export const syncRoutes = router;
export default router;
