// /frontend/src/store/typewriterStore.js
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useSyncStore } from './syncStore';
import { useAuthStore } from './authStore';
import { useViewport } from '@/composables/useViewport';
import {
    FORM_FACTORS,
    TYPEWRITER_SETTINGS_VERSION,
    defaultTypewriterSettings,
    normalizeTypewriterProfileRow,
    normalizeTypewriterSettings,
    typewriterSettingsId,
} from '@/utils/typewriterSettings';

/**
 * Typewriter mode settings (docs/specs/active/typewriter-mode.md §9.3).
 *
 * Two rows of the synced `settings` table, `typewriter.desktop` and
 * `typewriter.phone`. A save writes only the profiles changed here, so a
 * phone change and a desktop change made before they sync both survive
 * (CR-SQLite keeps the last write per column). Not inside `uiSettings`: uiStore rewrites that row from a
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
    // A save between leaving the timer and the write finishing: a reload in
    // that window would read the old rows and undo what was just changed.
    let saving = null;
    let loadRun = 0;
    // Changes made before the rows were read: applied on top of them once they are.
    let earlyPatches = [];
    // The profiles changed on this device since the last save.
    const dirty = new Set();

    const savePending = () => saveTimer !== null || saving !== null || dirty.size > 0;

    async function writeRows() {
        saveTimer = null;
        if (!loaded.value || !syncStore.isInitialized || dirty.size === 0) return;
        const keys = [...dirty];
        dirty.clear();
        const run = (async () => {
            for (const key of keys) {
                const value = { version: TYPEWRITER_SETTINGS_VERSION, settings: profiles.value[key] };
                try {
                    await syncStore.personalRepository().exec(
                        'INSERT OR REPLACE INTO settings (id, value) VALUES (?, ?)',
                        [typewriterSettingsId(key), JSON.stringify(value)],
                    );
                } catch (error) {
                    console.error('[typewriterStore] Saving typewriter settings failed:', error);
                }
            }
        })();
        saving = run;
        try {
            await run;
        } finally {
            if (saving === run) saving = null;
        }
    }

    /** Save after 500 ms without further changes, like the other settings. */
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { void writeRows(); }, 500);
    }

    /**
     * Read the row. A missing row or broken JSON gives the defaults. While a
     * save is still waiting, the local values are newer and are kept; changes
     * made before the first read are applied on top of what was read.
     */
    async function load() {
        if (!syncStore.isInitialized) return;
        const run = ++loadRun;
        const next = {};
        try {
            const rows = await syncStore.personalRepository().execute(
                'SELECT id, value FROM settings WHERE id IN (?, ?)',
                FORM_FACTORS.map(typewriterSettingsId),
            );
            const byId = new Map((rows || []).map((row) => [row.id, row.value]));
            for (const key of FORM_FACTORS) next[key] = normalizeTypewriterProfileRow(byId.get(typewriterSettingsId(key)) ?? null, key);
        } catch (error) {
            console.error('[typewriterStore] Loading typewriter settings failed:', error);
            for (const key of FORM_FACTORS) next[key] = normalizeTypewriterProfileRow(null, key);
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
        if (!savePending()) profiles.value = { desktop: next.desktop, phone: next.phone };
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
        dirty.add(key);
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
                dirty.clear();
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
            if (wasSyncing && !syncing && loaded.value && !savePending()) void load();
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
