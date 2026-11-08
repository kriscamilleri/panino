/**
 * The data behind the property picker (docs/specs/active/advanced-search.md §5.4): the keys
 * of every open database's metadata index plus the built-ins, and the values seen for a key.
 * The index is built on the first open, never at start-up.
 */
import { ref } from 'vue';
import { useDocumentIndexStore } from '@/store/documentIndexStore';
import { useSyncStore } from '@/store/syncStore';
import { mergePropertyKeys, mergePropertyValues } from '@/utils/propertyPicker';

export function usePropertyPicker() {
    const index = useDocumentIndexStore();
    const syncStore = useSyncStore();
    const open = ref(false);
    const loading = ref(false);
    const keys = ref(mergePropertyKeys([]));

    function openDatabases() {
        return [...syncStore.databases.values()].filter((entry) => entry.db).map((entry) => entry.dbKey);
    }

    /** Open the picker and load the keys (the index of a database is built if needed). */
    async function openPicker() {
        open.value = true;
        loading.value = true;
        const dbKeys = openDatabases();
        await Promise.all(dbKeys.map((dbKey) => index.ensure(dbKey).catch(() => {})));
        keys.value = mergePropertyKeys(dbKeys.map((dbKey) => index.propertyKeys(dbKey)));
        loading.value = false;
    }

    function closePicker() {
        open.value = false;
    }

    /**
     * @param {string} key
     * @param {{ limit?: number }} [options] the 50 most used by default; Infinity for all
     * @returns {Array<{ value: string, count: number }>}
     */
    function valuesFor(key, { limit = 50 } = {}) {
        if (!key) return [];
        return mergePropertyValues(openDatabases().map((dbKey) => index.propertyValues(dbKey, key)), limit);
    }

    return { open, loading, keys, openPicker, closePicker, valuesFor };
}
