// @vitest-environment jsdom
// typewriterStore keeps typewriter mode's settings in their own synced
// `settings` rows, one per form factor (docs/specs/active/typewriter-mode.md §9.3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, reactive, ref } from 'vue';

const rows = new Map();
const repo = {
    execute: vi.fn(async (sql, params) => (params || [])
        .filter((id) => rows.has(id))
        .map((id) => ({ id, value: rows.get(id) }))),
    exec: vi.fn(async (sql, params) => { rows.set(params[0], params[1]); }),
};
const DESKTOP = 'typewriter.desktop';
const PHONE = 'typewriter.phone';
/** Store one profile row as the app writes it. */
const setProfile = (id, settings) => rows.set(id, JSON.stringify({ version: 1, settings }));
const savedProfile = (id) => JSON.parse(rows.get(id)).settings;
const remoteListeners = new Set();
const sync = reactive({
    isInitialized: false,
    isSyncing: false,
    personalRepository: () => repo,
    onRemoteChangesApplied: (listener) => { remoteListeners.add(listener); return () => remoteListeners.delete(listener); },
});
/** A pulled change set, as syncStore reports it after applying. */
const pulled = async (tables) => {
    for (const listener of remoteListeners) listener('personal', tables.map((table) => ({ table, pk: 'x' })));
    await Promise.resolve();
};
const auth = reactive({ user: { id: 'user-A' } });
const isPhone = ref(false);

vi.mock('@/store/syncStore', () => ({ useSyncStore: () => sync }));
vi.mock('@/store/authStore', () => ({ useAuthStore: () => auth }));
vi.mock('@/composables/useViewport', () => ({ useViewport: () => ({ isPhone }) }));

const { useTypewriterStore } = await import('@/store/typewriterStore');

const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await nextTick();
};

