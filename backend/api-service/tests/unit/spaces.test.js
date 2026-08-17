import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const databaseMocks = vi.hoisted(() => ({
  getAuthDb: vi.fn(),
  getSpacesDb: vi.fn(),
}));

vi.mock("../../db.js", () => databaseMocks);

import {
  addEditorMember,
  assertSpacesInvariants,
  createSpace,
  getSpaceMembership,
  getSpaceMembershipVersion,
  isSharedSpacesEnabled,
  listSpacesForUser,
  removeEditorMember,
  resolveSpaceAccess,
} from "../../spaces.js";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const EDITOR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

const SPACES_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE spaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'pending_delete')),
    delete_after TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE space_members (
    space_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor'
      CHECK (role IN ('owner', 'editor')),
    invited_by TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (space_id, user_id)
  );
  CREATE TABLE space_invites (
    token_hash TEXT PRIMARY KEY NOT NULL,
    space_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor' CHECK (role = 'editor'),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_space_members_one_owner
    ON space_members(space_id) WHERE role = 'owner';
  CREATE TABLE space_user_versions (
    user_id TEXT PRIMARY KEY NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );
`;

let authDb;
let spacesDb;

function addAuthUser(id) {
  authDb.prepare("INSERT INTO users (id) VALUES (?)").run(id);
}

function versionFor(userId) {
  return spacesDb
    .prepare("SELECT version FROM space_user_versions WHERE user_id = ?")
    .get(userId)?.version ?? 0;
}

beforeEach(() => {
  process.env.SHARED_SPACES_ENABLED = "true";
  authDb = new Database(":memory:");
  spacesDb = new Database(":memory:");
  authDb.exec("CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL)");
  spacesDb.exec(SPACES_SCHEMA);
  addAuthUser(OWNER_ID);
  addAuthUser(EDITOR_ID);
  addAuthUser(OTHER_ID);
  databaseMocks.getAuthDb.mockReturnValue(authDb);
  databaseMocks.getSpacesDb.mockReturnValue(spacesDb);
});

afterEach(() => {
  delete process.env.SHARED_SPACES_ENABLED;
  authDb.close();
  spacesDb.close();
  vi.clearAllMocks();
});

describe("shared-spaces feature flag", () => {
  it("fails closed when absent or not exactly 'true'", () => {
    delete process.env.SHARED_SPACES_ENABLED;
    expect(isSharedSpacesEnabled()).toBe(false);
    expect(() => listSpacesForUser(OWNER_ID)).toThrowError(
      expect.objectContaining({ code: "SHARED_SPACES_DISABLED" }),
    );

    process.env.SHARED_SPACES_ENABLED = "TRUE";
    expect(isSharedSpacesEnabled()).toBe(false);

    process.env.SHARED_SPACES_ENABLED = "true";
    expect(isSharedSpacesEnabled()).toBe(true);
  });
});

describe("space membership repository", () => {
  it("creates a UUID space and owner membership atomically, then lists it", () => {
    const created = createSpace({ actorUserId: OWNER_ID, name: "  Product  " });

    expect(created).toMatchObject({
      name: "Product",
      ownerUserId: OWNER_ID,
      userId: OWNER_ID,
      role: "owner",
      membershipVersion: 1,
    });
    expect(created.spaceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(getSpaceMembership(created.spaceId, OWNER_ID)).toMatchObject({
      spaceId: created.spaceId,
      role: "owner",
    });
    expect(listSpacesForUser(OWNER_ID)).toEqual({
      spaces: [
        expect.objectContaining({
          spaceId: created.spaceId,
          name: "Product",
          role: "owner",
        }),
      ],
      membershipVersion: 1,
    });
  });

  it("adds and removes an editor and bumps that user's version each time", () => {
    const space = createSpace(OWNER_ID, "Team");

    const added = addEditorMember(OWNER_ID, space.spaceId, EDITOR_ID);
    expect(added).toMatchObject({
      spaceId: space.spaceId,
      userId: EDITOR_ID,
      role: "editor",
      invitedBy: OWNER_ID,
      membershipVersion: 1,
    });
    expect(listSpacesForUser(EDITOR_ID).spaces).toHaveLength(1);

    const removed = removeEditorMember({
      actorUserId: OWNER_ID,
      spaceId: space.spaceId,
      userId: EDITOR_ID,
    });
    expect(removed.membershipVersion).toBe(2);
    expect(getSpaceMembership(space.spaceId, EDITOR_ID)).toBeNull();
    expect(listSpacesForUser(EDITOR_ID)).toEqual({
      spaces: [],
      membershipVersion: 2,
    });
  });

  it("authenticates the actor as owner from membership data", () => {
    const space = createSpace(OWNER_ID, "Team");
    addEditorMember(OWNER_ID, space.spaceId, EDITOR_ID);

    expect(() =>
      addEditorMember(EDITOR_ID, space.spaceId, OTHER_ID),
    ).toThrowError(expect.objectContaining({ code: "SPACE_OWNER_REQUIRED" }));
    expect(() =>
      removeEditorMember(EDITOR_ID, space.spaceId, OWNER_ID),
    ).toThrowError(expect.objectContaining({ code: "SPACE_OWNER_REQUIRED" }));
    expect(getSpaceMembership(space.spaceId, OTHER_ID)).toBeNull();
  });

  it("rejects viewer memberships and non-existent auth users", () => {
    const space = createSpace(OWNER_ID, "Team");
    const missingUserId = "44444444-4444-4444-8444-444444444444";

    expect(() =>
      addEditorMember({
        actorUserId: OWNER_ID,
        spaceId: space.spaceId,
        userId: EDITOR_ID,
        role: "viewer",
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_SPACE_ROLE" }));
    expect(() =>
      addEditorMember(OWNER_ID, space.spaceId, missingUserId),
    ).toThrowError(expect.objectContaining({ code: "USER_NOT_FOUND" }));
    expect(
      spacesDb.prepare("SELECT COUNT(*) AS count FROM space_members").get()
        .count,
    ).toBe(1);
  });

  it("never removes or demotes the owner", () => {
    const space = createSpace(OWNER_ID, "Team");

    expect(() =>
      removeEditorMember(OWNER_ID, space.spaceId, OWNER_ID),
    ).toThrowError(
      expect.objectContaining({ code: "SPACE_OWNER_REMOVAL_DENIED" }),
    );
    expect(getSpaceMembership(space.spaceId, OWNER_ID)?.role).toBe("owner");
    expect(versionFor(OWNER_ID)).toBe(1);
  });
});

describe("transaction invariants", () => {
  it("rolls back the space when owner membership creation fails", () => {
    spacesDb.exec(`
      CREATE TRIGGER reject_owner_membership
      BEFORE INSERT ON space_members
      WHEN NEW.role = 'owner'
      BEGIN
        SELECT RAISE(ABORT, 'forced owner membership failure');
      END;
    `);

    expect(() => createSpace(OWNER_ID, "Cannot partially exist")).toThrow(
      "forced owner membership failure",
    );
    expect(spacesDb.prepare("SELECT COUNT(*) AS count FROM spaces").get().count).toBe(0);
    expect(
      spacesDb.prepare("SELECT COUNT(*) AS count FROM space_members").get()
        .count,
    ).toBe(0);
    expect(versionFor(OWNER_ID)).toBe(0);
  });

  it("rolls back editor insertion when the version bump fails", () => {
    const space = createSpace(OWNER_ID, "Team");
    spacesDb.exec(`
      CREATE TRIGGER reject_editor_version
      BEFORE INSERT ON space_user_versions
      WHEN NEW.user_id = '22222222-2222-4222-8222-222222222222'
      BEGIN
        SELECT RAISE(ABORT, 'forced version failure');
      END;
    `);

    expect(() =>
      addEditorMember(OWNER_ID, space.spaceId, EDITOR_ID),
    ).toThrow("forced version failure");
    expect(getSpaceMembership(space.spaceId, EDITOR_ID)).toBeNull();
    expect(versionFor(EDITOR_ID)).toBe(0);
  });

  it("rolls back editor deletion when the version increment fails", () => {
    const space = createSpace(OWNER_ID, "Team");
    addEditorMember(OWNER_ID, space.spaceId, EDITOR_ID);
    spacesDb.exec(`
      CREATE TRIGGER reject_editor_version_update
      BEFORE UPDATE ON space_user_versions
      WHEN OLD.user_id = '22222222-2222-4222-8222-222222222222'
      BEGIN
        SELECT RAISE(ABORT, 'forced version increment failure');
      END;
    `);

    expect(() =>
      removeEditorMember(OWNER_ID, space.spaceId, EDITOR_ID),
    ).toThrow("forced version increment failure");
    expect(getSpaceMembership(space.spaceId, EDITOR_ID)?.role).toBe("editor");
    expect(versionFor(EDITOR_ID)).toBe(1);
  });
});

describe("assertSpacesInvariants", () => {
  it("reports ok with no violations on a healthy repository", () => {
    const space = createSpace(OWNER_ID, "Healthy");
    addEditorMember(OWNER_ID, space.spaceId, EDITOR_ID);

    const report = assertSpacesInvariants(spacesDb, { throwOnViolation: false });
    expect(report).toEqual({ ok: true, violations: [] });
    expect(() => assertSpacesInvariants(spacesDb)).not.toThrow();
  });

  it("detects a space with no owner membership row", () => {
    const space = createSpace(OWNER_ID, "No Owner");
    spacesDb
      .prepare("DELETE FROM space_members WHERE space_id = ? AND role = 'owner'")
      .run(space.spaceId);

    const report = assertSpacesInvariants(spacesDb, { throwOnViolation: false });
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual({
      code: "SPACE_OWNER_MISSING",
      spaceId: space.spaceId,
    });
    expect(() => assertSpacesInvariants(spacesDb)).toThrowError(
      expect.objectContaining({ code: "SPACE_INVARIANT_VIOLATION" }),
    );
  });

  it("detects duplicate owner memberships for the same space", () => {
    const space = createSpace(OWNER_ID, "Dup Owner");
    // Bypass the partial unique index by disabling it for this raw insert
    // path: drop and skip recreating it so two owner rows can coexist,
    // simulating the exact drift the checker exists to catch.
    spacesDb.exec("DROP INDEX idx_space_members_one_owner");
    spacesDb
      .prepare(
        `INSERT INTO space_members (space_id, user_id, role, invited_by, created_at)
         VALUES (?, ?, 'owner', NULL, datetime('now'))`,
      )
      .run(space.spaceId, EDITOR_ID);

    const report = assertSpacesInvariants(spacesDb, { throwOnViolation: false });
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual({
      code: "SPACE_DUPLICATE_OWNER",
      spaceId: space.spaceId,
    });
  });

  it("detects an owner membership that disagrees with spaces.owner_user_id", () => {
    const space = createSpace(OWNER_ID, "Mismatch");
    spacesDb
      .prepare("UPDATE space_members SET user_id = ? WHERE space_id = ? AND role = 'owner'")
      .run(OTHER_ID, space.spaceId);

    const report = assertSpacesInvariants(spacesDb, { throwOnViolation: false });
    expect(report.violations).toContainEqual({
      code: "SPACE_OWNER_MISMATCH",
      spaceId: space.spaceId,
    });
  });

  it("detects orphaned space_members and space_invites rows", () => {
    createSpace(OWNER_ID, "Real Space");
    spacesDb
      .prepare(
        `INSERT INTO space_members (space_id, user_id, role, invited_by, created_at)
         VALUES ('missing-space', ?, 'editor', NULL, datetime('now'))`,
      )
      .run(EDITOR_ID);
    spacesDb
      .prepare(
        `INSERT INTO space_invites (token_hash, space_id, email, role, expires_at, created_at)
         VALUES ('tok-1', 'missing-space-2', 'a@example.com', 'editor', datetime('now', '+7 days'), datetime('now'))`,
      )
      .run();

    const report = assertSpacesInvariants(spacesDb, { throwOnViolation: false });
    expect(report.violations).toContainEqual({
      code: "SPACE_ORPHAN_MEMBER",
      spaceId: "missing-space",
    });
    expect(report.violations).toContainEqual({
      code: "SPACE_ORPHAN_INVITE",
      spaceId: "missing-space-2",
    });
  });

  it("detects a member/owner id absent from the auth users table", () => {
    const space = createSpace(OWNER_ID, "Ghost Member");
    // Insert a membership row for a user id the auth DB has never heard of,
    // bypassing addEditorMember's requireUser check on purpose.
    spacesDb
      .prepare(
        `INSERT INTO space_members (space_id, user_id, role, invited_by, created_at)
         VALUES (?, '99999999-9999-4999-8999-999999999999', 'editor', ?, datetime('now'))`,
      )
      .run(space.spaceId, OWNER_ID);
    spacesDb
      .prepare(
        `INSERT INTO space_user_versions (user_id, version) VALUES (?, 1)`,
      )
      .run("99999999-9999-4999-8999-999999999999");

    const report = assertSpacesInvariants(spacesDb, { throwOnViolation: false });
    expect(report.violations).toContainEqual({
      code: "SPACE_MEMBER_USER_MISSING",
      userId: "99999999-9999-4999-8999-999999999999",
    });
  });

  it("detects a missing space_user_versions row for a member", () => {
    const space = createSpace(OWNER_ID, "Version Gap");
    addEditorMember(OWNER_ID, space.spaceId, EDITOR_ID);
    spacesDb.prepare("DELETE FROM space_user_versions WHERE user_id = ?").run(EDITOR_ID);

    const report = assertSpacesInvariants(spacesDb, { throwOnViolation: false });
    expect(report.violations).toContainEqual({
      code: "SPACE_VERSION_MISSING",
      userId: EDITOR_ID,
    });
  });

  it("detects status/delete_after pairing violations", () => {
    const space = createSpace(OWNER_ID, "Pending");
    spacesDb
      .prepare("UPDATE spaces SET status = 'pending_delete' WHERE id = ?")
      .run(space.spaceId);

    let report = assertSpacesInvariants(spacesDb, { throwOnViolation: false });
    expect(report.violations).toContainEqual({
      code: "SPACE_STATUS_DELETE_AFTER_MISMATCH",
      spaceId: space.spaceId,
    });

    spacesDb
      .prepare("UPDATE spaces SET delete_after = datetime('now', '+30 days') WHERE id = ?")
      .run(space.spaceId);
    report = assertSpacesInvariants(spacesDb, { throwOnViolation: false });
    expect(report.ok).toBe(true);

    spacesDb
      .prepare("UPDATE spaces SET status = 'active' WHERE id = ?")
      .run(space.spaceId);
    report = assertSpacesInvariants(spacesDb, { throwOnViolation: false });
    expect(report.violations).toContainEqual({
      code: "SPACE_STATUS_DELETE_AFTER_MISMATCH",
      spaceId: space.spaceId,
    });
  });

  it("is invoked inside createSpace/addEditorMember/removeEditorMember and rolls back the whole mutation on a pre-existing invariant violation", () => {
    const space = createSpace(OWNER_ID, "Guarded");
    addEditorMember(OWNER_ID, space.spaceId, EDITOR_ID);

    // Corrupt an unrelated space's owner row directly (bypassing the
    // repository) so the *next* mutation's pre-commit invariant sweep, which
    // scans the whole _spaces.db, fails even though the mutation itself
    // (removing an editor from a different, healthy space) is valid in
    // isolation. This proves the checker runs inside these transactions and
    // that any violation rolls back the entire mutation, not a partial one.
    const otherSpace = createSpace(OTHER_ID, "Unrelated");
    spacesDb
      .prepare("DELETE FROM space_members WHERE space_id = ? AND role = 'owner'")
      .run(otherSpace.spaceId);

    expect(() =>
      removeEditorMember(OWNER_ID, space.spaceId, EDITOR_ID),
    ).toThrowError(expect.objectContaining({ code: "SPACE_INVARIANT_VIOLATION" }));
    // The removal this call attempted rolled back: the editor membership is
    // still present.
    expect(getSpaceMembership(space.spaceId, EDITOR_ID)?.role).toBe("editor");
  });
});

describe("resolveSpaceAccess", () => {
  it("returns null when shared spaces are disabled, regardless of membership", () => {
    const space = createSpace(OWNER_ID, "Gate");
    delete process.env.SHARED_SPACES_ENABLED;
    expect(resolveSpaceAccess(space.spaceId, OWNER_ID)).toBeNull();
  });

  it("returns null for invalid space or actor ids without throwing", () => {
    expect(resolveSpaceAccess("not-a-uuid", OWNER_ID)).toBeNull();
    expect(resolveSpaceAccess("11111111-1111-4111-8111-111111111111", "also-not-a-uuid")).toBeNull();
  });

  it("returns null for a non-member (does not disclose space existence)", () => {
    const space = createSpace(OWNER_ID, "Private");
    expect(resolveSpaceAccess(space.spaceId, OTHER_ID)).toBeNull();
    // A wholly unknown space id resolves identically to a non-member.
    expect(resolveSpaceAccess("99999999-9999-4999-8999-999999999999", OWNER_ID)).toBeNull();
  });

  it("returns membership and version for an active owner/editor", () => {
    const space = createSpace(OWNER_ID, "Team");
    addEditorMember(OWNER_ID, space.spaceId, EDITOR_ID);

    expect(resolveSpaceAccess(space.spaceId, OWNER_ID)).toEqual({
      spaceId: space.spaceId,
      role: "owner",
      membershipVersion: 1,
    });
    expect(resolveSpaceAccess(space.spaceId, EDITOR_ID)).toEqual({
      spaceId: space.spaceId,
      role: "editor",
      membershipVersion: 1,
    });
  });

  it("returns null once a space is pending deletion", () => {
    const space = createSpace(OWNER_ID, "Doomed");
    spacesDb
      .prepare(
        "UPDATE spaces SET status = 'pending_delete', delete_after = datetime('now', '+30 days') WHERE id = ?",
      )
      .run(space.spaceId);

    expect(resolveSpaceAccess(space.spaceId, OWNER_ID)).toBeNull();
  });

  it("supports the options-object call form", () => {
    const space = createSpace(OWNER_ID, "Options Form");
    expect(
      resolveSpaceAccess({ spaceId: space.spaceId, actorUserId: OWNER_ID }),
    ).toMatchObject({ role: "owner" });
  });

  it("throws (never a success-shaped null) when the membership query itself fails", () => {
    // A genuine metadata operational failure must not be indistinguishable
    // from an ordinary "not a member" outcome — it must surface as a real
    // error so a caller can tell the two apart.
    const space = createSpace(OWNER_ID, "Broken Query");
    spacesDb.exec("DROP TABLE space_members");
    expect(() => resolveSpaceAccess(space.spaceId, OWNER_ID)).toThrow();
  });

  it("throws (never a success-shaped null) when the membership-version lookup itself fails", () => {
    const space = createSpace(OWNER_ID, "Broken Version");
    spacesDb.exec("DROP TABLE space_user_versions");
    expect(() => resolveSpaceAccess(space.spaceId, OWNER_ID)).toThrow();
  });
});

describe("getSpaceMembershipVersion", () => {
  it("returns 0 when disabled, for invalid ids, and for a user with no space activity", () => {
    delete process.env.SHARED_SPACES_ENABLED;
    expect(getSpaceMembershipVersion(OWNER_ID)).toBe(0);

    process.env.SHARED_SPACES_ENABLED = "true";
    expect(getSpaceMembershipVersion("not-a-uuid")).toBe(0);
    expect(getSpaceMembershipVersion(OTHER_ID)).toBe(0);
  });

  it("reflects the caller's current version after membership changes", () => {
    const space = createSpace(OWNER_ID, "Versioned");
    expect(getSpaceMembershipVersion(OWNER_ID)).toBe(1);

    addEditorMember(OWNER_ID, space.spaceId, EDITOR_ID);
    expect(getSpaceMembershipVersion(EDITOR_ID)).toBe(1);

    removeEditorMember(OWNER_ID, space.spaceId, EDITOR_ID);
    expect(getSpaceMembershipVersion(EDITOR_ID)).toBe(2);
  });

  it("throws (never a success-shaped 0) when the metadata database operation itself fails", () => {
    createSpace(OWNER_ID, "Broken");
    spacesDb.exec("DROP TABLE space_user_versions");
    expect(() => getSpaceMembershipVersion(OWNER_ID)).toThrow();
  });
});
