// /backend/api-service/accountEmail.js
import { getAuthDb } from "./db.js";

/**
 * Whether an account's email address has been proven to reach its holder.
 *
 * Sign-up stores whatever address is typed and never checks it, so an account
 * email on its own says nothing about who owns the mailbox. Two things prove
 * it: confirming the link mailed by "verify my email" while signed in to the
 * account (emailVerification.js), and a completed password reset, whose link
 * is mailed to the stored address. An invitation link is not proof, because
 * the same link is also shown to the space owner who created it.
 *
 * Anything that grants access because "the account's address matches" must ask
 * here first. A database that could not be given the column yet reports every
 * account as unverified.
 */
export function isAccountEmailVerified(userId) {
  try {
    const row = getAuthDb()
      .prepare("SELECT email_verified_at AS verifiedAt FROM users WHERE id = ?")
      .get(userId);
    return Boolean(row?.verifiedAt);
  } catch (error) {
    if (/no such column/i.test(String(error?.message))) return false;
    throw error;
  }
}

/** Record that the holder of this account received mail at its address. */
export function markAccountEmailVerified(userId, now = new Date()) {
  try {
    getAuthDb()
      .prepare("UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL")
      .run(now.toISOString(), userId);
  } catch (error) {
    // Verification is an extra; it must never fail the action that proved it.
    console.warn("[auth] could not record a verified email:", error?.code || "unknown error");
  }
}

/** The form in which two addresses are the same address: trimmed, lower case. */
export function normalizeAccountEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// One mailbox: no spaces, no list separators, no display-name or routing
// syntax. Everything a mail library could read as "more than one recipient".
const SINGLE_ADDRESS_PATTERN = /^[^\s@<>()[\],;:\\"]+@[^\s@<>()[\],;:\\"]+\.[^\s@<>()[\],;:\\"]+$/;

/** Whether a value is one deliverable-looking address and nothing more. */
export function isSingleMailboxAddress(value) {
  return typeof value === "string" && value.length <= 254 && SINGLE_ADDRESS_PATTERN.test(value);
}
