import { computed, ref } from 'vue';

// Module state: Home or a folder selects, the Move sheet reads.
const selected = ref(new Map());

const keyOf = (doc) => `${doc.dbKey}:${doc.id}`;

/**
 * Multi-select of Documents on the phone (long-press a card).
 */
export function usePhoneSelection() {
    const items = computed(() => [...selected.value.values()]);
    const count = computed(() => selected.value.size);
    const selecting = computed(() => selected.value.size > 0);
    /** Every selected Document lives in one database (Move needs this). */
    const singleDatabase = computed(() => new Set(items.value.map((doc) => doc.dbKey)).size <= 1);

    function isSelected(doc) {
        return selected.value.has(keyOf(doc));
    }

    function toggle(doc) {
        const next = new Map(selected.value);
        if (next.has(keyOf(doc))) next.delete(keyOf(doc));
        else next.set(keyOf(doc), { id: doc.id, dbKey: doc.dbKey, name: doc.name, isPinned: doc.isPinned, folderId: doc.folderId });
        selected.value = next;
    }

    function clear() {
        selected.value = new Map();
    }

    return { items, count, selecting, singleDatabase, isSelected, toggle, clear };
}
