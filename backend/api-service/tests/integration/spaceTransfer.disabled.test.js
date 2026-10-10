import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, getTestToken, setupTestUser, cleanupTestUser } from "../testHelpers.js";

const TRANSFER_ID = "55555555-5555-4555-8555-555555555555";

describe("document transfer routes while shared spaces are off", () => {
  let app;
  let server;
  let user;
  let token;
  let previousFlag;

  beforeAll(() => {
    ({ app, server } = createTestApp());
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(async () => {
    previousFlag = process.env.SHARED_SPACES_ENABLED;
    delete process.env.SHARED_SPACES_ENABLED;
    user = await setupTestUser(`transfer-off-${Date.now()}@example.com`, "password123");
    token = getTestToken(user.userId);
  });

  afterEach(() => {
    cleanupTestUser(user.userId);
    if (previousFlag === undefined) delete process.env.SHARED_SPACES_ENABLED;
    else process.env.SHARED_SPACES_ENABLED = previousFlag;
  });

  // A transfer always involves a shared space, so with the feature off every
  // one of these has nothing to do. They used to answer anyway: the list with
  // 200, the rest with errors that differed by case.
  const routes = [
    ["get", "/space-transfers"],
    ["get", `/space-transfers/${TRANSFER_ID}`],
    ["post", "/space-transfers"],
    ["post", `/space-transfers/${TRANSFER_ID}/retry`],
    ["post", `/space-transfers/${TRANSFER_ID}/keep-both`],
    ["post", `/space-transfers/${TRANSFER_ID}/delete-source`],
  ];

  for (const [method, path] of routes) {
    it(`${method.toUpperCase()} ${path.replace(TRANSFER_ID, ":id")} answers 404 SPACE_NOT_FOUND`, async () => {
      const response = await request(app)[method](path)
        .set("Authorization", `Bearer ${token}`)
        .send({ sourceDbKey: `user:${user.userId}`, destinationDbKey: `user:${user.userId}`, noteId: TRANSFER_ID });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Not found", code: "SPACE_NOT_FOUND" });
    });
  }

  it("still requires authentication first", async () => {
    const response = await request(app).get("/space-transfers");
    expect([401, 403]).toContain(response.status);
  });
});
