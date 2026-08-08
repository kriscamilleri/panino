# Authentication and JWT

Authentication is implemented in `backend/api-service/auth.js` and
`backend/api-service/passwordReset.js`. Login issues a seven-day JWT containing the user
identity; authenticated middleware sets `req.user = { user_id }`. Routes must authorize from
that middleware value, never from a request-body user ID.

The frontend stores the token as `jwt_token` and sends it in the `Authorization` header.
WebSocket clients additionally pass `token` and `siteId` query parameters; the server verifies
the JWT before associating the socket with a user.

This is a pointer rather than a full protocol reference. For route conventions and security
rules, see `backend/api-service/AGENTS.md` and the authentication modules.
