/**
 * What the phone Home shows: which Documents a filter keeps, the Pinned and
 * Others sections, and the two masonry columns.
 */

export const HOME_FILTERS = Object.freeze(['all', 'inbox', 'shared', 'pinned']);

/**
 * @param {unknown} value `?filter=` from the route
 * @returns {'all'|'inbox'|'shared'|'pinned'}
 */
export function normalizeHomeFilter(value) {
    return HOME_FILTERS.includes(value) ? value : 'all';
}

/** Whether a Document is in the Inbox: personal and in no folder. */
export function isInboxDocument(doc, personalDbKey) {
    return doc.dbKey === personalDbKey && !doc.folderId;
}

function newestFirst(a, b) {
    return String(b.displayedDate || '').localeCompare(String(a.displayedDate || ''));
}

/**
 * Documents for a filter, split into Pinned and Others, each newest first.
 *
 * @param {object[]} docs normalized dashboard Documents
 * @param {string} filter
 * @param {string} personalDbKey
 * @returns {{ pinned: object[], others: object[] }}
 */
export function buildHomeSections(docs, filter, personalDbKey) {
    const kept = (docs || []).filter((doc) => {
        if (filter === 'inbox') return isInboxDocument(doc, personalDbKey);
        if (filter === 'shared') return Boolean(doc.dbKey && doc.dbKey !== personalDbKey);
        if (filter === 'pinned') return doc.isPinned;
        return true;
    }).sort(newestFirst);
    if (filter === 'pinned') return { pinned: kept, others: [] };
    return {
        pinned: kept.filter((doc) => doc.isPinned),
        others: kept.filter((doc) => !doc.isPinned),
    };
}

/**
 * Split cards into two columns, each card going to the shorter column, so a
 * grid of uneven cards stays balanced while reading roughly in order.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => number} estimateHeight
 * @returns {[T[], T[]]}
 */
export function splitIntoColumns(items, estimateHeight) {
    const columns = [[], []];
    const heights = [0, 0];
    for (const item of items) {
        const target = heights[1] < heights[0] ? 1 : 0;
        columns[target].push(item);
        heights[target] += estimateHeight(item);
    }
    return columns;
}
