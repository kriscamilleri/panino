import { diff3Merge } from 'node-diff3';
/* global TextEncoder, crypto */

/**
 * Canonical content-merge module for Panino (`@panino/content-merge`).
 *
 * Owns normalization, hashing, three-way line merge, conflict-hunk
 * serialization, budgets and test vectors. Both the frontend (browser) and the
 * backend (Node) consume this package through a `file:` dependency and must
 * never carry their own merge implementation. See COLLAB-00 §4 and COLLAB-02.
 */

export const CONTENT_MERGE_LIMITS = Object.freeze({
    /** Maximum normalized document body, in bytes, eligible for automatic merge. */
    maxContentBytes: 1024 * 1024, // 1 MiB
    /** Maximum documents merged per sync turn. */
    maxDocumentsPerSync: 50,
});

/**
 * Maps `null`/`undefined` to `""` and converts CRLF to LF. Performs no Unicode
 * normalization, whitespace trimming or trailing-newline rewriting.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeContent(value) {
    if (value == null) return '';
    return String(value).replace(/\r\n/g, '\n');
}

/**
 * Lowercase hexadecimal SHA-256 over the UTF-8 bytes of `normalizeContent(value)`.
 * Uses the Web Crypto API, available identically in Node and modern browsers.
 *
 * @param {string | null | undefined} value
 * @returns {Promise<string>}
 */
export async function contentHash(value) {
    const bytes = new TextEncoder().encode(normalizeContent(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Byte length of the normalized content. */
export function contentByteLength(value) {
    return new TextEncoder().encode(normalizeContent(value)).length;
}

/** Whether a document body is within the automatic-merge budget. */
export function withinContentMergeBudget(value) {
    return contentByteLength(value) <= CONTENT_MERGE_LIMITS.maxContentBytes;
}

/**
 * Three-way line merge of a document body. `mine` and `theirs` are the two
 * divergent sides; `base` is the last value they agreed on.
 *
 * Returns:
 *   - `{ status: 'clean', content, conflicts: [] }` when the merge is automatic.
 *   - `{ status: 'conflict', content: theirs, conflicts: [...] }` when at least
 *     one region overlaps; `content` is `theirs` so the caller keeps the remote
 *     body and preserves `mine` in its conflict table.
 *   - `{ status: 'budget', content: theirs, conflicts: [] }` when a body exceeds
 *     the merge budget; the caller treats this as a recoverable conflict.
 *
 * A conflict hunk is `{ baseLines, mineLines, theirsLines }` — arrays of lines.
 * Concurrent insertions at the same point (empty base region) merge cleanly by
 * concatenation, which is what makes "pure append on both sides" lossless.
 *
 * @param {{ base: string | null | undefined, mine: string | null | undefined, theirs: string | null | undefined }} parts
 */
export function mergeContent({ base, mine, theirs }) {
    const nb = normalizeContent(base);
    const nm = normalizeContent(mine);
    const nt = normalizeContent(theirs);

    if (nm === nt) {
        return { status: 'clean', content: nm, conflicts: [] };
    }

    if (
        contentByteLength(nb) > CONTENT_MERGE_LIMITS.maxContentBytes ||
        contentByteLength(nm) > CONTENT_MERGE_LIMITS.maxContentBytes ||
        contentByteLength(nt) > CONTENT_MERGE_LIMITS.maxContentBytes
    ) {
        return { status: 'budget', content: nt, conflicts: [] };
    }

    const baseLines = nb.split('\n');
    const mineLines = nm.split('\n');
    const theirsLines = nt.split('\n');

    const regions = diff3Merge(mineLines, baseLines, theirsLines, {
        excludeFalseConflicts: true,
    });

    const merged = [];
    const conflicts = [];

    for (const region of regions) {
        if (region.ok) {
            merged.push(...region.ok);
            continue;
        }

        const { a, o, b } = region.conflict;
        // Concurrent insertion at the same point: base contributed no lines, so
        // both sides added different text in the same place. Concatenate rather
        // than conflict. A fully empty base is a new-document race, not a merge,
        // and stays a conflict.
        if (o.length === 0 && nb !== '') {
            merged.push(...a, ...b);
            continue;
        }

        conflicts.push({ baseLines: o, mineLines: a, theirsLines: b });
    }

    if (conflicts.length > 0) {
        return { status: 'conflict', content: nt, conflicts };
    }

    return { status: 'clean', content: merged.join('\n'), conflicts: [] };
}

/**
 * Serializes conflict hunks for the `note_conflicts.conflict_hunks` column.
 *
 * @param {Array<{ baseLines: string[], mineLines: string[], theirsLines: string[] }>} conflicts
 * @returns {string}
 */
export function serializeConflictHunks(conflicts) {
    return JSON.stringify(conflicts ?? []);
}
