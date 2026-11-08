// /frontend/src/store/typewriterStore.js
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useSyncStore } from './syncStore';
import { useAuthStore } from './authStore';
import { useViewport } from '@/composables/useViewport';
import {
    TYPEWRITER_SETTINGS_ID,
    TYPEWRITER_SETTINGS_VERSION,
    defaultTypewriterSettings,
    normalizeTypewriterRow,
    normalizeTypewriterSettings,
} from '@/utils/typewriterSettings';

/**
 * Typewriter mode settings (docs/specs/active/typewriter-mode.md §9.3).
 *
 * One row of the synced `settings` table, id `typewriter`, with a desktop and
 * a phone profile. Not inside `uiSettings`: uiStore rewrites that row from a
 * fixed list of fields, so an older cached app on another device would erase
 * anything new in it. Older clients never touch this row.
 *
 * `current` is the profile of this device's form factor, the same switch
 * (useViewport().isPhone) that picks the phone layout.
 */
export const useTypewriterStore = defineStore('typewriterStore', () => {
    const syncStore = useSyncStore();
    const authStore = useAuthStore();
    const { isPhone } = useViewport();

    const profiles = ref({
        desktop: defaultTypewriterSettings('desktop'),
        phone: defaultTypewriterSettings('phone'),
    });
    const loaded = ref(false);

    const formFactor = computed(() => (isPhone.value ? 'phone' : 'desktop'));
    const current = computed(() => profiles.value[formFactor.value]);
    const enabled = computed(() => current.value.enabled);

    let saveTimer = null;
    let loadRun = 0;
    // Changes made before the row was read: applied on top of it once it is.
    let earlyPatches = [];

    async function writeRow() {
        saveTimer = null;
        if (!loaded.value || !syncStore.isInitialized) return;
        const row = {
            version: TYPEWRITER_SETTINGS_VERSION,
            desktop: profiles.value.desktop,
            phone: profiles.value.phone,
        };
        try {
            await syncStore.personalRepository().exec(
                'INSERT OR REPLACE INTO settings (id, value) VALUES (?, ?)',
                [TYPEWRITER_SETTINGS_ID, JSON.stringify(row)],
            );
        } catch (error) {
            console.error('[typewriterStore] Saving typewriter settings failed:', error);
        }
    }

    /** Save after 500 ms without further changes, like the other settings. */
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { void writeRow(); }, 500);
    }

    /**
     * Read the row. A missing row or broken JSON gives the defaults. While a
     * save is still waiting, the local values are newer and are kept; changes
     * made before the first read are applied on top of what was read.
     */
    async function load() {
        if (!syncStore.isInitialized) return;
        const run = ++loadRun;
        let next;
        try {
            const rows = await syncStore.personalRepository().execute(
                'SELECT value FROM settings WHERE id = ?',
                [TYPEWRITER_SETTINGS_ID],
            );
            next = normalizeTypewriterRow(rows?.[0]?.value ?? null);
        } catch (error) {
            console.error('[typewriterStore] Loading typewriter settings failed:', error);
            next = normalizeTypewriterRow(null);
        }
        if (run !== loadRun) return;
        if (!loaded.value) {
            const patches = earlyPatches;
            earlyPatches = [];
            let merged = { desktop: next.desktop, phone: next.phone };
            for (const { key, patch } of patches) {
                merged = { ...merged, [key]: normalizeTypewriterSettings({ ...merged[key], ...patch }, key) };
            }
            profiles.value = merged;
            loaded.value = true;
            if (patches.length) scheduleSave();
            return;
        }
        if (!saveTimer) profiles.value = { desktop: next.desktop, phone: next.phone };
    }

    /**
     * Change some settings of a form factor (this device's by default). The
     * other profile is left as it is.
     *
     * @param {Partial<ReturnType<typeof defaultTypewriterSettings>>} patch
     * @param {'desktop'|'phone'} [target]
     */
    function update(patch, target = formFactor.value) {
        const key = target === 'phone' ? 'phone' : 'desktop';
        if (!loaded.value) earlyPatches.push({ key, patch: { ...patch } });
        profiles.value = {
            ...profiles.value,
            [key]: normalizeTypewriterSettings({ ...profiles.value[key], ...patch }, key),
        };
        scheduleSave();
    }

    /**
     * Turn the mode on or off on this device's form factor.
     *
     * @returns {boolean} whether the mode is now on
     */
    function toggle() {
        const next = !current.value.enabled;
        update({ enabled: next });
        return next;
    }

    // Load when the database is ready, and again for another user.
    watch(
        () => [syncStore.isInitialized, authStore.user?.id],
        ([ready], previous) => {
            if (!ready) return;
            if (previous && previous[1] !== authStore.user?.id) {
                clearTimeout(saveTimer);
                saveTimer = null;
                earlyPatches = [];
                loaded.value = false;
            }
            void load();
        },
        { immediate: true },
    );

    // Pick up a change made on another device once a sync round has run.
    watch(
        () => syncStore.isSyncing,
        (syncing, wasSyncing) => {
            if (wasSyncing && !syncing && loaded.value && !saveTimer) void load();
        },
    );

    return {
        profiles,
        loaded,
        formFactor,
        current,
        enabled,
        load,
        update,
        toggle,
    };
});
