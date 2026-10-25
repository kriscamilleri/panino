// backend/api-service/sync.js
import express from "express";
import { getDb, invalidateDb } from "./db.js";
import { triggerDailyAutoBackup } from "./backup.js";
import {
  createRevisionSnapshot,
  deleteNoteRevisionsForDeletedNote,
} from "./revision.js";
import { resolveSpaceAccess, getSpaceMembershipVersion } from "./spaces.js";
import { closeCollabDocumentSessions, pokePersonalClients, pokeSpaceSubscribers } from "./websocket.js";

const router = express.Router();

const ACCEPTED_TYPES = ["number", "string", "bigint"]; // plus Buffer & null
const SITE_ID_LEN = 16;

// COLLAB-04 §4.2: the exact set of tables/columns a shared-space sync may
// touch. Anything else — `users`, `images`, `settings`, unknown tables,
// `user_id`, or any future column — is rejected with the whole batch intact
// (no partial merge) until this allowlist is deliberately extended with
// schema tests. `-1` (and any other tombstone-cid spelling) is allowed for
// every listed table since crsqlite tombstones carry no column name.
const SPACE_CHANGE_ALLOWLIST = {
  folders: new Set(["id", "name", "parent_id", "created_at"]),
  notes: new Set([
    "id",
    "folder_id",
    "title",
    "content",
    "pinned",
    "created_at",
    "updated_at",
  ]),
  globals: new Set([
    "key",
    "id",
    "value",
    "created_at",
    "updated_at",
    "display_key",
  ]),
  templates: new Set([
    "id",
    "name",
    "content",
    "title_pattern",
    "default_folder_id",
    "created_at",
    "updated_at",
  ]),
  style_presets: new Set([
    "id",
    "kind",
    "name",
    "styles",
    "created_at",
    "updated_at",
  ]),
  style_assignments: new Set([
    "id",
    "target_type",
    "target_id",
    "kind",
    "preset_id",
    "updated_at",
  ]),
};

const PACKED_INTEGER = 1;
const PACKED_FLOAT = 2;
const PACKED_TEXT = 3;
const PACKED_BLOB = 4;
const PACKED_NULL = 5;

/**
 * True when `value` is a well-formed CR-SQLite packed primary key: a column
 * count followed, per column, by a type byte (low three bits the SQLite type,
 * the rest the width of the integer that follows) and its payload, with no
 * bytes left over.
 *
 * This is checked before a change reaches `crsql_changes` because the
 * extension unpacks the key in native code and aborts the whole process on a
 * malformed one — a single bad request would take the API down for everyone.
 */
export function isValidPackedPrimaryKey(value) {
  if (!Buffer.isBuffer(value) || value.length < 2) return false;

  const columnCount = value[0];
  if (columnCount < 1) return false;

  let offset = 1;
  for (let column = 0; column < columnCount; column += 1) {
    if (offset >= value.length) return false;
    const typeByte = value[offset];
    offset += 1;
    const type = typeByte & 0x07;
    const width = typeByte >> 3;

    if (type === PACKED_NULL) {
      if (width !== 0) return false;
    } else if (type === PACKED_FLOAT) {
      if (width !== 0) return false;
      offset += 8;
    } else if (type === PACKED_INTEGER) {
      if (width > 8) return false;
      offset += width;
    } else if (type === PACKED_TEXT || type === PACKED_BLOB) {
      if (width > 4 || offset + width > value.length) return false;
      let length = 0;
      for (let i = 0; i < width; i += 1) length = length * 256 + value[offset + i];
      offset += width + length;
    } else {
      return false;
    }
    if (offset > value.length) return false;
  }

  return offset === value.length;
}

/** Resolve a client-supplied primary key to its packed bytes, or null. */
function resolvePackedPrimaryKey(db, pk) {
  try {
    const parsed = JSON.parse(pk);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return db.prepare("SELECT crsql_pack_columns(?) as pk").get(parsed[0]).pk;
    }
  } catch {
    // Not a JSON key array; fall through to the byte forms.
  }
  return toBufferLike(pk);
}

