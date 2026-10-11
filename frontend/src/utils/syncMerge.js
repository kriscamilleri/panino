import { normalizeContent, mergeContent } from '@panino/content-merge';

/**
 * Pure dispatch for the sync-time content merge (COLLAB-02 §5.3). Takes the
 * per-document base/mine/theirs and the server capability and returns a single
 * decision the sync transaction can execute. Keeping this decision a pure
 * function makes the merge table testable without the CR-SQLite WASM.
 */

export const WRITEBACK_WINDOW_MS = 60 * 1000;
/** The fourth write-back within a minute is suppressed and becomes a conflict. */
export const WRITEBACK_MAX_COUNT = 3;

/**
 * @param {{ hasBase: boolean, hasMine?: boolean, base: string | null | undefined, mine: string | null | undefined, theirs: string | null | undefined, capabilityEnabled: boolean }} parts
 * @returns {{
 *   action: 'record-base' | 'adopt-theirs' | 'restore-mine' | 'write-merge' | 'record-conflict',
 *   content: string,
 *   conflicts: Array<{ baseLines: string[], mineLines: string[], theirsLines: string[] }>,
 *   reason?: string,
 *   pendingMerged?: string,
 * }}
 */
export function resolveSyncMerge({ hasBase, hasMine = true, base, mine, theirs, capabilityEnabled }) {
    const nb = normalizeContent(base);
    const nm = normalizeContent(mine);
    const nt = normalizeContent(theirs);

    if (!hasBase) {
        // A row that did not exist before remote apply is a first-time pull,
        // not an empty local edit competing with the remote body.
        if (!hasMine) {
            return { action: 'record-base', content: nt, conflicts: [] };
        }
        if (nm === nt) {
            return { action: 'record-base', content: nt, conflicts: [] };
        }
        return {
            action: 'record-conflict',
            content: nt,
            conflicts: [{ baseLines: [], mineLines: nm.split('\n'), theirsLines: nt.split('\n') }],
            reason: 'no-base',
        };
    }

    if (nm === nb) {
        return { action: 'adopt-theirs', content: nt, conflicts: [] };
    }

    if (nt === nb) {
        return { action: 'restore-mine', content: nm, conflicts: [] };
    }

    const merge = mergeContent({ base: nb, mine: nm, theirs: nt });

    if (merge.status === 'conflict') {
        return { action: 'record-conflict', content: nt, conflicts: merge.conflicts };
    }

    if (merge.status === 'budget') {
        return { action: 'record-conflict', content: nt, conflicts: [], reason: 'budget' };
    }

    // Clean three-way merge.
    if (!capabilityEnabled) {
        return {
            action: 'record-conflict',
            content: nt,
            conflicts: [],
            reason: 'writeback-disabled',
            pendingMerged: merge.content,
        };
    }

    return { action: 'write-merge', content: merge.content, conflicts: [] };
}

/**
 * True when every line of `inner` appears in `outer`, in the same order.
 *
 * @param {string} outer
 * @param {string} inner
 * @returns {boolean}
 */
export function containsLinesInOrder(outer, inner) {
    const outerLines = normalizeContent(outer).split('\n');
    const innerLines = normalizeContent(inner).split('\n');
    let matched = 0;
    for (const line of outerLines) {
        if (matched < innerLines.length && line === innerLines[matched]) matched += 1;
    }
    return matched === innerLines.length;
}

/**
 * True when `larger` already holds everything `smaller` added to `base`:
 * `smaller` only added lines to `base`, and all of `smaller` survives in
 * `larger`. Taking `larger` then loses nothing, even where a line-based merge
 * would report a conflict because both sides added text at the same place.
 *
 * @param {string} base
 * @param {string} smaller
 * @param {string} larger
 * @returns {boolean}
 */
export function supersedes(base, smaller, larger) {
    return containsLinesInOrder(smaller, base) && containsLinesInOrder(larger, smaller);
}

/**
 * The content the server holds for a document after a `/sync` request that
 * returned another replica's value. The server's reply is computed before it
 * merges this request's upload, so both sides of a concurrent edit are known
 * here and the last-writer-wins outcome can be read off the column versions.
 *
 * @param {{
 *   remote: string | null | undefined,
 *   remoteColVersion: number,
 *   sent?: { content: string, colVersion: number } | null,
 *   postApply: string | null | undefined,
 *   localChangedSinceSend?: boolean,
 * }} parts `sent` is this replica's value uploaded in the same request, if any
 * @returns {string | undefined} `undefined` when the outcome cannot be known
 */
