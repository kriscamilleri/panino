import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const databaseMocks = vi.hoisted(() => ({
  getAuthDb: vi.fn(),
  getSpacesDb: vi.fn(),
}));

vi.mock("../../db.js", () => databaseMocks);

import {
  addEditorMember,
  createSpace,
  getSpaceMembership,
  isSharedSpacesEnabled,
  listSpacesForUser,
  removeEditorMember,
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
