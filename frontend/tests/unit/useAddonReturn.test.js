// @vitest-environment jsdom
// The add-on return on Settings (docs/specs/active/addon-folders.md §6.2), with no real add-on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, reactive } from 'vue';

const route = reactive({ query: {} });
const router = { replace: vi.fn(async ({ query }) => { route.query = query; }) };
const ui = { addToast: vi.fn() };
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ui }));
vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt' }) }));
vi.mock('@/addons/registry', () => ({ ADDON_MANIFESTS: [], addonManifest: () => null, addonsContributing: () => [] }));

const { useAddonReturn, withoutAddonReturn } = await import('@/composables/useAddonReturn');
const { useAddonsStore } = await import('@/store/addonsStore');

const Host = defineComponent({ setup() { useAddonReturn(); return () => null; } });

describe('useAddonReturn', () => {
    let mounted = [];
    const mountHost = () => { const wrapper = mount(Host); mounted.push(wrapper); return wrapper; };
    afterEach(() => { mounted.forEach((wrapper) => wrapper.unmount()); mounted = []; });

    beforeEach(() => {
        setActivePinia(createPinia());
        route.query = {};
        router.replace.mockClear();
        ui.addToast.mockClear();
    });

    function serverSays(enabled) {
        const store = useAddonsStore();
        store.addons = [{ id: 'probe', name: 'Probe', description: '', enabled, enabledAt: null }];
        store.isLoaded = true;
    }

    it('shows the message and clears the query when the add-on is off', async () => {
        serverSays(false);
        route.query = { addon: 'probe', addonResult: 'error', addonMessage: 'Turn on Probe first.', tab: 'keep' };
        mountHost();
        await flushPromises();
        expect(ui.addToast).toHaveBeenCalledWith('Turn on Probe first.', 'error');
        expect(route.query).toEqual({ tab: 'keep' });
    });

    it('leaves the return to the add-on’s card while the add-on is on', async () => {
        serverSays(true);
        route.query = { addon: 'probe', addonResult: 'pending', handle: 'h' };
        mountHost();
        await flushPromises();
        expect(ui.addToast).not.toHaveBeenCalled();
        expect(router.replace).not.toHaveBeenCalled();
    });

    it('waits for the add-ons to load before deciding', async () => {
        route.query = { addon: 'probe', addonResult: 'error', addonMessage: 'Later.' };
        mountHost();
        await flushPromises();
        expect(ui.addToast).not.toHaveBeenCalled();
        serverSays(false);
        await flushPromises();
        expect(ui.addToast).toHaveBeenCalledWith('Later.', 'error');
    });

    it('drops only the return keys', () => {
        expect(withoutAddonReturn({ addon: 'a', addonResult: 'b', addonMessage: 'c', handle: 'd', dbKey: 'user:x' })).toEqual({ dbKey: 'user:x' });
    });
});
