// /backend/api-service/emailVerification.js
import express from "express";
import crypto from "crypto";
import { getAuthDb, isDatabaseBusyError, respondDatabaseBusy } from "./db.js";
import { isSingleMailboxAddress, normalizeAccountEmail } from "./accountEmail.js";
import { sendEmailVerificationEmail } from "./mailer.js";
import { isSharedSpacesEnabled } from "./spaces.js";

/**
 * "Verify my email": the account asks, a link is mailed to its stored address,
 * and the account confirms with the token from that link.
 *
 * Both steps need the account's own session. The token alone is not enough on
 * purpose: sign-up never checks an address, so anyone can register someone
 * else's and ask for this mail. The mailbox's real holder opening the link
 * would otherwise verify the stranger's account, which is exactly the takeover
 * a verified address is meant to rule out (spaces.js lists and accepts
 * invitations by verified address). They cannot sign in to that account, so
 * their click does nothing.
 *
 * Mounted behind `authenticateToken`.
 */
export const emailVerificationRoutes = express.Router();

const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const VERIFICATION_RATE_WINDOW_MS = 60 * 60 * 1000;
const VERIFICATION_RATE_LIMIT = 3;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

// A verified address matters only to shared spaces. While they are off these
// routes do not exist, like every other route the flag guards.
emailVerificationRoutes.use("/account/email-verification", (req, res, next) => {
  if (isSharedSpacesEnabled()) return next();
  return res.status(404).json({ error: "Not found" });
});

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function invalidLink(res) {
  return res.status(400).json({
    error: "This verification link is invalid or has expired.",
    code: "EMAIL_VERIFICATION_INVALID",
  });
}

// POST /account/email-verification — mail a verification link to the account.
emailVerificationRoutes.post("/account/email-verification", async (req, res) => {
  try {
    const db = getAuthDb();
    const now = new Date();
    const user = db
      .prepare("SELECT id, email, email_verified_at AS verifiedAt FROM users WHERE id = ?")
      .get(req.user.user_id);
    if (!user) return res.status(404).json({ error: "Not found" });
    if (user.verifiedAt) return res.json({ emailVerified: true, emailSent: false });

    const address = typeof user.email === "string" ? user.email.trim() : "";
    if (!isSingleMailboxAddress(address)) {
      return res.status(409).json({
        error: "This account's email address cannot receive mail.",
        code: "EMAIL_VERIFICATION_UNAVAILABLE",
      });
    }

    db.prepare("DELETE FROM email_verifications WHERE expires_at <= ?").run(now.toISOString());
    // Every request counts, whether or not its mail went out, so a failing
    // mail server is not asked again and again.
    const recent = db
      .prepare("SELECT COUNT(*) AS count FROM email_verifications WHERE user_id = ? AND created_at > ?")
      .get(user.id, new Date(now.getTime() - VERIFICATION_RATE_WINDOW_MS).toISOString()).count;
    if (recent >= VERIFICATION_RATE_LIMIT) {
      res.set("Retry-After", String(Math.ceil(VERIFICATION_RATE_WINDOW_MS / 1000)));
      return res.status(429).json({
        error: "Too many verification emails were requested. Try again in an hour.",
        code: "EMAIL_VERIFICATION_RATE_LIMIT",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    db.prepare(
      `INSERT INTO email_verifications (token_hash, user_id, email, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      hashToken(token),
      user.id,
      normalizeAccountEmail(address),
      new Date(now.getTime() + VERIFICATION_LIFETIME_MS).toISOString(),
      now.toISOString(),
    );

    if (!(await sendEmailVerificationEmail(address, token))) {
      return res.status(503).json({
        error: "The verification email could not be sent. Try again later.",
        code: "EMAIL_VERIFICATION_NOT_SENT",
      });
    }
    return res.json({ emailVerified: false, emailSent: true });
  } catch (error) {
    if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
    console.error("[auth] email verification request failed:", error?.code || "unknown error");
    return res.status(500).json({ error: "Internal server error." });
  }
});

// POST /account/email-verification/confirm — use the token from the mailed link.
emailVerificationRoutes.post("/account/email-verification/confirm", (req, res) => {
  try {
    const db = getAuthDb();
    const now = new Date();
    const token = req.body?.token;
    const userId = req.user.user_id;

    const confirm = db.transaction(() => {
      const account = db
        .prepare("SELECT email, email_verified_at AS verifiedAt FROM users WHERE id = ?")
        .get(userId);
      if (!account) return "invalid";
      // A second click on a link that already worked.
      if (account.verifiedAt) return "verified";
      if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return "invalid";

      const tokenHash = hashToken(token);
      const row = db
        .prepare("SELECT user_id AS userId, email, expires_at AS expiresAt FROM email_verifications WHERE token_hash = ?")
        .get(tokenHash);
      // Another account's link is left alone: its owner may still use it.
      if (!row || row.userId !== userId) return "invalid";
      if (new Date(row.expiresAt) <= now || normalizeAccountEmail(account.email) !== row.email) {
        db.prepare("DELETE FROM email_verifications WHERE token_hash = ?").run(tokenHash);
        return "invalid";
      }

      db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL")
        .run(now.toISOString(), userId);
      db.prepare("DELETE FROM email_verifications WHERE user_id = ?").run(userId);
      return "verified";
    });

    if (confirm.immediate() !== "verified") return invalidLink(res);
    return res.json({ emailVerified: true });
  } catch (error) {
    if (isDatabaseBusyError(error)) return respondDatabaseBusy(res);
    console.error("[auth] email verification failed:", error?.code || "unknown error");
    return res.status(500).json({ error: "Internal server error." });
  }
});
