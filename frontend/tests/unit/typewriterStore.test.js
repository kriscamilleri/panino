// @vitest-environment jsdom
// typewriterStore keeps typewriter mode's settings in their own synced
// `settings` row (docs/specs/active/typewriter-mode.md §9.3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, reactive, ref } from 'vue';

const rows = new Map();
const repo = {
    execute: vi.fn(async (sql, params) => {
        const value = rows.get(params?.[0]);
        return value === undefined ? [] : [{ value }];
    }),
    exec: vi.fn(async (sql, params) => { rows.set(params[0], params[1]); }),
};
const sync = reactive({ isInitialized: false, isSyncing: false, personalRepository: () => repo });
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
        rows.set('typewriter', JSON.stringify({ version: 1, desktop: { enabled: true, dim: 'sentence' } }));
        const store = useTypewriterStore();
        await flush();
        expect(repo.execute).not.toHaveBeenCalled();
        expect(store.current.enabled).toBe(false);

        sync.isInitialized = true;
        await flush();
        expect(repo.execute).toHaveBeenCalledWith(expect.stringContaining('FROM settings'), ['typewriter']);
        expect(store.loaded).toBe(true);
        expect(store.current).toMatchObject({ enabled: true, dim: 'sentence', contextLines: 3 });
    });

    it('serves the profile of the form factor', async () => {
        rows.set('typewriter', JSON.stringify({ desktop: { enabled: true }, phone: { enabled: false, anchorPercent: 33 } }));
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        expect(store.formFactor).toBe('desktop');
        expect(store.enabled).toBe(true);
        isPhone.value = true;
        expect(store.formFactor).toBe('phone');
        expect(store.current).toMatchObject({ enabled: false, anchorPercent: 33, contextLines: 2 });
    });

    it('saves the typewriter row through a 500 ms debounce', async () => {
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
        expect(params[0]).toBe('typewriter');
        const saved = JSON.parse(params[1]);
        expect(saved.version).toBe(1);
        expect(saved.desktop).toMatchObject({ dimStrength: 'strong', contextLines: 5 });
    });

    it('keeps the other form factor untouched', async () => {
        rows.set('typewriter', JSON.stringify({ desktop: { anchorPercent: 67 }, phone: { anchorPercent: 33, dim: 'off' } }));
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        expect(store.toggle()).toBe(true);
        vi.advanceTimersByTime(500);
        await flush();
        const saved = JSON.parse(rows.get('typewriter'));
        expect(saved.desktop).toMatchObject({ enabled: true, anchorPercent: 67 });
        expect(saved.phone).toMatchObject({ enabled: false, anchorPercent: 33, dim: 'off' });

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
        for (const [, params] of repo.exec.mock.calls) expect(params[0]).toBe('typewriter');
    });

    it('recovers from invalid JSON and normalises what it reads', async () => {
        rows.set('typewriter', '{oops');
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        expect(store.current.enabled).toBe(false);
        expect(store.loaded).toBe(true);

        rows.set('typewriter', JSON.stringify({ desktop: { contextLines: 99, scrolling: 'wild' } }));
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
        rows.set('typewriter', JSON.stringify({ desktop: { enabled: true } }));
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        expect(store.enabled).toBe(true);

        rows.set('typewriter', JSON.stringify({ desktop: { enabled: false, dim: 'off' } }));
        auth.user = { id: 'user-B' };
        await flush();
        expect(store.current).toMatchObject({ enabled: false, dim: 'off' });
    });

    it('keeps a change made before the row was read', async () => {
        rows.set('typewriter', JSON.stringify({ phone: { anchorPercent: 33 } }));
        const store = useTypewriterStore();
        store.toggle();
        sync.isInitialized = true;
        await flush();
        expect(store.current.enabled).toBe(true);
        expect(store.profiles.phone.anchorPercent).toBe(33);
        vi.advanceTimersByTime(500);
        await flush();
        expect(JSON.parse(rows.get('typewriter')).desktop.enabled).toBe(true);
    });

    it('picks up a synced change after a sync round, unless a save is waiting', async () => {
        sync.isInitialized = true;
        const store = useTypewriterStore();
        await flush();
        rows.set('typewriter', JSON.stringify({ desktop: { enabled: true } }));
        sync.isSyncing = true;
        await flush();
        sync.isSyncing = false;
        await flush();
        expect(store.enabled).toBe(true);

        store.update({ dim: 'sentence' });
        rows.set('typewriter', JSON.stringify({ desktop: { enabled: false } }));
        sync.isSyncing = true;
        await flush();
        sync.isSyncing = false;
        await flush();
        expect(store.current).toMatchObject({ enabled: true, dim: 'sentence' });
    });
});
