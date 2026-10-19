/**
 * What the phone Home and folder screens show: which Documents a filter
 * keeps, how they are sorted, the Pinned and Others sections, and the two
 * masonry columns.
 */

export const HOME_FILTERS = Object.freeze(['all', 'shared', 'pinned']);

/** Sort fields offered on Home and in folders. */
export const SORT_FIELDS = Object.freeze(['modified', 'created', 'title']);
export const SORT_DIRECTIONS = Object.freeze(['desc', 'asc']);
export const DEFAULT_SORT = Object.freeze({ field: 'modified', direction: 'desc' });

/**
 * @param {unknown} value `?filter=` from the route
 * @returns {'all'|'shared'|'pinned'}
 */
export function normalizeHomeFilter(value) {
    return HOME_FILTERS.includes(value) ? value : 'all';
}

/**
 * A supported sort, or the default.
 *
 * @param {unknown} value `{ field, direction }`
 * @returns {{ field: 'modified'|'created'|'title', direction: 'asc'|'desc' }}
 */
export function normalizeSort(value) {
    const field = SORT_FIELDS.includes(value?.field) ? value.field : DEFAULT_SORT.field;
    const direction = SORT_DIRECTIONS.includes(value?.direction) ? value.direction : DEFAULT_SORT.direction;
    return { field, direction };
}

/**
 * Words for a sort, as the sort button and sheet show them.
 *
 * @param {{ field: string, direction: string }} sort
 * @returns {{ field: string, direction: string, short: string }}
 */
export function describeSort(sort) {
    const { field, direction } = normalizeSort(sort);
    if (field === 'title') {
        const order = direction === 'asc' ? 'A to Z' : 'Z to A';
        return { field: 'Title', direction: order, short: `Title, ${order}` };
    }
    const order = direction === 'desc' ? 'Newest first' : 'Oldest first';
    const name = field === 'created' ? 'Date created' : 'Date modified';
    return { field: name, direction: order, short: `${field === 'created' ? 'Created' : 'Modified'}, ${order.toLowerCase()}` };
}

const titleCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function timeOf(value) {
    const time = Date.parse(value || '');
    return Number.isNaN(time) ? null : time;
}

/**
 * Sort normalized Documents. Ties, and Documents without the sorted date,
 * fall back to the title so the order is stable; missing dates go last.
 *
 * @param {object[]} docs normalized dashboard Documents
 * @param {{ field: string, direction: string }} sort
 * @returns {object[]} a new array
 */
export function sortDocuments(docs, sort) {
    const { field, direction } = normalizeSort(sort);
    const sign = direction === 'asc' ? 1 : -1;
    const byTitle = (a, b) => titleCollator.compare(a.name || '', b.name || '');
    return [...(docs || [])].sort((a, b) => {
        if (field === 'title') return sign * byTitle(a, b) || String(a.id).localeCompare(String(b.id));
        const key = field === 'created' ? 'createdDate' : 'displayedDate';
        const timeA = timeOf(a[key]);
        const timeB = timeOf(b[key]);
        if (timeA === null || timeB === null) {
            if (timeA !== timeB) return timeA === null ? 1 : -1;
        } else if (timeA !== timeB) {
            return sign * (timeA - timeB);
        }
        return byTitle(a, b) || String(a.id).localeCompare(String(b.id));
    });
}

/**
 * Documents for a filter, split into Pinned and Others, each in the chosen order.
 *
 * @param {object[]} docs normalized dashboard Documents
 * @param {string} filter
 * @param {string} personalDbKey
 * @param {{ field: string, direction: string }} [sort]
 * @returns {{ pinned: object[], others: object[] }}
 */
export function buildHomeSections(docs, filter, personalDbKey, sort = DEFAULT_SORT) {
    const kept = sortDocuments((docs || []).filter((doc) => {
        if (filter === 'shared') return Boolean(doc.dbKey && doc.dbKey !== personalDbKey);
        if (filter === 'pinned') return doc.isPinned;
        return true;
    }), sort);
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