export function resolveServerValue({ remote, remoteColVersion, sent, postApply, localChangedSinceSend = false }) {
    const remoteContent = remote ?? '';
    if (!sent) return remoteContent;

    const theirs = Number(remoteColVersion) || 0;
    const ours = Number(sent.colVersion) || 0;
    if (theirs > ours) return remoteContent;
    if (theirs < ours) return sent.content;

    // Equal versions are settled by a value comparison inside CR-SQLite. This
    // replica made the same comparison when it applied the remote row, but its
    // result mirrors the server only while the local value is still the one sent.
    if (localChangedSinceSend) return undefined;
    return normalizeContent(postApply) === normalizeContent(remoteContent) ? remoteContent : sent.content;
}

/**
 * Decide what to do with one document whose body arrived from another replica
 * (COLLAB-02 §5.3). Unlike {@link resolveSyncMerge}, this knows whether the
 * local replica really holds an unacknowledged edit, and it compares against
 * the remote replica's value rather than the local last-writer-wins outcome.
 *
 * Actions:
 * - `adopt`           the database already holds the remote body; nothing to write
 * - `keep`            the database already holds the right body (local or merged)
 * - `write`           store `content` as an ordinary local change
 * - `write-merge`     store an automatic merge (subject to the oscillation guard)
 * - `record-conflict` keep both sides for the user; no automatic write
 *
 * `base` is the merge base to store: the content the server is known to hold.
 * `undefined` leaves the stored base untouched.
 *
 * @param {{
 *   hasBase: boolean,
 *   base?: string | null,
 *   hasLocalRow: boolean,
 *   mine: string | null | undefined,
 *   remote: string | null | undefined,
 *   postApply: string | null | undefined,
 *   localPending: boolean,
 *   serverValue?: string,
 *   capabilityEnabled: boolean,
 * }} parts
 *   `mine` is the open editor's draft when there is one, else the stored body
 *   before the remote rows were applied; `postApply` is the stored body after;
 *   `localPending` is true when this replica has an edit the server has not
 *   acknowledged; `serverValue` comes from {@link resolveServerValue}.
 * @returns {{
 *   action: 'adopt' | 'keep' | 'write' | 'write-merge' | 'record-conflict',
 *   content?: string,
 *   base?: string,
 *   conflicts: Array<{ baseLines: string[], mineLines: string[], theirsLines: string[] }>,
 *   reason?: string,
 *   pendingMerged?: string,
 * }}
 */
export function planRemoteContent({
    hasBase,
    base,
    hasLocalRow,
    mine,
    remote,
    postApply,
    localPending,
    serverValue,
    capabilityEnabled,
}) {
    const nr = normalizeContent(remote);
    const nm = normalizeContent(mine);
    const np = normalizeContent(postApply);

    // A document this replica never held, or one both sides already agree on.
    if (!hasLocalRow || nm === nr) {
        return { action: 'adopt', base: nr, conflicts: [] };
    }

    // The local body survived the remote row although nothing was known to be
    // pending: an edit that never reached the server. Treat it as concurrent
    // rather than letting the remote body be recorded as agreed.
    const concurrent = localPending || np !== nr;
    if (!concurrent) {
        return { action: 'adopt', base: nr, conflicts: [] };
    }

    const nextBase = serverValue === undefined ? undefined : normalizeContent(serverValue);

    if (!hasBase) {
        // No common ancestor to merge from (first sync after upgrade). Both
        // bodies are kept; nothing is discarded on a guess.
        return {
            action: 'record-conflict',
            base: nextBase,
            conflicts: [{ baseLines: [], mineLines: nm.split('\n'), theirsLines: nr.split('\n') }],
            reason: 'no-base',
        };
    }

    const nb = normalizeContent(base);
    const storeRemote = () => (np === nr
        ? { action: 'adopt', base: nr, conflicts: [] }
        : { action: 'write', content: nr, base: nextBase ?? nb, conflicts: [] });
    const storeMine = () => (np === nm
        ? { action: 'keep', base: nextBase, conflicts: [] }
        : { action: 'write', content: nm, base: nextBase, conflicts: [] });

    if (nm === nb) return storeRemote();
    if (nr === nb) return storeMine();
    // One side already contains everything the other added (for example the
    // same edit arriving again inside a later version). Nothing to decide.
    if (supersedes(nb, nm, nr)) return storeRemote();
    if (supersedes(nb, nr, nm)) return storeMine();

    const merge = mergeContent({ base: nb, mine: nm, theirs: nr });
    if (merge.status === 'conflict') {
        return { action: 'record-conflict', base: nextBase, conflicts: merge.conflicts };
    }
    if (merge.status === 'budget') {
        return { action: 'record-conflict', base: nextBase, conflicts: [], reason: 'budget' };
    }

    const merged = normalizeContent(merge.content);
    if (merged === nr) return storeRemote();
    if (merged === nm) return storeMine();
    if (merged === np) return { action: 'keep', base: nextBase, conflicts: [] };

    if (!capabilityEnabled) {
        return {
            action: 'record-conflict',
            base: nextBase,
            conflicts: [],
            reason: 'writeback-disabled',
            pendingMerged: merge.content,
        };
    }
    return { action: 'write-merge', content: merge.content, base: nextBase, conflicts: [] };
}

