# Verify my email, and copy or move between databases

- Agent: Claude Code (Opus 5.5)
- Started: 2026-10-11 16:30 (+02:00)
- Status: complete; nothing pushed

## Objective

Two requests from the developer after `2026-10-11_14-45_collab-flag-on-defects.md`:

1. Add a "verify my email" step. Invitations are listed and accepted without their mailed link
   only for a verified address, and until now only a password reset verified one.
2. When a Document is dropped into another database, ask whether to **copy** it or **move** it,
   because a move deletes the original's revision history.

Both sit behind `SHARED_SPACES_ENABLED`. With the flag off nothing new is reachable.

## Correction to the previous log: browser runs were on an unstyled app

After the incident in the previous log I started the dev server by absolute path, with the
frontend directory as Vite's root, from the repository root. Tailwind resolves its configuration
and `content` globs from the process's working directory, not from Vite's root, so that server
generated **no utility classes**: every page rendered as plain HTML. Vite logged
`The content option in your Tailwind CSS configuration is missing or empty` and I did not read
the log. I found it from the first screenshots taken in this round.

The flag-on runs in the previous log's table (spaces 21/21, live sessions 18/18 three times), and
the flags-off reruns made after it, were therefore driven against an unstyled page: elements meant
to be hidden were visible and nothing could cover anything. All were rerun here on the styled app
(table below) with the same results. The harness now refuses to run on an unstyled page.

The server is now started as
`env -C <repo>/frontend node <repo>/frontend/node_modules/vite/bin/vite.js <repo>/frontend --host 127.0.0.1 --port N --strictPort`.
`env -C` sets the working directory as part of the command, where a leading `cd` is dropped by
the background runner. Checked at each start: listening on 127.0.0.1 only, working directory is
`frontend/`, `/prd-server.env` answers with the app's `index.html`, the `/@fs/` path answers 403.

## Changes Made

### Verify my email

- `backend/api-service/emailVerification.js` (new), mounted after `authenticateToken`:
  `POST /account/email-verification` and `POST /account/email-verification/confirm`. Both answer
  404 while shared spaces are off.
- `_users.db` gains `email_verifications` (`CREATE TABLE IF NOT EXISTS`; older builds ignore it).
- `mailer.js`: `sendEmailVerificationEmail`. `accountEmail.js`: `isSingleMailboxAddress`, shared
  with invitations.
- Frontend: `VerifyEmailPage.vue` at `/#/verify-email/<token>`, "Verify my email" on the Spaces
  page, `spacesStore.requestEmailVerification` / `confirmEmailVerification`. The Spaces page
  reloads its invitations when its tab is shown again while unverified, since the link usually
  opens in another tab.

**Decision the developer may want to change: confirming needs the account's own session.** The
token alone is not accepted. Sign-up does not check addresses, so anyone can register someone
else's and ask for the verification mail. If a click by the mailbox's real holder were enough,
that stranger's account would become verified for an address it does not hold, and could then
list and accept that person's invitations, which is the takeover the verified flag exists to
prevent. The holder cannot sign in to the stranger's account, so their click does nothing. The
cost: the link must be opened where the account is signed in, or after signing in (sign-in keeps
the link and returns to it).

Other rules: the mail goes to the stored address, never one in the request; three requests an
hour per account, counted whether or not mail went out; tokens are 256 bits, stored hashed, valid
24 hours; confirming spends every outstanding link; the page verifies only on a button, so a mail
scanner following the link verifies nothing.

### Copy or move

- `POST /space-transfers` takes `mode: "copy" | "move"`. **There is no default.** My first version
  defaulted a missing mode to "move"; a test sending `mode: null` then moved, and deleted, a
  Document. No released client depends on a default, so the field is required.
- The choice is stored (`space_transfers.keep_source`) and read from the row on every resume. A
  copy ends at `kept_both` once the destination is verified and never touches the source.
  `delete-source` is refused for a copy.
- `keep_source` is added by `addColumnIfMissing` **without** raising `SPACES_SCHEMA_VERSION`. A
  build that does not know the column still opens the database (it refuses a higher version) and
  its rows default to a move.