/** Server-owned switch for automatic content-merge write-back; off unless set to "true". */
export function isContentMergeWritebackEnabled() {
  return process.env.CONTENT_MERGE_WRITEBACK_ENABLED === "true";
}

function isTombstoneCid(cid) {
  return cid == null || cid === "" || String(cid) === "-1";
}

/**
 * Logs a shared-space metadata operational failure (never the underlying
 * message/stack, which could contain internal detail) and formats a safe,
 * non-disclosing 500 for the HTTP caller. Used whenever `resolveSpaceAccess`
 * / `getSpaceMembershipVersion` throw — a genuine metadata failure must
 * surface as a server error, never be silently treated as "not found" or
 * "no version yet".
 */
function respondToSpaceMetadataError(res, event, error) {
  console.error("[sync]", JSON.stringify({
    event,
    category: error?.code || "space_metadata_error",
  }));
  return res.status(500).json({ error: "Internal server error" });
}

/**
 * True only when `pk` decodes (via the same `parsePkId` logic used to drive
 * merge-time note-revision extraction) to a non-empty string id. `folders`,
 * `notes`, `globals`, `templates`, `style_presets`, and `style_assignments`
 * all use a single TEXT PRIMARY KEY
 * column, so every allowlisted change — including a delete tombstone, which
 * still carries the pk of the row being deleted — must resolve to one. A
 * missing, empty, or otherwise malformed pk is never permitted for a
 * shared-space change.
 */
function hasValidSpaceChangePk(change) {
  const id = parsePkId(change?.pk);
  return typeof id === "string" && id.length > 0;
}

/**
 * Validates one shared-space change batch against the COLLAB-04 §4.2
 * allowlist. Pure/read-only — callers must reject the entire batch (no
 * partial merge) when this returns `false`.
 */
