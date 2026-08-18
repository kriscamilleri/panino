import { v4 as uuidv4, validate as validateUuid } from "uuid";
import express from "express";
import { CONTENT_SCHEMA_VERSION, getAuthDb, getSpacesDb } from "./db.js";

const ALLOWED_ROLES = new Set(["owner", "editor"]);

export class SpaceRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SpaceRepositoryError";
    this.code = code;
  }
}

export function isSharedSpacesEnabled() {
  return process.env.SHARED_SPACES_ENABLED === "true";
}

function requireEnabled() {
  if (!isSharedSpacesEnabled()) {
    throw new SpaceRepositoryError(
      "SHARED_SPACES_DISABLED",
      "Shared spaces are disabled",
    );
  }
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !validateUuid(value)) {
    throw new SpaceRepositoryError("INVALID_UUID", `${field} must be a UUID`);
  }
  return value;
}

function requireRole(role) {
  if (!ALLOWED_ROLES.has(role)) {
    throw new SpaceRepositoryError(
      "INVALID_SPACE_ROLE",
      "Space role must be owner or editor",
    );
  }
  return role;
}

function requireEditorRole(role) {
  requireRole(role);
  if (role !== "editor") {
    throw new SpaceRepositoryError(
      "INVALID_SPACE_ROLE",
      "Members can only be added as editors",
    );
  }
}

function requireUser(userId) {
  requireUuid(userId, "userId");
  const user = getAuthDb()
    .prepare("SELECT id FROM users WHERE id = ?")
    .get(userId);
  if (!user) {
    throw new SpaceRepositoryError("USER_NOT_FOUND", "User not found");
  }
  return user;
}

function requireOwner(db, spaceId, actorUserId) {
  const owner = db
    .prepare(
      `SELECT s.id
         FROM spaces s
         JOIN space_members m
           ON m.space_id = s.id
          AND m.user_id = s.owner_user_id
          AND m.role = 'owner'
        WHERE s.id = ?
          AND s.owner_user_id = ?
          AND m.user_id = ?
          AND s.status = 'active'`,
    )
    .get(spaceId, actorUserId, actorUserId);

  if (!owner) {
    throw new SpaceRepositoryError(
      "SPACE_OWNER_REQUIRED",
      "Only the current space owner may manage members",
    );
  }
}

function bumpUserVersion(db, userId) {
  db.prepare(
    `INSERT INTO space_user_versions (user_id, version)
     VALUES (?, 1)
     ON CONFLICT(user_id) DO UPDATE SET version = version + 1`,
  ).run(userId);
}

function membershipVersion(db, userId) {
  return (
    db
      .prepare("SELECT version FROM space_user_versions WHERE user_id = ?")
      .get(userId)?.version ?? 0
  );
}

function membershipQuery(db, spaceId, userId) {
  return db
    .prepare(
      `SELECT s.id AS spaceId,
              s.name,
              s.status,
              s.owner_user_id AS ownerUserId,
              s.created_at AS createdAt,
              s.updated_at AS updatedAt,
              m.user_id AS userId,
              m.role,
              m.invited_by AS invitedBy,
              m.created_at AS memberSince
         FROM spaces s
         JOIN space_members m ON m.space_id = s.id
        WHERE s.id = ? AND m.user_id = ? AND s.status = 'active'`,
    )
    .get(spaceId, userId);
}

function tableExists(db, name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
}

/**
 * Read-only invariant sweep over `_spaces.db` (phase-0 design artifacts §2).
 * Returns { ok, violations } and, when `throwOnViolation` (the default),
 * throws SpaceRepositoryError("SPACE_INVARIANT_VIOLATION", ...) on any
 * failure so the caller's transaction rolls back rather than guessing a
 * repair. The thrown message is intentionally generic; violation detail is
 * only logged server-side (never surfaced to an HTTP caller).
 */
