export function spaceErrorMessage(code, fallback = "Unable to complete the space action.") {
  const messages = {
    SPACE_NOT_FOUND: "This space is unavailable or your access has changed.",
    SPACE_OWNER_REQUIRED: "Only the space owner can do that.",
    SPACE_INVITE_INVALID: "This invitation is invalid, expired, revoked, or already used.",
    SPACE_INVITE_RETRY: "The invitation could not be accepted yet. Please try again.",
    SPACE_MEMBER_EXISTS: "That account is already a member.",
    SPACE_OWNER_LEAVE_DENIED: "Transfer ownership before leaving this space.",
    SPACE_OWNER_REMOVAL_DENIED: "Transfer ownership before removing the owner.",
    SPACE_OWNER_LIMIT: "You have reached the owned-space limit.",
    SPACE_MEMBER_LIMIT: "This space has reached its member limit.",
    SPACE_JOINED_LIMIT: "This account has reached its joined-space limit.",
    EMAIL_VERIFICATION_INVALID:
      "This verification link is invalid or has expired. A link works only while signed in to the account that asked for it.",
    EMAIL_VERIFICATION_RATE_LIMIT: "Too many verification emails were requested. Try again in an hour.",
    EMAIL_VERIFICATION_NOT_SENT: "The verification email could not be sent. Try again later.",
    EMAIL_VERIFICATION_UNAVAILABLE: "This account's email address cannot receive mail.",
  };
  return messages[code] || fallback;
}

export function isSpaceOwner(space) {
  return space?.role === "owner";
}

export function normalizeInvitationEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

