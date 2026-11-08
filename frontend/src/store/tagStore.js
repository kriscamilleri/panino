// /frontend/src/store/tagStore.js
/**
 * Tag styling and the sidebar tag filter (docs/specs/active/tag-system.md §4–§5).
 *
 * - The `tags` rows of each database (display name and palette colour), read
 *   lazily per database and reloaded after a sync that changed them.
 * - Writes: one column at a time (colour or display name), and reset, which
 *   deletes the row. Nothing here ever edits a Document.
 * - The active tag filters (canonical names, AND), for this session only, and
 *   the Documents they match across every open database.
 * - Whether the Tags manager is open, and on which database.
 *
 * Which tags a Document has comes from the metadata index
 * (`documentIndexStore`), never from this table.
 */
import { defineStore } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import { canonicalTagName, tagDisplayName } from '@panino/content-merge/front-matter';
import { mergeDashboardRows } from '@/utils/syncRegistry';
import { folderPaths, trashFolderIds } from '@/utils/tagFilter';
import { isTagColor, tagColorHex, tagColorKey } from '@/utils/tagPalette';
import { useDocumentIndexStore } from './documentIndexStore';
import { useSyncStore } from './syncStore';

/**
 * @typedef {{ name: string, displayName: string, color: string, createdAt: string, updatedAt: string }} TagStyleRow
 */