- The dialog (`DocumentTransferPanel.vue`) is titled "Copy or move?", states what each does to the
  original and its revision history, and has Cancel, Move and Copy. The recovery panel offers
  "Finish copy" or "Cancel copy" for an interrupted copy and never "Delete source".
- The pre-flight (unsaved text, held conflict, upload confirmed) applies to a copy too: a copy made
  from stale text is a wrong copy.

Not changed: revision history is still never copied, in either mode. A copy of a Document that is
open in a live session is refused, like a move, because it would silently leave out the session's
unsaved text.

## Tests

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run test:shared` | 25 passed |
| `npm run test:fe` | 733 passed (56 files) |
| `npm run test:be` | 434 passed (30 files) |
| production frontend build, API image build | succeed |

New: `tests/integration/emailVerification.test.js` (12), copy-mode cases in
`spaceTransfer.test.js` (now 20, including a non-member trying to copy out of a space or another
account), `db.test.js` (column added without a version), `verifyEmailPage.test.js` (5),
`documentTransferPanel.test.js` (8), and additions to the Spaces page and both store suites.

Scripted Chromium, styled app, isolated stack, real mail caught by a local MailHog:

| Scenario | Flags | Result |
|---|---|---|
| Verify my email and copy or move, two accounts and a signed-out browser (34 checks) | spaces | 34/34 in each of three runs |
| Editor and tree | off | 16/16 |
| Stored conflicts | off | 28/28 |
| Spaces, two accounts | spaces | 21/21 |
| Live sessions, two accounts and two tabs | both | 18/18, twice |
| Two tabs typing at the same position at once, 10 rounds | both | every character present and both tabs identical in 10/10 |

What the 34 checks cover: the unverified hint and button; one mail to the account's own address;
another signed-in account opening the link verifies nothing; a signed-out browser is sent to
sign-in, returns to the link, and verifies only on the button; the invitation then appears, in the
tab that asked as well, and is accepted without its link; the fourth request in an hour is refused
and sends nothing; the dialog's wording, and its buttons at 375 px; Cancel sends nothing; Copy
leaves the original, its three revisions and its image, and makes one copy with its own id, image
and single revision; the other member receives the copy and its image and cannot reach the
original; Move deletes the original and its history; a member copies out of the space and the
shared original stays.

Dialogs, the Spaces page and the verification page were looked at in screenshots at 1280 px and
375 px. The first title ("Copy or move this Document?") was cut off at 375 px and the two button
labels wrapped; both were shortened.

Three things in the browser runs were the script, not the app:

- A Document inside a space is known to the tree only once the space has been expanded there. The
  script asked the store to move one before expanding the space.
- The older two-tab stress script reported "lost" in 2 of 6 rounds. It types in both tabs at the
  same position at once and looks for an unbroken marker. Measured directly: no character missing
  and both tabs identical in every round; the marker is split by the other tab's letters
  (`tab1-firs` + `tab1-after-1 ` + `t `), as the live-sessions document already describes.
- Two further attempts at the 34-check scenario never reached a check. The first run after
  restarting the dev server did not get past start-up within 36 seconds; the next, with the server
  warm, started in under two. This is probably what the previous log's unexplained "the app did not
  start" was, but I did not confirm that. Another attempt could not start its API container
  because the previous scenario's was still holding the port.
- Before the styled runs, the same scenario passed 33 and then 34 checks on the unstyled server.
  Those runs are not counted.

## Open Items / Notes

- Still open from the previous log: rotate the production SSH password if `prd-server.env` holds
  it; the production-copy drill; pushing; `fix/sync-stranded-writes` for `main`.
- The long-lived test owner in the scratch stack has reached the 20 owned-space limit (the limit
  works). Flag-on scenarios now take a fresh owner per run.
- `GET /me` does not report whether the address is verified; only `GET /space-invitations` does.
  A badge in Settings would need it.
- A copy made into the same space twice produces two Documents with the same title.
- Scratch containers, volumes, images, networks, browser profiles and screenshots are still on
  disk. The harness now stops containers instead of removing them. Test processes are stopped.