export function assertSpacesInvariants(db, { throwOnViolation = true } = {}) {
  const violations = [];

  // 1 & 6: every space has exactly one owner membership agreeing with
  // spaces.owner_user_id; more than one is a duplicate-owner violation.
  const spaces = db
    .prepare("SELECT id, owner_user_id AS ownerUserId FROM spaces")
    .all();
  for (const space of spaces) {
    const owners = db
      .prepare(
        "SELECT user_id AS userId FROM space_members WHERE space_id = ? AND role = 'owner'",
      )
      .all(space.id);
    if (owners.length === 0) {
      violations.push({ code: "SPACE_OWNER_MISSING", spaceId: space.id });
    } else if (owners.length > 1) {
      violations.push({ code: "SPACE_DUPLICATE_OWNER", spaceId: space.id });
    } else if (owners[0].userId !== space.ownerUserId) {
      violations.push({ code: "SPACE_OWNER_MISMATCH", spaceId: space.id });
    }
  }

  // 2: no orphaned space_members / space_invites rows.
  const orphanMembers = db
    .prepare(
      "SELECT DISTINCT space_id AS spaceId FROM space_members WHERE space_id NOT IN (SELECT id FROM spaces)",
    )
    .all();
  for (const row of orphanMembers) {
    violations.push({ code: "SPACE_ORPHAN_MEMBER", spaceId: row.spaceId });
  }

  if (tableExists(db, "space_invites")) {
    const orphanInvites = db
      .prepare(
        "SELECT DISTINCT space_id AS spaceId FROM space_invites WHERE space_id NOT IN (SELECT id FROM spaces)",
      )
      .all();
    for (const row of orphanInvites) {
      violations.push({ code: "SPACE_ORPHAN_INVITE", spaceId: row.spaceId });
    }
  }

  // 3 & 5: every referenced user id (member or owner) must exist in the auth
  // DB, and must have a space_user_versions row (no gaps).
  const referencedUserIds = new Set([
    ...db
      .prepare("SELECT DISTINCT user_id AS userId FROM space_members")
      .all()
      .map((r) => r.userId),
    ...db
      .prepare("SELECT DISTINCT owner_user_id AS userId FROM spaces")
      .all()
      .map((r) => r.userId),
  ]);

  if (referencedUserIds.size > 0) {
    const authDb = getAuthDb();
    const authExists = authDb.prepare("SELECT 1 FROM users WHERE id = ?");
    for (const userId of referencedUserIds) {
      if (!authExists.get(userId)) {
        violations.push({ code: "SPACE_MEMBER_USER_MISSING", userId });
      }
    }

    const versionExists = db.prepare(
      "SELECT 1 FROM space_user_versions WHERE user_id = ?",
    );
    for (const userId of referencedUserIds) {
      if (!versionExists.get(userId)) {
        violations.push({ code: "SPACE_VERSION_MISSING", userId });
      }
    }
  }

  // 4: status/delete_after pairing.
  const pairingViolations = db
    .prepare(
      `SELECT id AS spaceId FROM spaces
        WHERE (status = 'pending_delete' AND delete_after IS NULL)
           OR (status = 'active' AND delete_after IS NOT NULL)`,
    )
    .all();
  for (const row of pairingViolations) {
    violations.push({
      code: "SPACE_STATUS_DELETE_AFTER_MISMATCH",
      spaceId: row.spaceId,
    });
  }

  const ok = violations.length === 0;
  if (!ok) {
    console.error(
      "[spaces]",
      JSON.stringify({
        event: "space_invariant_violation",
        count: violations.length,
        codes: [...new Set(violations.map((v) => v.code))],
      }),
    );
    if (throwOnViolation) {
      throw new SpaceRepositoryError(
        "SPACE_INVARIANT_VIOLATION",
        "Shared-space metadata failed an integrity check",
      );
    }
  }

  return { ok, violations };
}

function createArgs(actorOrOptions, name) {
  if (actorOrOptions && typeof actorOrOptions === "object") {
    return {
      actorUserId: actorOrOptions.actorUserId,
      name: actorOrOptions.name,
    };
  }
  return { actorUserId: actorOrOptions, name };
}

