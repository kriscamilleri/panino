import crypto from "crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../mailer.js", () => ({
  buildSpaceInviteUrl: (token) => `http://localhost:5173/#/spaces/invitations/${token}`,
  sendPasswordResetEmail: vi.fn(),
  sendSpaceInviteEmail: vi.fn().mockResolvedValue(true),
  sendEmailVerificationEmail: vi.fn().mockResolvedValue(true),
}));

import { sendEmailVerificationEmail } from "../../mailer.js";
import { deleteTestDb, getAuthDb, getSpacesDb } from "../../db.js";
import { createSpace, createSpaceInvite } from "../../spaces.js";
import {
  cleanupTestUser,
  createTestApp,
  getTestToken,
  setupTestUser,
} from "../testHelpers.js";

const FLAG = "SHARED_SPACES_ENABLED";
const ORIGINAL_FLAG = process.env[FLAG];

describe("verify my email", () => {
  let app;
  let server;
  let account;
  let stranger;
  let owner;
  let createdSpaceIds;

  beforeAll(() => {
    ({ app, server } = createTestApp());
  });

  beforeEach(async () => {
    process.env[FLAG] = "true";
    vi.mocked(sendEmailVerificationEmail).mockReset().mockResolvedValue(true);
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    account = await setupTestUser(`verify-me-${stamp}@example.com`, "password123");
    stranger = await setupTestUser(`verify-stranger-${stamp}@example.com`, "password123");
    owner = await setupTestUser(`verify-owner-${stamp}@example.com`, "password123");
    createdSpaceIds = [];
  });

  afterEach(() => {
    const db = getSpacesDb();
    for (const spaceId of createdSpaceIds) {
      db.prepare("DELETE FROM space_members WHERE space_id = ?").run(spaceId);
      db.prepare("DELETE FROM space_invites WHERE space_id = ?").run(spaceId);
      db.prepare("DELETE FROM spaces WHERE id = ?").run(spaceId);
      deleteTestDb(`space:${spaceId}`);
    }
    for (const user of [account, stranger, owner]) {
      db.prepare("DELETE FROM space_user_versions WHERE user_id = ?").run(user.userId);
      getAuthDb().prepare("DELETE FROM email_verifications WHERE user_id = ?").run(user.userId);
      cleanupTestUser(user.userId);
    }
  });

  afterAll(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env[FLAG];
    else process.env[FLAG] = ORIGINAL_FLAG;
    return new Promise((resolve) => server.close(resolve));
  });

  const as = (user) => ({ Authorization: `Bearer ${getTestToken(user.userId)}` });
  const ask = (user) => request(app).post("/account/email-verification").set(as(user));
  const confirm = (user, token) => request(app)
    .post("/account/email-verification/confirm")
    .set(as(user))
    .send({ token });
  const verifiedAt = (user) => getAuthDb()
    .prepare("SELECT email_verified_at AS at FROM users WHERE id = ?")
    .get(user.userId).at;
  const mailedToken = () => vi.mocked(sendEmailVerificationEmail).mock.calls.at(-1)[1];
  const storedRows = (user) => getAuthDb()
    .prepare("SELECT * FROM email_verifications WHERE user_id = ?")
    .all(user.userId);

  it("mails a link to the account's own address and stores only the token's hash", async () => {
    await ask(account).expect(200, { emailVerified: false, emailSent: true });

    expect(sendEmailVerificationEmail).toHaveBeenCalledTimes(1);
    const [to, token] = vi.mocked(sendEmailVerificationEmail).mock.calls[0];
    expect(to).toBe(account.email);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const rows = storedRows(account);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(crypto.createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(verifiedAt(account)).toBeNull();
  });

  it("ignores an address in the request: the mail goes to the stored one", async () => {
    await ask(account).send({ email: "someone-else@example.com", userId: stranger.userId }).expect(200);
    expect(vi.mocked(sendEmailVerificationEmail).mock.calls[0][0]).toBe(account.email);
    expect(storedRows(stranger)).toHaveLength(0);
  });

  it("verifies the account when it confirms its own link, once", async () => {
    await ask(account).expect(200);
    await ask(account).expect(200);
    const token = mailedToken();

    await confirm(account, token).expect(200, { emailVerified: true });
    expect(verifiedAt(account)).toEqual(expect.any(String));
    // Every outstanding link for the account is spent with it.
    expect(storedRows(account)).toHaveLength(0);

    // A second click is not an error, and asking again sends nothing.
    await confirm(account, token).expect(200, { emailVerified: true });
    await ask(account).expect(200, { emailVerified: true, emailSent: false });
    expect(sendEmailVerificationEmail).toHaveBeenCalledTimes(2);
  });

  it("does nothing when someone else opens the link, and leaves it usable", async () => {
    await ask(account).expect(200);
    const token = mailedToken();

    const refused = await confirm(stranger, token).expect(400);
    expect(refused.body.code).toBe("EMAIL_VERIFICATION_INVALID");
    expect(verifiedAt(account)).toBeNull();
    expect(verifiedAt(stranger)).toBeNull();

    await confirm(account, token).expect(200, { emailVerified: true });
  });

  it("needs a session for both steps", async () => {
    await request(app).post("/account/email-verification").expect(401);
    await ask(account).expect(200);
    await request(app)
      .post("/account/email-verification/confirm")
      .send({ token: mailedToken() })
      .expect(401);
    expect(verifiedAt(account)).toBeNull();
  });

  it("refuses an unknown, malformed or expired link with one answer", async () => {
    await ask(account).expect(200);
    const token = mailedToken();

    for (const bad of [undefined, "", "nope", "a".repeat(64), token.toUpperCase(), { $ne: "" }]) {
      const response = await confirm(account, bad).expect(400);
      expect(response.body).toEqual({
        error: "This verification link is invalid or has expired.",
        code: "EMAIL_VERIFICATION_INVALID",
      });
    }

    getAuthDb()
      .prepare("UPDATE email_verifications SET expires_at = ? WHERE user_id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), account.userId);
    await confirm(account, token).expect(400);
    expect(verifiedAt(account)).toBeNull();
    expect(storedRows(account)).toHaveLength(0);
  });

  it("refuses a link issued for an address the account no longer has", async () => {
    await ask(account).expect(200);
    const token = mailedToken();
    getAuthDb().prepare("UPDATE users SET email = ? WHERE id = ?")
      .run(`moved-${account.email}`, account.userId);

    await confirm(account, token).expect(400);
    expect(verifiedAt(account)).toBeNull();
  });

  it("limits how many links an account can ask for in an hour", async () => {
    await ask(account).expect(200);
    await ask(account).expect(200);
    await ask(account).expect(200);
    const limited = await ask(account).expect(429);
    expect(limited.body.code).toBe("EMAIL_VERIFICATION_RATE_LIMIT");
    expect(limited.headers["retry-after"]).toBe("3600");
    expect(sendEmailVerificationEmail).toHaveBeenCalledTimes(3);
    // Another account is not held back by it.
    await ask(stranger).expect(200);

    getAuthDb()
      .prepare("UPDATE email_verifications SET created_at = ? WHERE user_id = ?")
      .run(new Date(Date.now() - 2 * 3600 * 1000).toISOString(), account.userId);
    await ask(account).expect(200);
  });

  it("says so when the mail could not be sent, and still counts the attempt", async () => {
    vi.mocked(sendEmailVerificationEmail).mockResolvedValue(false);
    const failed = await ask(account).expect(503);
    expect(failed.body.code).toBe("EMAIL_VERIFICATION_NOT_SENT");
    expect(storedRows(account)).toHaveLength(1);
  });

  it("will not mail an address that could be read as more than one recipient", async () => {
    getAuthDb().prepare("UPDATE users SET email = ? WHERE id = ?")
      .run(`a-${Date.now()}@example.com, b@example.org`, account.userId);
    const refused = await ask(account).expect(409);
    expect(refused.body.code).toBe("EMAIL_VERIFICATION_UNAVAILABLE");
    expect(sendEmailVerificationEmail).not.toHaveBeenCalled();
  });

  it("makes invitations to the address appear and acceptable without their link", async () => {
    const space = createSpace({ actorUserId: owner.userId, name: "Verified readers" });
    createdSpaceIds.push(space.spaceId);
    const { invite } = createSpaceInvite({
      actorUserId: owner.userId,
      spaceId: space.spaceId,
      email: account.email,
    });

    const before = await request(app).get("/space-invitations").set(as(account)).expect(200);
    expect(before.body).toEqual({ invitations: [], emailVerified: false });
    await request(app).post(`/space-invitations/${invite.id}/accept`).set(as(account)).expect(400);

    await ask(account).expect(200);
    await confirm(account, mailedToken()).expect(200);

    const after = await request(app).get("/space-invitations").set(as(account)).expect(200);
    expect(after.body.emailVerified).toBe(true);
    expect(after.body.invitations.map((entry) => entry.id)).toEqual([invite.id]);
    const accepted = await request(app)
      .post(`/space-invitations/${invite.id}/accept`)
      .set(as(account))
      .expect(200);
    expect(accepted.body).toMatchObject({ accepted: true, spaceId: space.spaceId });
  });

  it("does not exist while shared spaces are off", async () => {
    process.env[FLAG] = "false";
    await ask(account).expect(404);
    await confirm(account, "a".repeat(64)).expect(404);
    expect(sendEmailVerificationEmail).not.toHaveBeenCalled();
    expect(storedRows(account)).toHaveLength(0);
  });
});
