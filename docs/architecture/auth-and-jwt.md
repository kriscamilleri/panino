# Authentication and JWT

Authentication is implemented in `backend/api-service/auth.js` and
`backend/api-service/passwordReset.js`. Login issues a seven-day JWT containing the user
identity; authenticated middleware sets `req.user = { user_id }`. Routes must authorize from
that middleware value, never from a request-body user ID.

The frontend stores the token as `jwt_token` and sends it in the `Authorization` header.
WebSocket clients additionally pass `token` and `siteId` query parameters; the server verifies
the JWT before associating the socket with a user.

An account's email address is unverified until its holder proves they receive mail there, by
"verify my email" (`emailVerification.js`) or a completed password reset. Nothing but shared-space
invitations depends on it; the rules and the reason confirming needs the account's own session are
in [`data-model.md`](data-model.md) under the authentication database.

This is a pointer rather than a full protocol reference. For route conventions and security
rules, see `backend/api-service/AGENTS.md` and the authentication modules.