describe('typewriterStore', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        rows.clear();
        remoteListeners.clear();
        repo.execute.mockClear();
        repo.exec.mockClear();
        sync.isInitialized = false;
        sync.isSyncing = false;
        auth.user = { id: 'user-A' };
        isPhone.value = false;
        setActivePinia(createPinia());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('loads after the database is ready', async () => {
        setProfile(DESKTOP, { enabled: true, dim: 'sentence' });
        const store = useTypewriterStore();
        await flush();
        expect(repo.execute).not.toHaveBeenCalled();
        expect(store.current.enabled).toBe(false);

        sync.isInitialized = true;
        await flush();
        expect(repo.execute).toHaveBeenCalledWith(expect.stringContaining('FROM settings'), [DESKTOP, PHONE]);
        expect(store.loaded).toBe(true);
        expect(store.current).toMatchObject({ enabled: true, dim: 'sentence', contextLines: 3 });
    });

    it('serves the profile of the form factor', async () => {
        setProfile(DESKTOP, { enabled: true });
        setProfile(PHONE, { enabled: false, anchorPercent: 33 });
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        expect(store.formFactor).toBe('desktop');
        expect(store.enabled).toBe(true);
        isPhone.value = true;
        expect(store.formFactor).toBe('phone');
        expect(store.current).toMatchObject({ enabled: false, anchorPercent: 33, contextLines: 2 });
    });

    it('saves this form factor\'s row through a 500 ms debounce', async () => {
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        store.update({ dimStrength: 'strong' });
        store.update({ contextLines: 5 });
        expect(repo.exec).not.toHaveBeenCalled();
        vi.advanceTimersByTime(499);
        expect(repo.exec).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        await flush();
        expect(repo.exec).toHaveBeenCalledTimes(1);
        const [sql, params] = repo.exec.mock.calls[0];
        expect(sql).toContain('INSERT OR REPLACE INTO settings');
        expect(params[0]).toBe(DESKTOP);
        const saved = JSON.parse(params[1]);
        expect(saved.version).toBe(1);
        expect(saved.settings).toMatchObject({ dimStrength: 'strong', contextLines: 5 });
    });

    it('keeps the other form factor untouched, and never writes its row', async () => {
        setProfile(DESKTOP, { anchorPercent: 67 });
        setProfile(PHONE, { anchorPercent: 33, dim: 'off' });
        const phoneRow = rows.get(PHONE);
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        expect(store.toggle()).toBe(true);
        vi.advanceTimersByTime(500);
        await flush();
        expect(savedProfile(DESKTOP)).toMatchObject({ enabled: true, anchorPercent: 67 });
        expect(rows.get(PHONE)).toBe(phoneRow);
        expect(repo.exec.mock.calls.map(([, params]) => params[0])).toEqual([DESKTOP]);

        store.update({ contextLines: 9 }, 'phone');
        expect(store.profiles.phone.contextLines).toBe(9);
        expect(store.profiles.desktop.contextLines).toBe(3);
    });

    it('never touches uiSettings', async () => {
        rows.set('uiSettings', '{"showStats":true}');
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        store.toggle();
        vi.advanceTimersByTime(500);
        await flush();
        expect(rows.get('uiSettings')).toBe('{"showStats":true}');
        for (const [, params] of repo.exec.mock.calls) expect(params[0]).toBe(DESKTOP);
    });

    it('recovers from invalid JSON and normalises what it reads', async () => {
        rows.set(DESKTOP, '{oops');
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        expect(store.current.enabled).toBe(false);
        expect(store.loaded).toBe(true);

        setProfile(DESKTOP, { contextLines: 99, scrolling: 'wild' });
        await store.load();
        expect(store.current).toMatchObject({ contextLines: 10, scrolling: 'typewriter' });
    });

    it('recovers from a failing database read', async () => {
        repo.execute.mockRejectedValueOnce(new Error('locked'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        expect(store.loaded).toBe(true);
        expect(store.current.enabled).toBe(false);
        error.mockRestore();
    });

    it('reloads on user switch', async () => {
        setProfile(DESKTOP, { enabled: true });
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        expect(store.enabled).toBe(true);

        setProfile(DESKTOP, { enabled: false, dim: 'off' });
        auth.user = { id: 'user-B' };
        await flush();
        expect(store.current).toMatchObject({ enabled: false, dim: 'off' });
    });

    it('keeps a change made before the row was read', async () => {
        setProfile(PHONE, { anchorPercent: 33 });
        const store = useTypewriterStore();
        store.toggle();
        sync.isInitialized = true;
        await flush();
        expect(store.current.enabled).toBe(true);
        expect(store.profiles.phone.anchorPercent).toBe(33);
        vi.advanceTimersByTime(500);
        await flush();
        expect(savedProfile(DESKTOP).enabled).toBe(true);
    });

    it('picks up a synced change to the settings table, unless a save is waiting', async () => {
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        setProfile(DESKTOP, { enabled: true });
        await pulled(['settings']);
        await flush();
        expect(store.enabled).toBe(true);

        store.update({ dim: 'sentence' });
        setProfile(DESKTOP, { enabled: false });
        await pulled(['settings']);
        await flush();
        expect(store.current).toMatchObject({ enabled: true, dim: 'sentence' });
    });

    it('does not read its rows after a sync that changed no settings', async () => {
        sync.isInitialized = true;
        useTypewriterStore();
        await flush();
        const reads = repo.execute.mock.calls.length;
        await pulled(['notes', 'folders']);
        sync.isSyncing = true;
        await flush();
        sync.isSyncing = false;
        await flush();
        expect(repo.execute.mock.calls.length).toBe(reads);
    });

    it('keeps a phone change made before a desktop change synced (no lost write)', async () => {
        // The phone turned the mode on; the laptop has not seen that row yet.
        sync.isInitialized = true;
        const laptop = useTypewriterStore();
        await flush();
        setProfile(PHONE, { enabled: true });
        laptop.update({ dimStrength: 'strong' });
        vi.advanceTimersByTime(500);
        await flush();
        // The laptop wrote only its own row, so the phone's stays as the phone wrote it.
        expect(savedProfile(PHONE)).toMatchObject({ enabled: true });
        expect(savedProfile(DESKTOP)).toMatchObject({ dimStrength: 'strong' });
    });

    it('does not let a sync reload undo a save that is still being written', async () => {
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        let finishWrite;
        repo.exec.mockImplementationOnce((sql, params) => new Promise((resolve) => {
            finishWrite = () => { rows.set(params[0], params[1]); resolve(); };
        }));
        store.update({ dim: 'sentence' });
        vi.advanceTimersByTime(500);
        await flush();
        expect(finishWrite).toBeTypeOf('function');
        // A pulled settings change arrives while the write is still in flight.
        await pulled(['settings']);
        await flush();
        expect(store.current.dim).toBe('sentence');
        finishWrite();
        await flush();
        expect(savedProfile(DESKTOP).dim).toBe('sentence');
    });
});
