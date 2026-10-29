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

    it('finishes a connection from the OAuth return: opens the dialog, says so, clears the query', async () => {
        route.query = { githubBackup: 'connected', tab: 'keep' };
        const wrapper = mount(GitHubSettingsCard, { props: { layout: 'desktop' } });
        await flushPromises();
        expect(wrapper.find('[data-testid="backup-modal"]').exists()).toBe(true);
        expect(ui.addToast).toHaveBeenCalledWith('GitHub backup connected.', 'success');
        expect(router.replace).toHaveBeenCalledWith({ query: { tab: 'keep' } });
    });

    it('shows the error from a failed OAuth return', async () => {
        route.query = { githubBackup: 'error', message: 'access_denied' };
        mount(GitHubSettingsCard, { props: { layout: 'phone' } });
        await flushPromises();
        expect(ui.addToast).toHaveBeenCalledWith('access_denied', 'error');
        expect(route.query).toEqual({});
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
