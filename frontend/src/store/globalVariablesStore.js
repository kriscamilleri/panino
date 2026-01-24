// /frontend/src/store/globalVariablesStore.js
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import { useSyncStore } from './syncStore';
import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';

export const useGlobalVariablesStore = defineStore('globalVariablesStore', () => {
    const syncStore = useSyncStore();
    const authStore = useAuthStore();
    const uiStore = useUiStore();

    const globals = ref([]);
    const isLoaded = ref(false);

    function normalizeVariableName(name) {
        return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function normalizeDisplayName(name) {
        return (name || '').trim().replace(/\s+/g, ' ');
    }

    const globalsMap = computed(() => {
        const map = new Map();
        globals.value.forEach((item) => {
            if (item?.key) map.set(item.key, item.value ?? '');
        });
        return map;
    });

    async function loadGlobals() {
        if (!syncStore.isInitialized) return;
        try {
            if (syncStore.ensureGlobalsSchema) {
                await syncStore.ensureGlobalsSchema();
            }
            const rows = await syncStore.execute(
                `SELECT id, key, value, created_at, updated_at, display_key FROM globals ORDER BY display_key COLLATE NOCASE ASC`
            );
            globals.value = (rows || []).map(r => ({
                id: r.id,
                key: r.key,
                value: r.value ?? '',
                createdAt: r.created_at,
                updatedAt: r.updated_at,
                displayKey: r.display_key || r.key,
            }));
            isLoaded.value = true;
        } catch (err) {
            console.error('[globalVariablesStore] Failed to load globals', err);
            isLoaded.value = true;
        }
    }

    async function saveGlobalVariable(name, value) {
        const normalizedKey = normalizeVariableName(name);
        const displayKey = normalizeDisplayName(name);
        if (!normalizedKey) {
            uiStore.addToast('Variable name is required.', 'error');
            return false;
        }
        const now = new Date().toISOString();
        try {
            if (syncStore.ensureGlobalsSchema) {
                await syncStore.ensureGlobalsSchema();
            }
            let existing;
            try {
                existing = await syncStore.execute(
                    `SELECT id, created_at FROM globals WHERE key = ?`,
                    [normalizedKey]
                );
            } catch (queryErr) {
                const msg = String(queryErr?.message || queryErr);
                if (msg.includes('no such column: id') && syncStore.ensureGlobalsSchema) {
                    await syncStore.ensureGlobalsSchema();
                    existing = await syncStore.execute(
                        `SELECT id, created_at FROM globals WHERE key = ?`,
                        [normalizedKey]
                    );
                } else {
                    throw queryErr;
                }
            }

            const row = existing?.[0];
            const id = row?.id || uuidv4();
            const createdAt = row?.created_at || now;
            await syncStore.execute(
                `INSERT INTO globals (id, key, display_key, value, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET
                   display_key = excluded.display_key,
                   value = excluded.value,
                   updated_at = excluded.updated_at`,
                [id, normalizedKey, displayKey, value ?? '', createdAt, now]
            );
            await loadGlobals();
            return true;
        } catch (err) {
            console.error('[globalVariablesStore] Failed to save global', err);
            uiStore.addToast('Failed to save variable.', 'error');
            return false;
        }
    }

    async function deleteGlobalVariable(nameOrKey) {
        const normalizedKey = normalizeVariableName(nameOrKey);
        if (!normalizedKey) return false;
        try {
            await syncStore.execute(`DELETE FROM globals WHERE key = ?`, [normalizedKey]);
            await loadGlobals();
            return true;
        } catch (err) {
            console.error('[globalVariablesStore] Failed to delete global', err);
            uiStore.addToast('Failed to delete variable.', 'error');
            return false;
        }
    }

    function getGlobalValue(name) {
        const normalizedKey = normalizeVariableName(name);
        if (!normalizedKey) return undefined;
        return globalsMap.value.get(normalizedKey);
    }

    watch(() => [syncStore.isInitialized, authStore.user?.id], ([ready]) => {
        if (ready) {
            isLoaded.value = false;
            loadGlobals();
        }
    }, { immediate: true });

    return {
        globals,
        globalsMap,
        isLoaded,
        normalizeVariableName,
        normalizeDisplayName,
        loadGlobals,
        saveGlobalVariable,
        deleteGlobalVariable,
        getGlobalValue,
    };
});
