// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { h, reactive } from 'vue';

const route = reactive({ query: {} });
const router = { replace: vi.fn(async ({ query }) => { route.query = query; }) };
const ui = { addToast: vi.fn() };
const syncStore = reactive({ isOnline: true });

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ui }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => syncStore }));
const backupStore = { completeConnect: vi.fn() };
vi.mock('../store.js', () => ({ useGithubBackupStore: () => backupStore }));
vi.mock('../components/GitHubBackupModal.vue', () => ({
    default: { props: ['show'], render() { return this.show ? h('div', { 'data-testid': 'backup-modal' }) : null; } },
}));

const { default: GitHubSettingsCard } = await import('../components/GitHubSettingsCard.vue');
const { default: manifest } = await import('../manifest.js');

describe('the GitHub add-on in the app', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        route.query = {};
        router.replace.mockClear();
        ui.addToast.mockClear();
        syncStore.isOnline = true;
        backupStore.completeConnect.mockReset();
    });

    it('contributes a toolbar Backup action, its modal and a settings card', () => {
        expect(manifest.id).toBe('github');
        expect(manifest.actions).toEqual([
            expect.objectContaining({ id: 'backup', label: 'Backup', requires: ['online'], surfaces: ['toolbar'], modal: 'backup' }),
        ]);
        expect(typeof manifest.modals.backup).toBe('function');
        expect(typeof manifest.settingsCard.component).toBe('function');
    });

    it('opens the backup dialog from the card, desktop and phone', async () => {
        for (const layout of ['desktop', 'phone']) {
            const wrapper = mount(GitHubSettingsCard, { props: { layout } });
            expect(wrapper.find('[data-testid="backup-modal"]').exists()).toBe(false);
            await wrapper.get('[data-testid="github-settings-open"]').trigger('click');
            expect(wrapper.find('[data-testid="backup-modal"]').exists()).toBe(true);
        }
    });

    it('cannot be opened offline', () => {
        syncStore.isOnline = false;
        const wrapper = mount(GitHubSettingsCard, { props: { layout: 'phone' } });
        expect(wrapper.get('[data-testid="github-settings-open"]').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('needs a connection');
    });

    it('finishes a parked connection with this session, then opens the dialog and clears the query', async () => {
        backupStore.completeConnect.mockResolvedValue({ connected: true });
        route.query = { addon: 'github', addonResult: 'pending', handle: 'h-1', tab: 'keep' };
        const wrapper = mount(GitHubSettingsCard, { props: { layout: 'desktop' } });
        await flushPromises();
        expect(router.replace).toHaveBeenCalledWith({ query: { tab: 'keep' } });
        expect(backupStore.completeConnect).toHaveBeenCalledWith('h-1');
        expect(ui.addToast).toHaveBeenCalledWith('GitHub backup connected.', 'success');
        expect(wrapper.find('[data-testid="backup-modal"]').exists()).toBe(true);
    });

    it('says why a parked connection was refused', async () => {
        backupStore.completeConnect.mockRejectedValue(new Error('This GitHub connection was started from another Panino account, so it was not saved.'));
        route.query = { addon: 'github', addonResult: 'pending', handle: 'h-2' };
        mount(GitHubSettingsCard, { props: { layout: 'phone' } });
        await flushPromises();
        expect(ui.addToast).toHaveBeenCalledWith('This GitHub connection was started from another Panino account, so it was not saved.', 'error');
    });

    it('shows the error from a failed OAuth return', async () => {
        route.query = { addon: 'github', addonResult: 'error', addonMessage: 'GitHub access was not granted.' };
        mount(GitHubSettingsCard, { props: { layout: 'phone' } });
        await flushPromises();
        expect(backupStore.completeConnect).not.toHaveBeenCalled();
        expect(ui.addToast).toHaveBeenCalledWith('GitHub access was not granted.', 'error');
        expect(route.query).toEqual({});
    });

    it('leaves another add-on’s return alone', async () => {
        route.query = { addon: 'odoo', addonResult: 'error', addonMessage: 'x' };
        mount(GitHubSettingsCard, { props: { layout: 'desktop' } });
        await flushPromises();
        expect(ui.addToast).not.toHaveBeenCalled();
        expect(router.replace).not.toHaveBeenCalled();
    });

    it('does nothing on a plain visit to Settings', async () => {
        mount(GitHubSettingsCard, { props: { layout: 'desktop' } });
        await flushPromises();
        expect(ui.addToast).not.toHaveBeenCalled();
        expect(router.replace).not.toHaveBeenCalled();
    });

    it('uses Document in its copy', () => {
        const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
        expect(source('../utils/backupProgress.js')).toContain('Exporting documents and assets');
        const modal = source('../components/GitHubBackupModal.vue');
        expect(modal).toContain('includes only your personal Documents');
        expect(modal).toContain('Shared spaces are excluded');
    });
});