export function validateSpaceChangeBatch(changes) {
  for (const change of changes) {
    if (!change || typeof change !== "object") return false;
    const allowedCids = SPACE_CHANGE_ALLOWLIST[change.table];
    if (!allowedCids) return false;
    if (!hasValidSpaceChangePk(change)) return false;
    if (isTombstoneCid(change.cid)) continue;
    if (!allowedCids.has(String(change.cid))) return false;
  }
  return true;
}

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
  const requestedSpaceId = req.body?.space ?? null;

  // Absent `space` keeps the exact pre-Phase-2 personal-sync behavior and
  // wire shape. Present `space` is gated by the feature flag and active
  // membership (never a client-supplied user id) before the space content
  // database is ever opened; unknown space, disabled flag, and non-member
  // are all indistinguishable 404s (COLLAB-04 §4.2).
  let isSpaceSync = false;
  let spaceAccess;
  let dbKey = `user:${userId}`;

  if (requestedSpaceId != null) {
    // A space is named by its id, a string. Anything else is not a space: it
    // must never reach the access check, where an object once supplied its
    // own actor.
    if (typeof requestedSpaceId !== "string") {
      return res.status(404).json({ error: "Not found", code: "SPACE_NOT_FOUND" });
    }
    try {
      spaceAccess = resolveSpaceAccess(requestedSpaceId, userId);
    } catch (error) {
      return respondToSpaceMetadataError(res, "sync_space_access_error", error);
    }
    if (!spaceAccess) {
      return res.status(404).json({ error: "Not found", code: "SPACE_NOT_FOUND" });
    }
    isSpaceSync = true;
    dbKey = `space:${spaceAccess.spaceId}`;
  }

  if (changes.length > 0) {
    console.log(
      isSpaceSync
        ? `SERVER: Received ${changes.length} changes for a shared space sync`
        : `SERVER: Received ${changes.length} changes for user ${userId}`,
    );
  }

  // Validate the entire batch against the shared-space allowlist before the
  // space content database is even opened, and before any merge is
  // attempted: an invalid batch is rejected in full, never partially
  // merged.
  if (isSpaceSync && changes.length && !validateSpaceChangeBatch(changes)) {
    return res.status(400).json({
      error: "Change batch contains a table/column not permitted for shared spaces",
      code: "SPACE_CHANGE_NOT_ALLOWED",
    });
  }

  let db;
  try {
    db = getDb(dbKey);
  } catch (e) {
    return next(e);
  }

  let mergeAttempted = false;
  let mergeChange = null;
  try {
    // Read what other replicas changed since `since` BEFORE merging this
    // request's upload. Read afterwards, a value this upload overwrites has
    // already disappeared from crsql_changes (only the winning column version
    // is listed, and it is now the requester's own, which is filtered out), so
    // the requester would never learn that it replaced an edit it had not
    // seen. The pre-merge read is a superset of the post-merge one: it adds
    // exactly those displaced rows, which lose again when the requester
    // applies them and are therefore harmless to clients that ignore them.
    // The handler is synchronous, so no other request can interleave between
    // this read, the merge below, and the clock read after it.
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

    if (changes.length) {
      // Resolve and check every key before the first row is merged, so a
      // malformed batch is refused whole and never reaches the extension.
      const packedKeys = changes.map((change) => resolvePackedPrimaryKey(db, change?.pk));
      if (!packedKeys.every(isValidPackedPrimaryKey)) {
        return res.status(400).json({
          error: "Change batch contains a malformed primary key",
          code: "INVALID_CHANGE",
        });
      }

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

        for (const [index, ch] of rows.entries()) {
          const pkBytes = packedKeys[index];

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
            // Only a space sync attributes revisions to the server-derived
            // JWT actor; personal syncs keep the pre-Phase-2 behavior of no
            // actor attribution. A client can never supply these fields.
            ...(isSpaceSync ? { actorUserId: userId, actorKind: "sync" } : {}),
          });
        }
      });
      applyChanges(changes, noteMutations);

      // Notify other clients, excluding the one that sent the changes.
      // Personal sync keeps the exact legacy `{type:'sync'}` poke; a space
      // sync uses the v1 envelope and only reaches sockets currently
      // authorized (re-checked at poke time) and subscribed to this dbKey.
      const { clients } = req;
      if (isSpaceSync) {
        closeCollabDocumentSessions(
          clients,
          dbKey,
          noteMutations.filter((mutation) => mutation.deleted).map((mutation) => mutation.noteId),
        );
        pokeSpaceSubscribers(clients, dbKey, siteId);
      } else {
        pokePersonalClients(clients, userId, siteId);
      }
    }

    const clockRow = db
      .prepare(`SELECT max(db_version) as version FROM crsql_changes`)
      .get();
    const newClock = clockRow.version ?? since;

    const responseBody = {
      changes: remote,
      clock: newClock,
      skipped: 0,
      // Clients merge concurrent body edits automatically only while this is
      // true in the same successful response; absent or false means "hold both
      // sides for the user" (COLLAB-00 §4, COLLAB-02 §4.1).
      contentMergeWriteback: isContentMergeWritebackEnabled(),
    };
    if (isSpaceSync) {
      // Computed after the merge and remote-changes query so a metadata
      // failure here is never conflated with (and never treated as) a
      // crsqlite merge failure — the data already persisted; only the
      // enrichment membershipVersion field failed to compute.
      let currentMembershipVersion;
      try {
        currentMembershipVersion = getSpaceMembershipVersion(userId);
      } catch (error) {
        return respondToSpaceMetadataError(res, "sync_membership_version_error", error);
      }
      responseBody.membershipVersion = currentMembershipVersion;
    }
    res.json(responseBody);

    // A shared space has no personal GitHub auto backup target (Phase 6
    // will add a dedicated space backup producer); never trigger the
    // per-user backup job for a space sync.
    if (!isSpaceSync) {
      void triggerDailyAutoBackup(userId);
    }
  } catch (err) {
    if (mergeAttempted) {
      const failedChange = mergeChange;
      const pk = failedChange?.pk;
      // Invalidate exactly the targeted connection (personal or space); the
      // canonical dbKey form means this never touches an unrelated database.
      const invalidated = invalidateDb(dbKey, db, "crsqlite-merge-failure");
      const [dbKeyKind, dbKeyId] = dbKey.split(":");
      console.error("[sync]", JSON.stringify({
        event: "sync_crsqlite_merge_failure",
        dbKey: `${dbKeyKind}:${dbKeyId.slice(0, 2)}…${dbKeyId.slice(-2)}`,
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