/**
 * Decide what happens to a stored conflict when the Document's stored text is
 * replaced, by a local save or by a body arriving from another replica.
 *
 * A conflict record holds two bodies. One of them is the Document's stored
 * text; the other exists nowhere else and is what the record is for. Which is
 * which depends on who won last-writer-wins when the conflict was recorded:
 * after a remote win the stored text is `theirs` and `mine` is held, after a
 * local win it is the other way round and `theirs` is the body this replica's
 * upload displaced on the server. The side that matches `previous` is the one
 * that follows the Document; the other is never overwritten.
 *
 * - `keep`    leave the record as it is
 * - `clear`   the new text already contains the held body; nothing is left to decide
 * - `update`  store `mine` and `theirs` (one of them is `next`) with `conflicts`
 *
 * @param {{
 *   base: string | null | undefined,
 *   mine: string | null | undefined,
 *   theirs: string | null | undefined,
 *   previous: string | null | undefined,
 *   next: string | null | undefined,
 * }} parts `previous` and `next` are the Document's stored text before and after the change
 * @returns {{
 *   action: 'keep' | 'clear' | 'update',
 *   mine?: string,
 *   theirs?: string,
 *   conflicts?: Array<{ baseLines: string[], mineLines: string[], theirsLines: string[] }>,
 * }}
 */
export function planConflictAfterChange({ base, mine, theirs, previous, next }) {
    const nb = normalizeContent(base);
    const nm = normalizeContent(mine);
    const nt = normalizeContent(theirs);
    const np = normalizeContent(previous);
    const nn = normalizeContent(next);

    /** True when `text` already holds everything `body` changed from the base. */
    const covers = (text, body) => {
        if (text === body || supersedes(nb, body, text)) return true;
        const merge = mergeContent({ base: nb, mine: body, theirs: text });
        return merge.status === 'clean' && normalizeContent(merge.content) === text;
    };
    const update = (sides) => {
        const merge = mergeContent({ base: nb, ...sides });
        return { action: 'update', ...sides, conflicts: merge.status === 'conflict' ? merge.conflicts : [] };
    };

    if (nm === nt) return { action: 'clear' };
    if (nn === np) return { action: 'keep' };

    const documentSide = np === nm ? 'mine' : np === nt ? 'theirs' : null;
    if (documentSide === null) {
        // Neither recorded body is the text being replaced, so there is no
        // telling which one is held. Give one up only where the new text
        // already contains it.
        if (nn === nm || nn === nt) return { action: 'keep' };
        const coversMine = covers(nn, nm);
        const coversTheirs = covers(nn, nt);
        if (coversMine && coversTheirs) return { action: 'clear' };
        if (coversMine) return update({ mine: nn, theirs: nt });
        if (coversTheirs) return update({ mine: nm, theirs: nn });
        return { action: 'keep' };
    }

    const held = documentSide === 'mine' ? nt : nm;
    if (covers(nn, held)) return { action: 'clear' };
    return update(documentSide === 'mine' ? { mine: nn, theirs: nt } : { mine: nm, theirs: nn });
}

/**
 * Rolling write-back oscillation guard (COLLAB-02 §6.3). The first write-back
 * starts the window; the fourth within 60 seconds is suppressed. Elapsing the
 * window resets the count.
 *
 * @param {{ writebackCount: number, windowStartedAt: string | null | undefined, now?: number }} state
 * @returns {{ allowed: boolean, writebackCount: number, windowStartedAt: string }}
 */
export function evaluateWritebackGuard({ writebackCount = 0, windowStartedAt = null, now = Date.now() }) {
    if (windowStartedAt == null) {
        return { allowed: true, writebackCount: 1, windowStartedAt: new Date(now).toISOString() };
    }

    const startedAtMs = new Date(windowStartedAt).getTime();
    if (Number.isNaN(startedAtMs) || now - startedAtMs >= WRITEBACK_WINDOW_MS) {
        return { allowed: true, writebackCount: 1, windowStartedAt: new Date(now).toISOString() };
    }

    if (writebackCount >= WRITEBACK_MAX_COUNT) {
        return { allowed: false, writebackCount, windowStartedAt };
    }

    return { allowed: true, writebackCount: writebackCount + 1, windowStartedAt };
}
