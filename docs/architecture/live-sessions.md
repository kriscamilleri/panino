# Live collaboration sessions

Live sessions are an explicit, online-only editing mode for Documents in shared spaces. They are
disabled unless `LIVE_SESSIONS_ENABLED=true`; shared spaces remain independently disabled by
default through `SHARED_SPACES_ENABLED=false`.

## Source of truth

Each active `(space, Document)` pair has one backend `Y.Doc` containing one `Y.Text` named
`content`. Yjs exists only for the lifetime and crash recovery of that session. A user action named
**Save version** writes plain text to the ordinary `notes.content` CRR column and creates exactly
one backend-attributed revision with `actor_kind = 'collab'`. Existing `/sync`, export, PDF,
search, backup, and revision readers therefore continue to consume plain text.

The server owns the session's `baseContent`. If the persisted Document changed outside the
session, saving uses the canonical `@panino/content-merge` three-way merge.

- **A clean merge is saved, and the outside edit is applied to the session's own document** as one
  contiguous replacement that every participant receives as an ordinary update. The server must
  never swap in a new `Y.Doc`: clients keep the old one, and everything they type afterwards refers
  to text the server no longer has.
- **An overlap is a conflict.** The server records it (`pendingConflict`: an id, the session text
  and the stored text it was compared with) and sends base/mine/theirs to every participant, and to
  anyone who joins while it stands. One participant answers with `collab:resolve`. The server
  applies that answer, merged with anything typed since the conflict was shown, as one contiguous
  replacement; moves `baseContent` to the stored text the answer was made against, so the next save
  goes through; and tells everyone with `collab:conflict-resolved`. A second answer gets
  `CONFLICT_RESOLVED`. If the text being decided was itself edited meanwhile, the answer is refused
  with `CONFLICT_STALE` and a fresh conflict is sent. Clients never rewrite the shared text to
  resolve a conflict.
- **A save that fails** is announced to everyone with `collab:commit-failed`, because everyone was
  told it had started.

The shared text always uses LF line endings, whatever the stored body uses; a textarea reports
nothing else.

## Authorization and protocol

Live messages use the version-1 JSON WebSocket envelope and base64 Yjs updates. Opening requires an
active subscription to `space:<uuid>`, an active owner/editor membership, an existing Document, and
the live-session feature flag. Every update, awareness, save, and participant lookup rechecks the
authenticated account and current membership. Missing spaces, missing Documents, nonmembers, and
deleted accounts receive the same non-disclosing not-found outcome.

Limits (`collabLimits.js`) are enforced at admission and message boundaries: 20 connections and 20
distinct users per session, 10 sessions per space, 200 sessions per process, 10 account sockets,
700 KiB decoded updates (the most that fits a 1 MiB frame once base64-encoded), 40 updates/second,
and 10 awareness messages/second. Membership removal closes that participant immediately, whether
or not their socket is still subscribed to the space; a deletion request closes all sessions for
the space and removes their recovery rows.

A participant is identified for sequence counting by `<userId>:<clientId>`, where `clientId` is a
UUID the tab chooses and sends with `collab:open`. A browser profile has one site id for all its
tabs, so the site id cannot tell two tabs apart; the user id in the key stops one account claiming
another's counter.

## Durable acknowledgement

The space content schema creates three local tables before admission:

- `collab_sessions` stores a checkpoint: the encoded full Yjs state, merge base/hash, global
  durable sequence, and timestamps.
- `collab_session_updates` is the log of updates accepted since that checkpoint, in order.
- `collab_session_acks` stores the highest accepted sequence per participant.

An accepted update is applied, appended to the log together with the participant's cursor in one
SQLite transaction, and only then acknowledged and rebroadcast. The log is folded into a new
checkpoint after 64 updates or 256 KiB. Recovery reads the checkpoint and replays the log. Writing
the whole state for every update cost time proportional to the Document on the one thread that
serves every request. If a write fails, the in-memory document is reloaded from what is durable.

A client retains unacknowledged updates. After a reconnect it receives the full state and the last
sequence the server holds for it, and sends everything above that as **one merged update** under
the next sequence number. `RATE_LIMIT` and `SESSION_BUSY` mean "not now": the update is kept and
sent again. Yjs plus the durable cursor makes replay idempotent.

The last participant starts a 30-second reconnect grace period. Document activity, not awareness,
resets the 10-minute idle-save timer. Grace expiry, idle expiry, and graceful shutdown attempt an
ordinary save; a merge conflict or failure retains the recovery row. `SIGTERM` stops admission and
has a 12-second flush deadline under Docker's 15-second stop grace. Success-shaped shutdown closes
are emitted only after durable completion.

Abandoned recovery older than 30 days is gzip-archived into the backend-only
`collab_recovery_archives` table before deletion. Live recovery state is capped at 50 MiB per
space. The archive rows live in the space database and are therefore covered by production backup.

## Browser ownership

The normal draft/database debounce and COLLAB-01/02 conflict classification are suspended while a
session owns the open Document. A textarea binding converts each browser edit to one contiguous
Yjs delete/insert and uses an origin-scoped `Y.UndoManager`. Rules the binding and store keep:

- **Every local transaction is sent**, not only typing. Undo and redo run with the undo manager
  as origin.
- **The binding is never held in a deep ref.** Reached through a reactive proxy, Yjs's undo
  manager finds nothing to undo. Only a browser shows this; unit tests of the binding do not.
- **An edit never starts or ends inside a surrogate pair**, and a keystroke next to an identical
  character is placed where the caret is.
- **A remote edit that arrives during input-method composition waits** for the composition to end;
  what was composed is then placed where its position has moved to.
- **A large insertion goes in pieces**, and updates are packed below the server's limit.
- **Only the answer to the join request that is still wanted opens a session**, and a session is
  attached only to the editor of the Document it is for. The editor reattaches it when it rebuilds
  its textarea (a theme change).
- **When a session ends, for whatever reason, the editor starts again from the stored body**: text,
  base and undo history. The session's own save then arrives as an ordinary update.
- **If the session was saved and closed while the tab was away**, the tab joins the new session
  only if it has nothing unsent; otherwise it stays out and keeps its text on screen to copy.

Two people typing at the same position at the same instant get their letters mixed, as in any
character-level collaborative editor; nothing is lost and every copy agrees.

The UI exposes solo, joining/live, reconnecting, saving, and dropped states in one status strip.
A dropped session's text is read-only, not disabled, so it can be selected. Collaborate is offered
only when `GET /spaces` reports `capabilities.liveSessions`.
