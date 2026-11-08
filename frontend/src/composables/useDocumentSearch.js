/**
 * One search session for the phone Search page and the desktop search panel
 * (docs/specs/active/advanced-search.md §5): the field's text, the query it
 * settles to 150 ms after typing stops, the results page by page, the
 * notices, and recent searches. Both screens use it, so they behave alike.
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import { useDocStore } from '@/store/docStore';
import { useSyncStore } from '@/store/syncStore';
import { readRecentSearches, rememberSearch } from '@/utils/searchQuery';

/** Results update this long after typing stops (the phone's timing). */
export const SEARCH_DEBOUNCE_MS = 150;
/** A query is remembered after this long without typing. */
export const REMEMBER_AFTER_MS = 2000;
export const SEARCH_PAGE_SIZE = 20;
/** Shown results are searched again after a sync at most this often. */
export const REFRESH_AFTER_SYNC_MS = 2000;

/** localStorage, or a stand-in when it is unavailable (private mode). */
export function searchStorage() {
    try {
        return window.localStorage;
    } catch {
        return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    }
}

// The desktop panel's state lives for the session, so closing the panel and
// opening it again (Esc, the shortcut) keeps the query.
const desktopState = {
    open: ref(false),
    text: ref(''),
    focusRequest: ref(0),
};

/**
 * The desktop search panel's open state and text, shared by the sidebar, the
 * panel and the keyboard shortcut.
 *
 * @returns {{ open: import('vue').Ref<boolean>, text: import('vue').Ref<string>,
 *   focusRequest: import('vue').Ref<number>, openSearch: () => void, closeSearch: () => void }}
 */
export function useDesktopSearchState() {
    return {
        ...desktopState,
        openSearch() {
            desktopState.open.value = true;
            desktopState.focusRequest.value += 1;
        },
        closeSearch() {
            desktopState.open.value = false;
        },
    };
}

/**
 * Whether a key event is the search shortcut, Ctrl+Shift+F (Cmd+Shift+F on a Mac).
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isSearchShortcut(event) {
    return Boolean((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey
        && String(event.key || '').toLowerCase() === 'f');
}

/**
 * @param {object} [options]
 * @param {import('vue').Ref<string>} [options.text] an existing ref to keep the field's text in
 * @param {string} [options.initialText]
 * @param {(query: string) => void} [options.onQuery] called when the query settles
 * @param {Storage} [options.storage]
 * @param {number} [options.pageSize]
 */
export function useDocumentSearch({
    text = ref(''),
    initialText,
    onQuery = () => {},
    storage = searchStorage(),
    pageSize = SEARCH_PAGE_SIZE,
} = {}) {
    const docStore = useDocStore();
    const syncStore = useSyncStore();
    if (typeof initialText === 'string') text.value = initialText;

    const query = ref(text.value.trim());
    const results = ref([]);
    const notices = ref([]);
    const terms = ref([]);
    const nextCursor = ref(null);
    const searching = ref(false);
    const loadingMore = ref(false);
    const recent = ref(readRecentSearches(storage));

    let debounceTimer = null;
    let rememberTimer = null;
    let run = 0;

    function remember(value = text.value) {
        if (!String(value ?? '').trim()) return;
        recent.value = rememberSearch(storage, value);
    }

    function settle(value) {
        const next = String(value ?? '').trim();
        if (next === query.value) return;
        query.value = next;
        onQuery(next);
    }

    // Only what the person typed is remembered after a pause; text the page writes itself (a
    // chip, the folder's in: part, a recent search) goes through setText and is not.
    let written = false;
    watch(text, (value) => {
        clearTimeout(debounceTimer);
        clearTimeout(rememberTimer);
        debounceTimer = setTimeout(() => settle(value), SEARCH_DEBOUNCE_MS);
        if (!written) rememberTimer = setTimeout(() => remember(value), REMEMBER_AFTER_MS);
        written = false;
    });

    /** Put text in the field without counting it as typed (it is not remembered on a pause). */
    function setText(value) {
        clearTimeout(rememberTimer);
        if (text.value === value) return;
        written = true;
        text.value = value;
    }

    /** Use the field's text now, without waiting (Enter, a chip, a recent search). */
    function flush() {
        clearTimeout(debounceTimer);
        settle(text.value);
    }

    async function runSearch() {
        const current = ++run;
        loadingMore.value = false;
        if (!query.value || !syncStore.isInitialized) {
            results.value = [];
            notices.value = [];
            terms.value = [];
            nextCursor.value = null;
            searching.value = false;
            return;
        }
        searching.value = true;
        const found = await docStore.searchDocuments({ query: query.value, limit: pageSize });
        // A slower, older search must not replace a newer one.
        if (current !== run || found.cancelled) return;
        results.value = found.results;
        notices.value = found.notices;
        terms.value = found.terms;
        nextCursor.value = found.nextCursor;
        searching.value = false;
    }

    /** The next page, added below the results already shown. */
    async function loadMore() {
        if (!nextCursor.value || loadingMore.value || searching.value) return;
        const current = run;
        loadingMore.value = true;
        const found = await docStore.searchDocuments({ query: query.value, limit: pageSize, cursor: nextCursor.value });
        if (current !== run || found.cancelled) return;
        const shown = new Set(results.value.map((doc) => `${doc.dbKey}:${doc.id}`));
        results.value = [...results.value, ...found.results.filter((doc) => !shown.has(`${doc.dbKey}:${doc.id}`))];
        nextCursor.value = found.nextCursor;
        loadingMore.value = false;
    }

    watch(() => [query.value, syncStore.isInitialized], runSearch, { immediate: true });

    // After a sync changes Documents, search again so the list stays true, but at most once
    // per REFRESH_AFTER_SYNC_MS (a burst of syncs gives one re-run at its end) and only while
    // results are on screen.
    let refreshTimer = null;
    let lastRefresh = 0;
    function refreshAfterSync() {
        if (refreshTimer) return;
        const wait = Math.max(0, lastRefresh + REFRESH_AFTER_SYNC_MS - Date.now());
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            if (!query.value) return;
            lastRefresh = Date.now();
            runSearch();
        }, wait);
    }
    watch(() => docStore.recentDocVersion, () => {
        if (query.value) refreshAfterSync();
    });

    onBeforeUnmount(() => {
        clearTimeout(debounceTimer);
        clearTimeout(rememberTimer);
        clearTimeout(refreshTimer);
        run += 1;
    });

    return {
        text, query, results, notices, terms, nextCursor, searching, loadingMore, recent,
        flush, loadMore, remember, runSearch, setText,
    };
}

/**
 * The result count line: "3 Documents", "20+ Documents" while more pages
 * exist, or "No Documents match".
 *
 * @param {number} count
 * @param {boolean} more
 * @returns {string}
 */
export function resultCountLabel(count, more) {
    if (!count) return 'No Documents match';
    return `${count}${more ? '+' : ''} ${count === 1 && !more ? 'Document' : 'Documents'}`;
}