function memberArgs(actorOrOptions, spaceId, userId, role) {
  if (actorOrOptions && typeof actorOrOptions === "object") {
    return {
      actorUserId: actorOrOptions.actorUserId,
      spaceId: actorOrOptions.spaceId,
      userId: actorOrOptions.userId,
      role: actorOrOptions.role ?? "editor",
    };
  }
  return {
    actorUserId: actorOrOptions,
    spaceId,
    userId,
    role: role ?? "editor",
  };
}

/**
 * Create a space and its sole owner membership as one _spaces.db transaction.
 * actorUserId must come from trusted authentication context at the future call site.
 */
export function createSpace(actorOrOptions, suppliedName) {
  requireEnabled();
  const { actorUserId, name } = createArgs(actorOrOptions, suppliedName);
  requireUser(actorUserId);

  const normalizedName = typeof name === "string" ? name.trim() : "";
  if (!normalizedName) {
    throw new SpaceRepositoryError("INVALID_SPACE_NAME", "Space name is required");
  }

  const db = getSpacesDb();
  const spaceId = uuidv4();
  const now = new Date().toISOString();

  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO spaces
         (id, name, owner_user_id, status, delete_after, created_at, updated_at)
       VALUES (?, ?, ?, 'active', NULL, ?, ?)`,
    ).run(spaceId, normalizedName, actorUserId, now, now);
    db.prepare(
      `INSERT INTO space_members
         (space_id, user_id, role, invited_by, created_at)
       VALUES (?, ?, 'owner', NULL, ?)`,
    ).run(spaceId, actorUserId, now);
    bumpUserVersion(db, actorUserId);
    assertSpacesInvariants(db);
  });

  create();
  return {
    ...membershipQuery(db, spaceId, actorUserId),
    membershipVersion: membershipVersion(db, actorUserId),
  };
}

export function getSpaceMembership(spaceOrOptions, suppliedUserId) {
  requireEnabled();
  const spaceId =
    spaceOrOptions && typeof spaceOrOptions === "object"
      ? spaceOrOptions.spaceId
      : spaceOrOptions;
  const userId =
    spaceOrOptions && typeof spaceOrOptions === "object"
      ? spaceOrOptions.userId
      : suppliedUserId;

  requireUuid(spaceId, "spaceId");
  requireUser(userId);
  return membershipQuery(getSpacesDb(), spaceId, userId) ?? null;
}

export function listSpacesForUser(userOrOptions) {
  requireEnabled();
  const userId =
    userOrOptions && typeof userOrOptions === "object"
      ? userOrOptions.userId
      : userOrOptions;
  requireUser(userId);

  const db = getSpacesDb();
  const spaces = db
    .prepare(
      `SELECT s.id AS spaceId,
              s.name,
              s.status,
              s.owner_user_id AS ownerUserId,
              s.created_at AS createdAt,
              s.updated_at AS updatedAt,
              m.role,
              m.created_at AS memberSince
         FROM spaces s
         JOIN space_members m ON m.space_id = s.id
        WHERE m.user_id = ? AND s.status = 'active'
        ORDER BY s.created_at ASC, s.id ASC`,
    )
    .all(userId);

  return { spaces, membershipVersion: membershipVersion(db, userId) };
}

function encodeSpaceCursor(space) {
  return Buffer.from(JSON.stringify([space.createdAt, space.spaceId]), "utf8").toString("base64url");
}

function decodeSpaceCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== "string" ||
      typeof decoded[1] !== "string" ||
      !validateUuid(decoded[1])
    ) {
      return null;
    }
    return { createdAt: decoded[0], spaceId: decoded[1] };
  } catch {
    return null;
  }
}

/**
 * Paginated, read-only discovery payload for a member's local registry.
 * Member profiles intentionally expose only `{id, name}`.
 */
export function listSpaceMembershipPage({ userId, cursor = null, limit = 25 }) {
  requireEnabled();
  requireUser(userId);
  const boundedLimit = Math.min(50, Math.max(1, Number(limit) || 25));
  const decodedCursor = cursor ? decodeSpaceCursor(cursor) : null;
  if (cursor && !decodedCursor) {
    throw new SpaceRepositoryError("INVALID_SPACE_CURSOR", "Invalid space-list cursor");
  }

  const db = getSpacesDb();
  const cursorSql = decodedCursor
    ? "AND (s.created_at > ? OR (s.created_at = ? AND s.id > ?))"
    : "";
  const params = decodedCursor
    ? [userId, decodedCursor.createdAt, decodedCursor.createdAt, decodedCursor.spaceId, boundedLimit + 1]
    : [userId, boundedLimit + 1];
  const rows = db.prepare(
    `SELECT s.id AS spaceId,
            s.name,
            s.owner_user_id AS ownerUserId,
            s.created_at AS createdAt,
            s.updated_at AS updatedAt,
            m.role,
            m.created_at AS memberSince
       FROM spaces s
       JOIN space_members m ON m.space_id = s.id
      WHERE m.user_id = ? AND s.status = 'active'
      ${cursorSql}
      ORDER BY s.created_at ASC, s.id ASC
      LIMIT ?`,
  ).all(...params);

  const hasNextPage = rows.length > boundedLimit;
  const spaces = rows.slice(0, boundedLimit);
  const authDb = getAuthDb();
  const memberRows = db.prepare(
    `SELECT user_id AS id
       FROM space_members
      WHERE space_id = ?
      ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC, user_id ASC`,
  );
  const userName = authDb.prepare("SELECT name FROM users WHERE id = ?");
  for (const space of spaces) {
    space.members = memberRows.all(space.spaceId).map(({ id }) => ({
      id,
      name: userName.get(id)?.name || "Unknown collaborator",
    }));
  }

  return {
    spaces,
    membershipVersion: membershipVersion(db, userId),
    minimum_client_schema: CONTENT_SCHEMA_VERSION,
    nextCursor: hasNextPage ? encodeSpaceCursor(spaces.at(-1)) : null,
  };
}

export const spaceRoutes = express.Router();

spaceRoutes.get("/spaces", (req, res) => {
  try {
    const page = listSpaceMembershipPage({
      userId: req.user.user_id,
      cursor: req.query.cursor || null,
      limit: req.query.limit,
    });
    res.json(page);
  } catch (error) {
    if (error?.code === "SHARED_SPACES_DISABLED") {
      return res.status(404).json({ error: "Not found", code: "SPACE_NOT_FOUND" });
    }
    if (error?.code === "INVALID_SPACE_CURSOR") {
      return res.status(400).json({ error: "Invalid cursor", code: error.code });
    }
    console.error("[spaces] discovery failed", { code: error?.code || "UNKNOWN" });
    return res.status(500).json({ error: "Unable to list spaces" });
  }
});

export function addEditorMember(
  actorOrOptions,
  suppliedSpaceId,
  suppliedUserId,
  suppliedRole = "editor",
) {
  requireEnabled();
  const { actorUserId, spaceId, userId, role } = memberArgs(
    actorOrOptions,
    suppliedSpaceId,
    suppliedUserId,
    suppliedRole,
  );
  requireUuid(actorUserId, "actorUserId");
  requireUuid(spaceId, "spaceId");
  requireUuid(userId, "userId");
  requireEditorRole(role);
  requireUser(actorUserId);

  const db = getSpacesDb();
  const now = new Date().toISOString();
  const add = db.transaction(() => {
    requireOwner(db, spaceId, actorUserId);
    requireUser(userId);
    db.prepare(
      `INSERT INTO space_members
         (space_id, user_id, role, invited_by, created_at)
       VALUES (?, ?, 'editor', ?, ?)`,
    ).run(spaceId, userId, actorUserId, now);
    bumpUserVersion(db, userId);
    assertSpacesInvariants(db);
  });

  try {
    add();
  } catch (error) {
    if (error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
      throw new SpaceRepositoryError(
        "SPACE_MEMBER_EXISTS",
        "User is already a member of this space",
      );
    }
    throw error;
  }

  return {
    ...membershipQuery(db, spaceId, userId),
    membershipVersion: membershipVersion(db, userId),
  };
}

export function removeEditorMember(
  actorOrOptions,
  suppliedSpaceId,
  suppliedUserId,
) {
  requireEnabled();
  const { actorUserId, spaceId, userId } = memberArgs(
    actorOrOptions,
    suppliedSpaceId,
    suppliedUserId,
    "editor",
  );
  requireUuid(actorUserId, "actorUserId");
  requireUuid(spaceId, "spaceId");
  requireUuid(userId, "userId");
  requireUser(actorUserId);

  const db = getSpacesDb();
  const remove = db.transaction(() => {
    requireOwner(db, spaceId, actorUserId);
    requireUser(userId);
    const membership = db
      .prepare(
        "SELECT role FROM space_members WHERE space_id = ? AND user_id = ?",
      )
      .get(spaceId, userId);

    if (!membership) {
      throw new SpaceRepositoryError(
        "SPACE_MEMBER_NOT_FOUND",
        "Space member not found",
      );
    }
    if (membership.role === "owner") {
      throw new SpaceRepositoryError(
        "SPACE_OWNER_REMOVAL_DENIED",
        "The owner cannot be removed or demoted",
      );
    }

    const result = db
      .prepare(
        `DELETE FROM space_members
          WHERE space_id = ? AND user_id = ? AND role = 'editor'`,
      )
      .run(spaceId, userId);
    if (result.changes !== 1) {
      throw new SpaceRepositoryError(
        "SPACE_MEMBER_NOT_FOUND",
        "Editor membership not found",
      );
    }
    bumpUserVersion(db, userId);
    assertSpacesInvariants(db);
  });

  remove();
  return { spaceId, userId, membershipVersion: membershipVersion(db, userId) };
}

/**
 * The one shared-space authorization resolver for `/sync` and the WebSocket
 * subscribe/poke paths (COLLAB-04 §4.2, §4.3). It never trusts a
 * client-supplied user id: `actorUserId` must come from `req.user.user_id`
 * (the authenticated JWT subject) at every call site. It never throws for an
 * ordinary "no access" outcome — disabled flag, invalid input, unknown
 * space, non-member, and pending-deletion space are all indistinguishable
 * `null` so a caller cannot use it to probe space existence. It returns the
 * active membership plus the caller's current space_user_versions version.
 *
 * A genuine metadata operational failure (e.g. `_spaces.db` unreadable) is
 * NOT swallowed into that same `null` — it propagates as a thrown error, so
 * callers can tell "not a member" apart from "we couldn't check" and
 * respond accordingly (never as a disclosing detail, but never as a silent
 * false negative either).
 */
export function resolveSpaceAccess(spaceOrOptions, suppliedActorUserId) {
  const spaceId =
    spaceOrOptions && typeof spaceOrOptions === "object"
      ? spaceOrOptions.spaceId
      : spaceOrOptions;
  const actorUserId =
    spaceOrOptions && typeof spaceOrOptions === "object"
      ? spaceOrOptions.actorUserId
      : suppliedActorUserId;

  if (!isSharedSpacesEnabled()) return null;
  if (typeof spaceId !== "string" || !validateUuid(spaceId)) return null;
  if (typeof actorUserId !== "string" || !validateUuid(actorUserId)) return null;

  const db = getSpacesDb();
  const membership = membershipQuery(db, spaceId, actorUserId);
  if (!membership) return null;
  return {
    spaceId: membership.spaceId,
    role: membership.role,
    membershipVersion: membershipVersion(db, actorUserId),
  };
}

/**
 * The caller's current space_user_versions version, or 0 when shared spaces
 * are disabled, the user id is invalid, or the user has no space activity
 * yet. Never returns 0 for a genuine metadata operational failure — see
 * `resolveSpaceAccess` above for the same rationale; that case propagates as
 * a thrown error instead so it can be surfaced as a real server failure.
 */
export function getSpaceMembershipVersion(userId) {
  if (!isSharedSpacesEnabled()) return 0;
  if (typeof userId !== "string" || !validateUuid(userId)) return 0;
  return membershipVersion(getSpacesDb(), userId);
}