export const useTagStore = defineStore('tagStore', () => {
    const syncStore = useSyncStore();
    const index = useDocumentIndexStore();

    /** dbKey → canonical name → row. */
    const styles = reactive({});
    const loads = new Map();
    /** dbKey → the handle its rows were read from, so a reopened database is read again. */
    const loadedFrom = new Map();

    /** Active filters: canonical names, every one required. */
    const filters = ref([]);
    const hasFilters = computed(() => filters.value.length > 0);

    const managerOpen = ref(false);
    const managerDbKey = ref(null);

    /**
     * Read a database's `tags` rows (once; `force` reads them again).
     * @param {string} dbKey
     * @param {{ force?: boolean }} [options]
     * @returns {Promise<void>}
     */
    function loadStyles(dbKey, { force = false } = {}) {
        const db = syncStore.databases.get(dbKey)?.db;
        if (!db) return Promise.resolve();
        if (!force && loads.has(dbKey) && loadedFrom.get(dbKey) === db) return loads.get(dbKey);
        loadedFrom.set(dbKey, db);
        const load = syncStore.repository(dbKey)
            .execute('SELECT name, display_name, color, created_at, updated_at FROM tags')
            .then((rows) => {
                const byName = {};
                for (const row of rows || []) {
                    if (typeof row.name !== 'string' || canonicalTagName(row.name) !== row.name) continue;
                    byName[row.name] = {
                        name: row.name,
                        displayName: row.display_name || '',
                        color: row.color || '',
                        createdAt: row.created_at || '',
                        updatedAt: row.updated_at || '',
                    };
                }
                styles[dbKey] = byName;
            })
            .catch((error) => {
                loads.delete(dbKey);
                console.warn('[tagStore] Could not read tag styles', error?.name || error);
            });
        loads.set(dbKey, load);
        return load;
    }

    /**
     * A tag's row in a database, or null.
     * @param {string} dbKey
     * @param {string} name canonical name
     * @returns {TagStyleRow|null}
     */
    function styleRow(dbKey, name) {
        return styles[dbKey]?.[name] || null;
    }

    /**
     * How a tag looks in a database: the label (a valid display name, else the
     * given spelling, else the most used one, else the name), its palette key
     * and the hex value to draw it with. Unknown colour keys from another
     * client draw as neutral.
     * @param {string} dbKey
     * @param {string} name canonical name
     * @param {string} [spelling] the spelling found in the Document being shown
     * @returns {{ name: string, label: string, colorKey: string, hex: string, styled: boolean }}
     */
    function tagLook(dbKey, name, spelling) {
        const row = styleRow(dbKey, name);
        const display = row?.displayName && canonicalTagName(row.displayName) === name
            ? tagDisplayName(row.displayName)
            : null;
        const label = display || spelling || index.tagLabel(dbKey, name) || name;
        return {
            name,
            label,
            colorKey: tagColorKey(row?.color),
            hex: tagColorHex(row?.color),
            styled: Boolean(row),
        };
    }

    async function writeStyle(dbKey, sql, params) {
        await syncStore.repository(dbKey).transaction((tx) => tx.exec(sql, params));
        await loadStyles(dbKey, { force: true });
    }

    /**
     * Set a tag's colour in one database (writes `color` only).
     * @param {string} dbKey
     * @param {string} name
     * @param {string} color a palette key, or '' for neutral
     */
    async function setColor(dbKey, name, color) {
        const canonical = canonicalTagName(name);
        if (!canonical) throw new Error('A tag needs a name of 1 to 50 characters.');
        if (!isTagColor(color)) throw new Error('Choose one of the tag colours.');
        // Neutral with no display name is the unstyled look: remove the row
        // rather than write one that changes nothing yet counts as styled.
        if (color === '' && !styles[dbKey]?.[canonical]?.displayName) {
            await resetTag(dbKey, canonical);
            return;
        }
        const now = new Date().toISOString();
        await writeStyle(dbKey,
            `INSERT INTO tags (name, color, created_at, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET color = excluded.color, updated_at = excluded.updated_at`,
            [canonical, color, now, now]);
    }

    /**
     * Set a tag's display spelling in one database (writes `display_name`
     * only). It must be the same tag: only capitals and spacing may differ.
     * An empty value clears it.
     * @param {string} dbKey
     * @param {string} name
     * @param {string} displayName
     */
    async function setDisplayName(dbKey, name, displayName) {
        const canonical = canonicalTagName(name);
        if (!canonical) throw new Error('A tag needs a name of 1 to 50 characters.');
        const trimmed = String(displayName ?? '').trim();
        let value = '';
        if (trimmed) {
            value = tagDisplayName(trimmed);
            if (!value || canonicalTagName(value) !== canonical) {
                throw new Error(`A display name can change only the capitals of the tag, for example "${canonical.toUpperCase()}".`);
            }
        }
        const now = new Date().toISOString();
        await writeStyle(dbKey,
            `INSERT INTO tags (name, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
            [canonical, value, now, now]);
    }

    /**
     * Remove a tag's styling in one database; the tag draws as neutral again.
     * Documents are not touched.
     * @param {string} dbKey
     * @param {string} name
     */
    async function resetTag(dbKey, name) {
        const canonical = canonicalTagName(name);
        if (!canonical) return;
        await writeStyle(dbKey, 'DELETE FROM tags WHERE name = ?', [canonical]);
    }

    /**
     * Every tag in a database: styled ones and ones found in its Documents,
     * with their look and how many Documents carry them, by name.
     * @param {string} dbKey
     * @returns {{ name: string, label: string, colorKey: string, hex: string, styled: boolean, count: number }[]}
     */
    function listTags(dbKey) {
        const counts = index.tagCounts(dbKey);
        const names = new Set([...counts.keys(), ...Object.keys(styles[dbKey] || {})]);
        return [...names]
            .map((name) => ({ ...tagLook(dbKey, name), count: counts.get(name) || 0 }))
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.name.localeCompare(b.name));
    }

    /**
     * Tags to offer while typing `tags:` in a Document of this database:
     * styled tags first, then tags found in its Documents, most used first;
     * names starting with the prefix before names containing it.
     * @param {string} dbKey
     * @param {string} prefix what has been typed so far
     * @param {{ exclude?: Iterable<string>, limit?: number }} [options]
     * @returns {{ name: string, label: string, hex: string }[]}
     */
    function suggestions(dbKey, prefix, { exclude = [], limit = 8 } = {}) {
        const typed = String(prefix ?? '').trim().toLowerCase();
        const skip = new Set(exclude);
        const counts = index.tagCounts(dbKey);
        const candidates = listTags(dbKey).filter((tag) => !skip.has(tag.name)
            && tag.name !== typed
            && (!typed || tag.name.includes(typed)));
        const rank = (tag) => (tag.name.startsWith(typed) ? 0 : 2) + (tag.styled ? 0 : 1);
        return candidates
            .sort((a, b) => rank(a) - rank(b) || (counts.get(b.name) || 0) - (counts.get(a.name) || 0)
                || a.name.localeCompare(b.name))
            .slice(0, limit)
            .map(({ name, label, hex, colorKey }) => ({ name, label, hex, colorKey }));
    }

    /** @param {string} name */
    function addFilter(name) {
        const canonical = canonicalTagName(name);
        if (canonical && !filters.value.includes(canonical)) filters.value = [...filters.value, canonical];
    }

    /** @param {string} name */
    function removeFilter(name) {
        filters.value = filters.value.filter((value) => value !== name);
    }

    function clearFilters() {
        filters.value = [];
    }

    /**
     * The Documents carrying every one of the tags, across every open
     * database, newest edit first (then id), with Documents in a database's
     * Trash left out: the Documents a search for `tag:` parts gives.
     * @param {string[]} [names] defaults to the active filters
     * @returns {Promise<object[]>} rows `{ id, title, updated_at, folder_id, folderPath, dbKey, spaceName }`
     */
    async function findTaggedDocuments(names = filters.value) {
        if (!names.length) return [];
        const groups = [];
        for (const entry of [...syncStore.databases.values()]) {
            if (!entry.db) continue;
            const dbKey = entry.dbKey;
            try {
                await index.ensure(dbKey);
                const ids = index.idsWithTags(dbKey, names);
                if (!ids.size) continue;
                const repository = syncStore.repository(dbKey);
                const folders = await repository.execute('SELECT id, name, parent_id, created_at FROM folders');
                const rows = await repository.execute(
                    `SELECT id, title, updated_at, folder_id FROM notes
                     WHERE id IN (SELECT value FROM json_each(?))`,
                    [JSON.stringify([...ids])],
                );
                const trash = trashFolderIds(folders || []);
                const pathOf = folderPaths(folders || []);
                groups.push({
                    dbKey,
                    name: entry.kind === 'space' ? entry.name : null,
                    rows: (rows || [])
                        .filter((row) => !row.folder_id || !trash.has(row.folder_id))
                        .map((row) => ({ ...row, folderPath: pathOf(row.folder_id) })),
                });
            } catch (error) {
                console.warn(`[tagStore] Could not filter ${entry.kind === 'space' ? 'a space' : 'personal Documents'} by tag`, error?.name || error);
            }
        }
        return mergeDashboardRows(groups, { limit: Number.MAX_SAFE_INTEGER });
    }

    /**
     * Open the Tags manager, on a database (default: personal).
     * @param {string|null} [dbKey]
     */
    function openManager(dbKey = null) {
        managerDbKey.value = dbKey && syncStore.databases.get(dbKey)?.db ? dbKey : syncStore.personalDbKey;
        managerOpen.value = true;
    }

    function closeManager() {
        managerOpen.value = false;
    }

    // A sync that changed a database's `tags` rows reloads them, so a colour
    // another member set shows without a reload.
    syncStore.onRemoteChangesApplied?.((dbKey, changes) => {
        if (loads.has(dbKey) && (changes || []).some((change) => change?.table === 'tags')) {
            void loadStyles(dbKey, { force: true });
        }
    });

    // Another account on this device starts without the last one's filters.
    watch(() => syncStore.personalDbKey, () => {
        filters.value = [];
        managerOpen.value = false;
    });

    watch(
        () => [...syncStore.databases.entries()].map(([dbKey, entry]) => [dbKey, entry.db]),
        (current) => {
            const live = new Map(current);
            for (const dbKey of [...loadedFrom.keys()]) {
                if (live.get(dbKey) !== loadedFrom.get(dbKey)) {
                    delete styles[dbKey];
                    loads.delete(dbKey);
                    loadedFrom.delete(dbKey);
                }
            }
            if (managerDbKey.value && !live.get(managerDbKey.value)) managerDbKey.value = syncStore.personalDbKey;
        },
    );

    return {
        styles,
        filters,
        hasFilters,
        managerOpen,
        managerDbKey,
        loadStyles,
        styleRow,
        tagLook,
        setColor,
        setDisplayName,
        resetTag,
        listTags,
        suggestions,
        addFilter,
        removeFilter,
        clearFilters,
        findTaggedDocuments,
        openManager,
        closeManager,
    };
});
