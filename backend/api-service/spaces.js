import { v4 as uuidv4, validate as validateUuid } from "uuid";
import { getAuthDb, getSpacesDb } from "./db.js";

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
        WHERE s.id = ? AND m.user_id = ?`,
    )
    .get(spaceId, userId);
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
  });

  remove();
  return { spaceId, userId, membershipVersion: membershipVersion(db, userId) };
}
