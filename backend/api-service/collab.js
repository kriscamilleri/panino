import crypto from "node:crypto";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { v4 as uuidv4, validate as validateUuid } from "uuid";
import * as Y from "yjs";
import { mergeContent, normalizeContent } from "@panino/content-merge";
import { getAuthDb, getHealthyDb, listDbKeys, parseDbKey } from "./db.js";
import { createRevisionSnapshot } from "./revision.js";
import { resolveSpaceAccess } from "./spaces.js";
import { COLLAB_LIMITS } from "./collabLimits.js";

export { COLLAB_LIMITS };

// Updates are appended to a log; the whole document is rewritten as a
// checkpoint only after this many updates or bytes.
const LOG_COMPACT_COUNT = 64;
const LOG_COMPACT_BYTES = 256 * 1024;
const gzipAsync = promisify(gzip);

const RECONNECT_GRACE_MS = 30_000;
const IDLE_COMMIT_MS = 10 * 60_000;
const RECOVERY_RETENTION_MS = 30 * 24 * 60 * 60_000;
const RECOVERY_SWEEP_MS = 24 * 60 * 60_000;

export function isLiveSessionsEnabled() {
  return process.env.LIVE_SESSIONS_ENABLED === "true";
}

function hashText(value) {
  return crypto.createHash("sha256").update(normalizeContent(value), "utf8").digest("hex");
}

function encode(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function decodeStrict(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(COLLAB_LIMITS.maxUpdateBytes * 4 / 3) + 4) {
    throw Object.assign(new Error("Invalid collaborative update"), { code: "INVALID_UPDATE" });
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw Object.assign(new Error("Invalid collaborative update"), { code: "INVALID_UPDATE" });
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > COLLAB_LIMITS.maxUpdateBytes || encode(bytes) !== value) {
    throw Object.assign(new Error("Invalid collaborative update"), { code: "INVALID_UPDATE" });
  }
  return bytes;
}

function envelope(type, payload, requestId = null) {
  return { v: 1, type, requestId, ok: true, payload };
}

function errorEnvelope(type, requestId, code, message, retryable = false) {
  return { v: 1, type, requestId, ok: false, error: { code, message, retryable } };
}

