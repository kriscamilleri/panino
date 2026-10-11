# Collaboration branch: defects behind the feature flags

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-11 14:45 (+02:00)
- Status: complete; nothing pushed; one incident to act on (below)

## Objective

`2026-10-10_12-40_collab-review-round-two.md` ended with a list of defects that only matter once
`SHARED_SPACES_ENABLED` or `LIVE_SESSIONS_ENABLED` is on, found by review and not fixed. The
developer asked for them to be addressed.

## Incident: a dev server exposed the repository root

To run the browser checks I started the frontend dev server as a background command beginning
with `cd frontend &&`. The background runner dropped the `cd`. `npx vite --host` therefore ran in
the repository root, where Vite is not installed: `npx` downloaded and ran `vite@8.3.4` from npm
(now in `~/.npm/_npx/`), and that server served the repository root on all network interfaces,
port 15173, from about 15:14:11 to 15:16:33 on 2026-10-11.

Vite refuses `.env` and `.env.*`, so `.env` and `.env.prd` were not served. `prd-server.env` does
not match that rule and was readable by anything that could reach the machine on its networks in
that window. Vite logs no requests, so whether it was fetched is unknown. I did not read the file.

- Stopped as soon as the 404 from the app showed something was wrong.
- The developer was told immediately, with a recommendation to rotate the production SSH
  password that file holds.
- The dev server is now started by absolute path with the frontend directory as its root and
  bound to 127.0.0.1. Checked: `/prd-server.env` returns the app's `index.html`, and the `/@fs/`
  path to the real file returns 403.

## Progress

The reviewers' reports were recovered from the session transcript and each finding was checked
against the code before being fixed. Two-account browser runs with the flags on then found
defects that neither the review nor the unit tests had:

- A space's per-account local file name was longer than the 64 characters the browser's SQLite
  file system accepts. Every space failed to open. The unit tests passed.
- Undo and redo did nothing during a live session in the running app. The session binding was
  held in a deep `ref`, and Yjs's undo manager reached through Vue's proxy finds nothing to undo.
  The binding's unit tests passed.
- Four stacked toasts covered a dialog's Apply button (seen in the earlier round too).

One browser failure was the check, not the app: two tabs typing at the same position at the same
instant get their letters mixed, in any character-level collaborative editor. A message trace
showed no deletion and identical text everywhere. The check now types in turn.

## Changes Made

| Commit | What |
|---|---|
| `5391c80` | Invitation takeover, mail relay, SVG script execution, ownership existence leak |
| `77ef16f` | Moving a Document between databases: images, unsent edits, stuck transfers, cost |
| `fcc7881` | Cancel a space deletion, per-space integrity check, bounded connection cache, invitation cleanup, server capabilities |
| `3086414` | Local wipe when access ends, per-account local file, resubscription, offline start |
| `782b7df` | Live sessions: undo, merged saves, conflict answers, two tabs, emoji, composition, reconnect, limits, update log |
| `de5e4e2` | A keystroke is placed where the caret is |

Decisions made here that the developer may want to change:

- **Invitations.** Finding and accepting an invitation without its mailed link now requires a
  verified address, and the only thing that verifies an address is a completed password reset.
  For most accounts the "Invitations to you" list is therefore empty and the Spaces page explains
  that the link is the way in. A "verify my email" flow would lift that; it is not built.
- **Revision history is not moved with a Document.** Moving a personal Document into a space would
  otherwise expose text its author had removed before sharing. The copy starts with one revision
  and the dialog says the original's history is deleted with it.
- **A removed member's local copy is deleted**, including edits never uploaded, as the spec says.
- **Ownership transfer still needs no consent**, as the spec says. The recipient's owned-space
  limit is now enforced.

Not changed:

- An owner who invites an address that already belongs to a member is told so (`409`). It reveals
  membership of the owner's own space to its owner.
- With both flags off the client still makes one `GET /spaces` per load and gets a 404.
- A Document deleted on another device takes an unsent local edit with it, as on `main`.

## Tests

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run test:shared` | 25 passed |
| `npm run test:fe` | 707 passed (54 files; the two spike files no longer run by default) |
| `npm run test:be` | 413 passed (29 files) |

Scripted Chromium against an isolated stack (own ports, own Docker volumes, disposable accounts):

| Scenario | Flags | Result |
|---|---|---|
| Editor and tree (save on switch, false conflict, nested move, focus, typing during sync) | off | 16/16 |
| Stored conflicts (pause, resolve, both win orders, typing while recorded, delete) | off | 28/28 |
| Spaces, two accounts: invitation by link, a moved Document's image reaching the other member, scripted SVG opened directly, cancel deletion, removal wiping the device | spaces | 21/21 |
| Live sessions, two accounts and two tabs: typing, undo/redo, emoji, theme change, save, typing through a disconnection (135 queued updates), leaving, a save conflict answered and saved | both | 18/18, three consecutive runs |

Confirmed failing on the code before the fix: the merged-save test (`782b7df`) against the
previous `collab.js`; the invariant, restore and transfer tests as recorded in their commits.

## Open Items / Notes

- **Rotate the production SSH password** if `prd-server.env` holds it (see Incident).
- **Production-copy drill** is still not run; it needs approval and a fresh backup.
- Nothing has been pushed. `fix/sync-stranded-writes` still carries the two crash fixes for `main`.
- One of about fifteen browser runs ended with "the app did not start" within 36 seconds for the
  owner's profile. It did not recur and no cause was found. That profile now holds over a dozen
  test spaces, each opened in turn at start-up.
- Scratch containers, volumes, images, worktrees, browser profiles and the stray npx cache are
  still on disk. Test processes are stopped.
