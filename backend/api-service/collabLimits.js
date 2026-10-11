// /backend/api-service/collabLimits.js
//
// On their own so both collab.js and websocket.js can read them. They used to
// live in collab.js, which imports revision.js, which imports websocket.js,
// which read the limits back from collab.js while it was still loading: it
// only worked when websocket.js happened to be imported first.

export const COLLAB_LIMITS = Object.freeze({
  // The largest update that still fits one frame once base64-encoded. A client
  // that reconnects sends what it typed meanwhile as one merged update; at
  // 256 KiB a long offline stretch or a large paste was refused and the
  // session dropped.
  maxUpdateBytes: 700 * 1024,
  maxMessageBytes: 1024 * 1024,
  updatesPerSecond: 40,
  awarenessPerSecond: 10,
  participantsPerSession: 20,
  usersPerSession: 20,
  sessionsPerSpace: 10,
  // Every session holds a document in memory. The per-space limit alone let
  // one account with many spaces pin hundreds of them in the one process.
  sessionsPerProcess: 200,
  recoveryBytesPerSpace: 50 * 1024 * 1024,
  maxResolutionBytes: 900 * 1024,
});