function send(ws, message) {
  if (ws?.readyState !== 1 || (ws.bufferedAmount || 0) > 4 * 1024 * 1024) return false;
  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function profile(userId) {
  const row = getAuthDb().prepare("SELECT id, name FROM users WHERE id = ?").get(userId);
  return { id: userId, name: row?.name || "Former member" };
}

function rollingRate(record, key, limit, now = Date.now()) {
  const current = record[key];
  if (!current || now - current.startedAt >= 1000) {
    record[key] = { startedAt: now, count: 1 };
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function sessionKey(dbKey, noteId) {
  return `${dbKey}:${noteId}`;
}

function createYDoc(content = "") {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  // A textarea only ever reports "\n". Seeded with "\r\n", the first keystroke
  // of every participant rewrote everything between the first and last line
  // break, and two doing so at once duplicated it.
  const text = normalizeContent(content);
  if (text) ytext.insert(0, text);
  return ydoc;
}

/**
 * Who a set of sequence numbers belongs to. One browser profile has one site
 * id, shared by all its tabs, so keyed by site id two tabs in the same session
 * shared one counter: each tab's update was acknowledged as a duplicate of the
 * other's and dropped. A client now names itself per tab; the id is scoped to
 * the authenticated user so it cannot claim someone else's counter.
 */
function participantKey(clientState, payload) {
  const clientId = typeof payload?.clientId === "string" && validateUuid(payload.clientId)
    ? payload.clientId.toLowerCase()
    : null;
  return clientId ? `${clientState.userId}:${clientId}` : clientState.siteId;
}

/** True when a UTF-16 code unit is the first / second half of a surrogate pair. */
const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Change `ytext` into `target` with one contiguous replacement, and return the
 * update that did it. Replacing the whole text instead deletes whatever anyone
 * typed in the meantime, and two participants doing it at once doubles it.
 */
function replaceTextMinimally(ydoc, target, origin) {
  const ytext = ydoc.getText("content");
  const current = ytext.toString();
  if (current === target) return null;
  let prefix = 0;
  const shared = Math.min(current.length, target.length);
  while (prefix < shared && current[prefix] === target[prefix]) prefix += 1;
  if (prefix > 0 && isHighSurrogate(current.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  while (
    suffix < current.length - prefix
    && suffix < target.length - prefix
    && current[current.length - 1 - suffix] === target[target.length - 1 - suffix]
  ) suffix += 1;
  if (suffix > 0 && isLowSurrogate(current.charCodeAt(current.length - suffix))) suffix -= 1;
  const before = Y.encodeStateVector(ydoc);
  ydoc.transact(() => {
    const removed = current.length - prefix - suffix;
    if (removed) ytext.delete(prefix, removed);
    const inserted = target.slice(prefix, target.length - suffix);
    if (inserted) ytext.insert(prefix, inserted);
  }, origin);
  return Y.encodeStateAsUpdate(ydoc, before);
}

export class CollabSessionManager {
  constructor({ poke = () => {}, now = () => new Date(), graceMs = RECONNECT_GRACE_MS, idleMs = IDLE_COMMIT_MS } = {}) {
    this.sessions = new Map();
    this.sessionsById = new Map();
    this.poke = poke;
    this.now = now;
    this.graceMs = graceMs;
    this.idleMs = idleMs;
    this.accepting = true;
  }

  authorize(clientState, dbKey, noteId, { requireSubscription = false } = {}) {
    let parsed;
    try {
      parsed = parseDbKey(dbKey);
    } catch {
      return null;
    }
    if (parsed.kind !== "space" || !validateUuid(noteId)) return null;
    if (!getAuthDb().prepare("SELECT 1 FROM users WHERE id = ?").get(clientState.userId)) return null;
    if (requireSubscription && !clientState.subscriptions?.has(parsed.dbKey)) return null;
    const access = resolveSpaceAccess(parsed.id, clientState.userId);
    if (!access || access.role !== "editor" && access.role !== "owner") return null;
    return { dbKey: parsed.dbKey, spaceId: parsed.id, access };
  }

  roster(session) {
    const byUser = new Map();
    for (const participant of session.participants.values()) {
      const existing = byUser.get(participant.userId);
      byUser.set(participant.userId, {
        ...profile(participant.userId),
        joinedAt: existing?.joinedAt || participant.joinedAt,
        idle: Boolean(participant.awareness?.idle),
        reconnecting: false,
      });
    }
    for (const participant of session.reconnecting.values()) {
      if (byUser.has(participant.userId)) continue;
      byUser.set(participant.userId, {
        ...profile(participant.userId),
        joinedAt: participant.joinedAt,
        idle: true,
        reconnecting: true,
      });
    }
    return [...byUser.values()];
  }

  broadcast(session, message, exceptWs = null) {
    for (const ws of session.participants.keys()) {
      if (ws !== exceptWs) send(ws, message);
    }
  }

  /**
   * Make one accepted update durable by appending it to the session's log.
   * The whole document is rewritten (a checkpoint) only once the log has grown
   * past a bound; until then the cost of an update is the size of the update.
   */
  persistUpdate(session, update) {
    if (session.logCount + 1 >= LOG_COMPACT_COUNT || session.logBytes + update.length >= LOG_COMPACT_BYTES) {
      this.persist(session);
      return;
    }
    const db = getHealthyDb(session.dbKey, "collab-persist");
    db.prepare("INSERT INTO collab_session_updates (session_id, update_blob) VALUES (?, ?)")
      .run(session.sessionId, Buffer.from(update));
    db.prepare("UPDATE collab_sessions SET durable_sequence = ?, updated_at = ? WHERE note_id = ?")
      .run(session.durableSequence, this.now().toISOString(), session.noteId);
    session.logCount += 1;
    session.logBytes += update.length;
  }

  /** The session's document as last made durable: checkpoint plus log. */
  loadDurableDocument(session) {
    const db = getHealthyDb(session.dbKey, "collab-reload");
    const row = db.prepare("SELECT ydoc_state FROM collab_sessions WHERE note_id = ? AND session_id = ?")
      .get(session.noteId, session.sessionId);
    if (!row) return null;
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(row.ydoc_state));
    for (const logged of db.prepare(
      "SELECT update_blob FROM collab_session_updates WHERE session_id = ? ORDER BY id",
    ).all(session.sessionId)) {
      Y.applyUpdate(ydoc, new Uint8Array(logged.update_blob));
    }
    return ydoc;
  }

  /**
   * Put the in-memory document back to what is durable after a failed write,
   * so nothing is held in memory that was never acknowledged. Reading it back
   * on the rare failure replaces encoding the whole document before every
   * update just in case.
   */
  restoreDurableDocument(session) {
    let durable = null;
    try {
      durable = this.loadDurableDocument(session);
    } catch (error) {
      console.error("[collab] could not reload a session after a failed write:", error?.code || "unknown");
    }
    if (!durable) {
      this.closeSession(session, "error");
      return false;
    }
    session.ydoc.destroy();
    session.ydoc = durable;
    return true;
  }

  /** Write the whole document as the session's checkpoint; it replaces the log. */
  persist(session, { deleteRow = false } = {}) {
    const db = getHealthyDb(session.dbKey, "collab-persist");
    if (deleteRow) {
      db.prepare("DELETE FROM collab_session_updates WHERE session_id = ?").run(session.sessionId);
      db.prepare("DELETE FROM collab_sessions WHERE note_id = ?").run(session.noteId);
      return;
    }
    const state = Buffer.from(Y.encodeStateAsUpdate(session.ydoc));
    const total = Number(db.prepare("SELECT COALESCE(SUM(length(ydoc_state)), 0) AS bytes FROM collab_sessions").get()?.bytes || 0);
    const previous = Number(db.prepare("SELECT length(ydoc_state) AS bytes FROM collab_sessions WHERE note_id = ?").get(session.noteId)?.bytes || 0);
    if (total - previous + state.length > COLLAB_LIMITS.recoveryBytesPerSpace) {
      throw Object.assign(new Error("Recovery storage is full; save or close a live session"), { code: "RECOVERY_LIMIT" });
    }
    const now = this.now().toISOString();
    db.prepare(`
      INSERT INTO collab_sessions
        (note_id, session_id, ydoc_state, base_content, base_hash, durable_sequence, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        session_id = excluded.session_id,
        ydoc_state = excluded.ydoc_state,
        base_content = excluded.base_content,
        base_hash = excluded.base_hash,
        durable_sequence = excluded.durable_sequence,
        updated_at = excluded.updated_at
    `).run(session.noteId, session.sessionId, state, session.baseContent, session.baseHash,
      session.durableSequence, session.startedAt, now);
    db.prepare("DELETE FROM collab_session_updates WHERE session_id = ?").run(session.sessionId);
    session.logCount = 0;
    session.logBytes = 0;
  }

  restoreOrCreate(target, noteId) {
    const key = sessionKey(target.dbKey, noteId);
    const active = this.sessions.get(key);
    if (active) return active;

    const db = getHealthyDb(target.dbKey, "collab-open");
    const note = db.prepare("SELECT id, COALESCE(content, '') AS content FROM notes WHERE id = ?").get(noteId);
    if (!note) return null;
    const recovered = db.prepare("SELECT * FROM collab_sessions WHERE note_id = ?").get(noteId);
    let ydoc;
    let sessionId;
    let baseContent;
    let baseHash;
    let durableSequence;
    let startedAt;
    if (recovered) {
      ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, new Uint8Array(recovered.ydoc_state));
      for (const logged of db.prepare(
        "SELECT update_blob FROM collab_session_updates WHERE session_id = ? ORDER BY id",
      ).all(recovered.session_id)) {
        Y.applyUpdate(ydoc, new Uint8Array(logged.update_blob));
      }
      sessionId = recovered.session_id;
      baseContent = recovered.base_content;
      baseHash = recovered.base_hash;
      durableSequence = Number(recovered.durable_sequence) || 0;
      startedAt = recovered.started_at;
    } else {
      ydoc = createYDoc(note.content);
      sessionId = uuidv4();
      baseContent = note.content;
      baseHash = hashText(note.content);
      durableSequence = 0;
      startedAt = this.now().toISOString();
    }
    const session = {
      key, sessionId, dbKey: target.dbKey, spaceId: target.spaceId, noteId,
      ydoc, baseContent, baseHash, durableSequence, startedAt,
      lastActivityAt: Date.now(), participants: new Map(), reconnecting: new Map(), highestSequences: new Map(),
      commitState: "live", graceTimer: null, idleTimer: null, lastActorUserId: null,
      logCount: 0, logBytes: 0, pendingConflict: null,
    };
    if (recovered) {
      for (const row of db.prepare(
        "SELECT participant_id, highest_seq FROM collab_session_acks WHERE session_id = ?",
      ).all(sessionId)) {
        session.highestSequences.set(row.participant_id, Number(row.highest_seq) || 0);
      }
    }
    // Do not publish a half-open in-memory session when the initial durable
    // checkpoint cannot be written (for example because the recovery quota is
    // full). A later admission must retry the same guarded creation path.
    this.persist(session);
    this.sessions.set(key, session);
    this.sessionsById.set(sessionId, session);
    this.scheduleIdle(session);
    return session;
  }

  scheduleIdle(session) {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => void this.autoCommitAndClose(session, "idle"), this.idleMs);
    session.idleTimer.unref?.();
  }

  countSpaceSessions(spaceId) {
    return [...this.sessions.values()].filter((session) => session.spaceId === spaceId).length;
  }

  open(ws, clientState, payload, requestId) {
    const spaceId = payload?.space;
    const noteId = payload?.noteId;
    const dbKey = typeof spaceId === "string" ? `space:${spaceId.toLowerCase()}` : "";
    const target = this.authorize(clientState, dbKey, noteId, { requireSubscription: true });
    if (!target) {
      send(ws, errorEnvelope("collab:open", requestId, "SPACE_NOT_FOUND", "Document not found"));
      return;
    }
    const key = sessionKey(target.dbKey, noteId);
    // Turning the flag off drains sessions already held by this process: it
    // rejects genuinely new admission but lets a disconnected participant
    // complete the ordinary reconnect/save path.
    if (!this.accepting || (!isLiveSessionsEnabled() && !this.sessions.has(key))) {
      send(ws, errorEnvelope("collab:open", requestId, "FEATURE_DISABLED", "Live sessions are unavailable", true));
      return;
    }
    if (!this.sessions.has(key) && this.countSpaceSessions(target.spaceId) >= COLLAB_LIMITS.sessionsPerSpace) {
      send(ws, errorEnvelope("collab:open", requestId, "SESSION_LIMIT", "This space has too many live sessions", true));
      return;
    }
    if (!this.sessions.has(key) && this.sessions.size >= COLLAB_LIMITS.sessionsPerProcess) {
      send(ws, errorEnvelope("collab:open", requestId, "SESSION_LIMIT", "Too many live sessions are open right now", true));
      return;
    }
    const session = this.restoreOrCreate(target, noteId);
    if (!session) {
      send(ws, errorEnvelope("collab:open", requestId, "SPACE_NOT_FOUND", "Document not found"));
      return;
    }
    const identity = participantKey(clientState, payload);
    const reconnecting = session.reconnecting.get(identity);
    const allParticipants = [
      ...session.participants.values(),
      ...[...session.reconnecting.values()].filter((participant) => participant !== reconnecting),
    ];
    const distinctUsers = new Set(allParticipants.map((p) => p.userId));
    if (allParticipants.length >= COLLAB_LIMITS.participantsPerSession
      || (!distinctUsers.has(clientState.userId) && distinctUsers.size >= COLLAB_LIMITS.usersPerSession)) {
      send(ws, errorEnvelope("collab:open", requestId, "SESSION_LIMIT", "This live session is full", true));
      return;
    }
    clearTimeout(session.graceTimer);
    if (reconnecting) clearTimeout(reconnecting.reconnectTimer);
    session.reconnecting.delete(identity);
    const joinedAt = this.now().toISOString();
    session.participants.set(ws, {
      userId: clientState.userId, siteId: clientState.siteId, key: identity, joinedAt,
      highestAck: session.highestSequences.get(identity) || 0,
      updateRate: null, awarenessRate: null, awareness: null,
    });
    session.lastActorUserId = clientState.userId;
    clientState.collabSessions ??= new Set();
    clientState.collabSessions.add(session.sessionId);
    send(ws, envelope("collab:state", {
      sessionId: session.sessionId,
      stateVector: encode(Y.encodeStateVector(session.ydoc)),
      update: encode(Y.encodeStateAsUpdate(session.ydoc)),
      participants: this.roster(session),
      ack: session.highestSequences.get(identity) || 0,
      // An unresolved save conflict is shown to whoever joins while it stands.
      ...(session.pendingConflict ? { conflict: this.conflictPayload(session, session.lastActorUserId) } : {}),
    }, requestId));
    this.broadcast(session, envelope("collab:participants", {
      sessionId: session.sessionId, participants: this.roster(session),
    }));
  }

  resolveParticipant(ws, clientState, sessionId) {
    const session = this.sessionsById.get(sessionId);
    if (!session || !session.participants.has(ws)) return null;
    const target = this.authorize(clientState, session.dbKey, session.noteId);
    if (!target) {
      this.leave(ws, clientState, sessionId, "revoked");
      return null;
    }
    return { session, participant: session.participants.get(ws) };
  }

  update(ws, clientState, payload, requestId) {
    const resolved = this.resolveParticipant(ws, clientState, payload?.sessionId);
    if (!resolved) {
      send(ws, errorEnvelope("collab:update", requestId, "SPACE_NOT_FOUND", "Live session not found"));
      return;
    }
    const { session, participant } = resolved;
    if (session.commitState !== "live") {
      send(ws, errorEnvelope("collab:update", requestId, "SESSION_BUSY", "Save in progress", true));
      return;
    }
    const seq = Number(payload?.seq);
    if (!Number.isSafeInteger(seq) || seq < 1) {
      send(ws, errorEnvelope("collab:update", requestId, "INVALID_UPDATE", "Invalid collaborative update"));
      return;
    }
    const highest = session.highestSequences.get(participant.key) || 0;
    if (seq <= highest) {
      send(ws, envelope("collab:ack", { sessionId: session.sessionId, seq }, requestId));
      return;
    }
    if (seq !== highest + 1 || !rollingRate(participant, "updateRate", COLLAB_LIMITS.updatesPerSecond)) {
      send(ws, errorEnvelope("collab:update", requestId, "RATE_LIMIT", "Collaborative updates are arriving too quickly", true));
      return;
    }
    let update;
    try {
      update = decodeStrict(payload?.update);
    } catch (error) {
      send(ws, errorEnvelope("collab:update", requestId, error.code || "INVALID_UPDATE", "Invalid collaborative update"));
      return;
    }
    try {
      Y.applyUpdate(session.ydoc, update, participant.key);
      session.durableSequence += 1;
      session.highestSequences.set(participant.key, seq);
      participant.highestAck = seq;
      const db = getHealthyDb(session.dbKey, "collab-update-ack");
      db.transaction(() => {
        this.persistUpdate(session, update);
        db.prepare(`
          INSERT INTO collab_session_acks (session_id, participant_id, highest_seq)
          VALUES (?, ?, ?)
          ON CONFLICT(session_id, participant_id) DO UPDATE SET highest_seq = excluded.highest_seq
        `).run(session.sessionId, participant.key, seq);
      })();
    } catch (error) {
      session.durableSequence = Math.max(0, session.durableSequence - 1);
      session.highestSequences.set(participant.key, highest);
      participant.highestAck = highest;
      const alive = this.restoreDurableDocument(session);
      if (alive) {
        send(ws, errorEnvelope("collab:update", requestId, error.code || "INVALID_UPDATE", "Collaborative update could not be saved", true));
      }
      return;
    }
    session.lastActivityAt = Date.now();
    session.lastActorUserId = participant.userId;
    this.scheduleIdle(session);
    this.broadcast(session, envelope("collab:update", {
      sessionId: session.sessionId, from: participant.userId, seq, update: payload.update,
    }), ws);
    send(ws, envelope("collab:ack", { sessionId: session.sessionId, seq }, requestId));
  }

  awareness(ws, clientState, payload, requestId) {
    const resolved = this.resolveParticipant(ws, clientState, payload?.sessionId);
    if (!resolved) return;
    const { session, participant } = resolved;
    if (!rollingRate(participant, "awarenessRate", COLLAB_LIMITS.awarenessPerSecond)) return;
    participant.awareness = {
      cursor: Number.isSafeInteger(payload.cursor) ? payload.cursor : undefined,
      selection: Number.isSafeInteger(payload.selection) ? payload.selection : undefined,
      idle: Boolean(payload.idle),
    };
    clearTimeout(participant.awarenessTimer);
    participant.awarenessTimer = setTimeout(() => {
      if (!session.participants.has(ws)) return;
      participant.awareness = { idle: true };
      this.broadcast(session, envelope("collab:participants", {
        sessionId: session.sessionId, participants: this.roster(session),
      }));
    }, 15_000);
    participant.awarenessTimer.unref?.();
    this.broadcast(session, envelope("collab:awareness", {
      sessionId: session.sessionId, from: participant.userId, ...participant.awareness,
    }, requestId), ws);
  }

  commit(ws, clientState, payload, requestId) {
    const resolved = this.resolveParticipant(ws, clientState, payload?.sessionId);
    if (!resolved) {
      send(ws, errorEnvelope("collab:commit", requestId, "SPACE_NOT_FOUND", "Live session not found"));
      return;
    }
    let result;
    try {
      result = this.commitSession(resolved.session, resolved.participant.userId);
    } catch (error) {
      // Everyone was told a save had started. Without this they stayed in
      // "Saving version…" with saving disabled until they reloaded.
      this.broadcast(resolved.session, envelope("collab:commit-failed", {
        sessionId: resolved.session.sessionId,
      }));
      throw error;
    }
    const { mergeUpdate, ...announced } = result;
    if (mergeUpdate) {
      this.broadcast(resolved.session, envelope("collab:update", {
        sessionId: resolved.session.sessionId, from: resolved.participant.userId, update: encode(mergeUpdate),
      }));
    }
    this.broadcast(resolved.session, envelope("collab:committed", announced, requestId));
    if (result.result !== "conflict") this.poke(resolved.session.dbKey, null);
  }

  /** What participants are shown while a save conflict stands. */
  conflictPayload(session, actorUserId) {
    const pending = session.pendingConflict;
    return {
      sessionId: session.sessionId,
      by: profile(actorUserId),
      at: pending.at,
      result: "conflict",
      conflictId: pending.id,
      conflicts: pending.conflicts,
      baseContent: session.baseContent,
      mineContent: pending.mineContent,
      theirsContent: pending.theirsContent,
    };
  }

  /**
   * Apply one participant's answer to a save conflict, once, for everyone.
   *
   * It used to be applied by each client replacing the whole text: a later
   * answer deleted what others had typed since, two answers at once doubled the
   * Document, and the session's base never moved, so a save that kept the
   * session's side met the identical conflict again, for ever. Here the first
   * answer wins; it is merged with anything typed since the conflict was shown;
   * and the base moves to the stored text the answer was made against, so the
   * next save goes through.
   */
  resolve(ws, clientState, payload, requestId) {
    const resolved = this.resolveParticipant(ws, clientState, payload?.sessionId);
    if (!resolved) {
      send(ws, errorEnvelope("collab:resolve", requestId, "SPACE_NOT_FOUND", "Live session not found"));
      return;
    }
    const { session, participant } = resolved;
    const pending = session.pendingConflict;
    if (!pending || payload?.conflictId !== pending.id) {
      send(ws, errorEnvelope("collab:resolve", requestId, "CONFLICT_RESOLVED", "This conflict has already been resolved", true));
      return;
    }
    if (session.commitState !== "live") {
      send(ws, errorEnvelope("collab:resolve", requestId, "SESSION_BUSY", "Save in progress", true));
      return;
    }
    if (typeof payload?.content !== "string" || Buffer.byteLength(payload.content, "utf8") > COLLAB_LIMITS.maxResolutionBytes) {
      send(ws, errorEnvelope("collab:resolve", requestId, "INVALID_RESOLUTION", "This Document is too large to resolve in a live session"));
      return;
    }

    const current = session.ydoc.getText("content").toString();
    let target = normalizeContent(payload.content);
    if (current !== pending.mineContent) {
      // Someone kept typing after the conflict was shown; the answer was
      // composed without that text.
      const merged = mergeContent({ base: pending.mineContent, mine: current, theirs: target });
      if (merged.status !== "clean") {
        session.pendingConflict = null;
        const fresh = this.detectConflict(session, participant.userId);
        if (fresh) this.broadcast(session, envelope("collab:committed", fresh));
        else this.broadcast(session, envelope("collab:conflict-resolved", { sessionId: session.sessionId, by: profile(participant.userId) }));
        send(ws, errorEnvelope("collab:resolve", requestId, "CONFLICT_STALE", "The Document changed while you were deciding. Review the regions again.", true));
        return;
      }
      target = normalizeContent(merged.content);
    }

    const previousBase = { content: session.baseContent, hash: session.baseHash };
    let update;
    try {
      update = replaceTextMinimally(session.ydoc, target, "conflict-resolution");
      session.baseContent = pending.theirsContent;
      session.baseHash = hashText(pending.theirsContent);
      session.pendingConflict = null;
      session.durableSequence += 1;
      this.persist(session);
    } catch (error) {
      session.baseContent = previousBase.content;
      session.baseHash = previousBase.hash;
      session.pendingConflict = pending;
      this.restoreDurableDocument(session);
      throw error;
    }
    session.lastActivityAt = Date.now();
    session.lastActorUserId = participant.userId;
    this.scheduleIdle(session);
    if (update) {
      this.broadcast(session, envelope("collab:update", {
        sessionId: session.sessionId, from: participant.userId, update: encode(update),
      }));
    }
    this.broadcast(session, envelope("collab:conflict-resolved", {
      sessionId: session.sessionId, by: profile(participant.userId), conflictId: pending.id,
    }, requestId));
  }

  /**
   * Compare the session's text with the stored Document without saving. Records
   * and returns a conflict, or clears it and returns null when there is none.
   */
  detectConflict(session, actorUserId) {
    const mine = session.ydoc.getText("content").toString();
    const db = getHealthyDb(session.dbKey, "collab-conflict");
    const note = db.prepare("SELECT COALESCE(content, '') AS content FROM notes WHERE id = ?").get(session.noteId);
    session.pendingConflict = null;
    if (!note || normalizeContent(note.content) === normalizeContent(session.baseContent)) return null;
    const merged = mergeContent({ base: session.baseContent, mine, theirs: note.content });
    if (merged.status === "clean") return null;
    session.pendingConflict = {
      id: uuidv4(),
      at: this.now().toISOString(),
      mineContent: mine,
      theirsContent: note.content,
      conflicts: merged.conflicts,
    };
    return this.conflictPayload(session, actorUserId);
  }

  commitSession(session, actorUserId) {
    if (session.commitState !== "live") throw Object.assign(new Error("Save already in progress"), { code: "SESSION_BUSY" });
    session.commitState = "committing";
    const previousBaseContent = session.baseContent;
    const previousBaseHash = session.baseHash;
    const previousYdocState = Y.encodeStateAsUpdate(session.ydoc);
    this.broadcast(session, envelope("collab:committing", { sessionId: session.sessionId }));
    try {
      const mine = session.ydoc.getText("content").toString();
      const db = getHealthyDb(session.dbKey, "collab-commit");
      const note = db.prepare("SELECT id, title, COALESCE(content, '') AS content FROM notes WHERE id = ?").get(session.noteId);
      if (!note) throw Object.assign(new Error("Document not found"), { code: "SPACE_NOT_FOUND" });
      let content = mine;
      let result = "applied";
      if (normalizeContent(note.content) !== normalizeContent(session.baseContent)) {
        const merged = mergeContent({ base: session.baseContent, mine, theirs: note.content });
        if (merged.status !== "clean") {
          session.commitState = "live";
          session.pendingConflict = {
            id: uuidv4(),
            at: this.now().toISOString(),
            mineContent: mine,
            theirsContent: note.content,
            conflicts: merged.conflicts,
          };
          return this.conflictPayload(session, actorUserId);
        }
        content = merged.content;
        result = "merged";
      }
      const at = this.now().toISOString();
      const nextHash = hashText(content);
      let mergeUpdate = null;
      const tx = db.transaction(() => {
        db.prepare("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?").run(content, at, session.noteId);
        createRevisionSnapshot(db, {
          noteId: session.noteId, title: note.title, content, type: "manual",
          skipDuplicateCheck: true, runPruneGate: true,
          actorUserId, actorKind: "collab",
        });
        session.baseContent = content;
        session.baseHash = nextHash;
        if (mine !== content) {
          // The outside edit is brought into the document the participants
          // are in. Swapping in a new document here left every client on the
          // old one: what they typed next referred to text the server no
          // longer had, was never applied, and was missing from later saves.
          mergeUpdate = replaceTextMinimally(session.ydoc, normalizeContent(content), "commit-merge");
        }
        this.persist(session);
      });
      tx();
      session.commitState = "live";
      session.pendingConflict = null;
      return {
        sessionId: session.sessionId, by: profile(actorUserId), at, result, contentHash: nextHash,
        ...(mergeUpdate ? { mergeUpdate } : {}),
      };
    } catch (error) {
      session.baseContent = previousBaseContent;
      session.baseHash = previousBaseHash;
      session.ydoc.destroy();
      session.ydoc = new Y.Doc();
      Y.applyUpdate(session.ydoc, previousYdocState);
      session.commitState = "live";
      throw error;
    }
  }

  leave(ws, clientState, sessionId, reason = null) {
    const session = this.sessionsById.get(sessionId);
    if (!session || !session.participants.has(ws)) return;
    const participant = session.participants.get(ws);
    session.participants.delete(ws);
    clearTimeout(participant.awarenessTimer);
    clientState?.collabSessions?.delete(sessionId);
    if (reason === "revoked") send(ws, envelope("collab:closed", { sessionId, reason: "revoked" }));
    if (reason === "disconnected") {
      participant.awareness = null;
      participant.reconnectTimer = setTimeout(() => {
        session.reconnecting.delete(participant.key);
        this.broadcast(session, envelope("collab:participants", {
          sessionId, participants: this.roster(session),
        }));
      }, this.graceMs);
      participant.reconnectTimer.unref?.();
      session.reconnecting.set(participant.key, participant);
    }
    this.broadcast(session, envelope("collab:participants", { sessionId, participants: this.roster(session) }));
    if (session.participants.size === 0) {
      clearTimeout(session.graceTimer);
      session.graceTimer = setTimeout(() => void this.autoCommitAndClose(session, "committed"), this.graceMs);
      session.graceTimer.unref?.();
    }
  }

  socketClosed(ws, clientState) {
    for (const sessionId of [...(clientState.collabSessions || [])]) this.leave(ws, clientState, sessionId, "disconnected");
  }

  revokeSocket(ws, clientState, dbKey) {
    for (const sessionId of [...(clientState.collabSessions || [])]) {
      const session = this.sessionsById.get(sessionId);
      if (session?.dbKey === dbKey) this.leave(ws, clientState, sessionId, "revoked");
    }
  }

  closeDocument(dbKey, noteId, reason = "revoked") {
    const session = this.sessions.get(sessionKey(dbKey, noteId));
    if (session) this.closeSession(session, reason, { deleteRecovery: true });
  }

  closeSpace(dbKey, reason = "revoked") {
    for (const session of [...this.sessions.values()]) {
      if (session.dbKey === dbKey) this.closeSession(session, reason, { deleteRecovery: true });
    }
  }

  async autoCommitAndClose(session, reason) {
    if (!this.sessionsById.has(session.sessionId)) return;
    try {
      const committed = this.commitSession(session, session.lastActorUserId);
      if (committed.result === "conflict") {
        this.persist(session);
        if (session.participants.size > 0) {
          this.broadcast(session, envelope("collab:committed", committed));
          this.scheduleIdle(session);
        } else {
          // Keep the durable checkpoint for recovery without leaking a
          // resident session slot forever after the reconnect grace expires.
          this.closeSession(session, "conflict");
        }
        return;
      }
      this.closeSession(session, reason, { deleteRecovery: true });
      this.poke(session.dbKey, null);
    } catch (error) {
      console.error("[collab] automatic save failed:", error?.code || error?.message || "unknown");
      this.persist(session);
    }
  }

  closeSession(session, reason, { deleteRecovery = false } = {}) {
    clearTimeout(session.graceTimer);
    clearTimeout(session.idleTimer);
    for (const participant of session.participants.values()) clearTimeout(participant.awarenessTimer);
    for (const participant of session.reconnecting.values()) clearTimeout(participant.reconnectTimer);
    if (deleteRecovery) {
      try {
        this.persist(session, { deleteRow: true });
      } catch (error) {
        // Revocation and deletion must still close the in-memory access path.
        // The inaccessible row remains bounded and can be retried/pruned.
        console.error("[collab] recovery cleanup failed:", error?.code || error?.message || "unknown");
      }
    }
    this.broadcast(session, envelope("collab:closed", { sessionId: session.sessionId, reason }));
    for (const [ws] of session.participants) {
      // The client state is owned by websocket.js; deleting here is optional
      // because a closed id is harmless and socket close is idempotent.
      void ws;
    }
    session.participants.clear();
    session.reconnecting.clear();
    session.ydoc.destroy();
    this.sessions.delete(session.key);
    this.sessionsById.delete(session.sessionId);
  }

  async shutdown({ deadlineMs = 12_000 } = {}) {
    this.accepting = false;
    const deadline = Date.now() + deadlineMs;
    let flushed = 0;
    let unflushed = 0;
    for (const session of [...this.sessions.values()]) {
      if (Date.now() >= deadline) {
        unflushed += 1;
        continue;
      }
      try {
        const committed = this.commitSession(session, session.lastActorUserId);
        if (committed.result === "conflict") {
          this.persist(session);
          unflushed += 1;
        } else {
          this.closeSession(session, "shutdown", { deleteRecovery: true });
          this.poke(session.dbKey, null);
          flushed += 1;
        }
      } catch {
        try { this.persist(session); } catch { /* last committed snapshot remains */ }
        unflushed += 1;
      }
    }
    return { flushed, unflushed };
  }

  async handle(ws, clientState, msg) {
    try {
      switch (msg.type) {
        case "collab:open": return this.open(ws, clientState, msg.payload, msg.requestId);
        case "collab:update": return this.update(ws, clientState, msg.payload, msg.requestId);
        case "collab:awareness": return this.awareness(ws, clientState, msg.payload, msg.requestId);
        case "collab:commit": return this.commit(ws, clientState, msg.payload, msg.requestId);
        case "collab:resolve": return this.resolve(ws, clientState, msg.payload, msg.requestId);
        case "collab:leave": return this.leave(ws, clientState, msg.payload?.sessionId, "left");
        default: return false;
      }
    } catch (error) {
      const code = error?.code || "COLLAB_FAILED";
      send(ws, errorEnvelope(msg.type, msg.requestId, code,
        code === "SPACE_NOT_FOUND" ? "Live session not found" : "Live session request failed", code !== "SPACE_NOT_FOUND"));
    }
    return true;
  }
}

export function createCollabSessionManager(options) {
  return new CollabSessionManager(options);
}

/** Archive and remove recovery rows abandoned for 30 days. */
export async function pruneAbandonedCollabRecovery({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - RECOVERY_RETENTION_MS).toISOString();
  const result = { archived: 0, failed: 0 };
  for (const dbKey of listDbKeys().filter((key) => key.startsWith("space:"))) {
    try {
      const db = getHealthyDb(dbKey, "collab-recovery-prune");
      const rows = db.prepare("SELECT * FROM collab_sessions WHERE updated_at <= ?").all(cutoff);
      if (!rows.length) continue;
      for (const row of rows) {
        // Compressed off the main thread: a row can hold tens of megabytes,
        // and doing it synchronously stopped the API for as long as it took.
        const body = await gzipAsync(Buffer.from(JSON.stringify({
          sessionId: row.session_id,
          noteId: row.note_id,
          baseContent: row.base_content,
          baseHash: row.base_hash,
          durableSequence: row.durable_sequence,
          ydocState: Buffer.from(row.ydoc_state).toString("base64"),
          startedAt: row.started_at,
          updatedAt: row.updated_at,
          archivedAt: now.toISOString(),
        }), "utf8"));
        db.transaction(() => {
          db.prepare(`
            INSERT INTO collab_recovery_archives
              (id, session_id, note_id, payload_gzip, archived_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(uuidv4(), row.session_id, row.note_id, body, now.toISOString());
          db.prepare("DELETE FROM collab_sessions WHERE session_id = ? AND updated_at <= ?")
            .run(row.session_id, cutoff);
        })();
        result.archived += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error("[collab] recovery maintenance failed:", error?.code || error?.message || "unknown");
    }
  }
  return result;
}

export function startCollabRecoveryJob({ intervalMs = RECOVERY_SWEEP_MS } = {}) {
  const timer = setInterval(() => {
    pruneAbandonedCollabRecovery().catch((error) => {
      console.error("[collab] recovery maintenance failed:", error?.code || error?.message || "unknown");
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}
