// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import { sentAgo } from '@/utils/odooConnection';

const doc = reactive({ selectedFile: { id: 'note-1', dbKey: 'user:me', title: 'Quote', content: '# Quote' } });
const buildForSelected = vi.fn(async () => ({ htmlContent: '<h1>Quote</h1>', cssStyles: '', printStyles: {} }));
const push = vi.fn();

vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt' }) }));
vi.mock('@/store/docStore', async () => {
    const { defineStore } = await import('pinia');
    return { useDocStore: defineStore('doc', { state: () => doc }) };
});
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => ({ isOnline: true }) }));
vi.mock('@/composables/useDocumentPdfRequest', () => ({ useDocumentPdfRequest: () => ({ buildForSelected }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const { default: OdooSendModal } = await import('@/components/OdooSendModal.vue');

const CONNECTED = { connected: true, baseUrl: 'https://acme.odoo.com', odooUserName: 'Mitchell Admin', apps: ['documents', 'crm'] };
const FOLDERS = { folders: [{ id: 2, name: 'Inbox', parentName: null }, { id: 41, name: 'Sales', parentName: 'Finance' }] };

/** fetch answering by path; `send` is the response to POST /send. */
function api({ status = CONNECTED, links = { links: [], defaults: { folderId: null } }, send } = {}) {
    const calls = [];
    const fetch = vi.fn((url, options = {}) => {
        const path = new URL(url, 'http://x').pathname;
        calls.push({ path, url, options });
        const body = path === '/integrations/odoo' ? status
            : path === '/integrations/odoo/links' ? links
                : path === '/integrations/odoo/folders' ? FOLDERS
                    : path === '/integrations/odoo/send' ? send
                        : null;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });
    vi.stubGlobal('fetch', fetch);
    return calls;
}

const ModalStub = { props: ['show', 'title'], template: '<div v-if="show"><slot /><slot name="footer" /></div>' };
const mountModal = () => mount(OdooSendModal, { props: { show: true }, global: { stubs: { BaseModal: ModalStub } } });

describe('sentAgo', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    it('says how long ago, in words', () => {
        expect(sentAgo('2026-10-27T11:59:30Z', now)).toBe('just now');
        expect(sentAgo('2026-10-27T11:59:00Z', now)).toBe('1 minute ago');
        expect(sentAgo('2026-10-27T07:00:00Z', now)).toBe('5 hours ago');
        expect(sentAgo('2026-10-24T12:00:00Z', now)).toBe('3 days ago');
        expect(sentAgo('2026-01-02T12:00:00Z', now)).toBe('on 2026-01-02');
        expect(sentAgo('nonsense', now)).toBe('');
    });
});

describe('OdooSendModal', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        buildForSelected.mockClear();
        push.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends people to Settings when Odoo is not connected', async () => {
        api({ status: { connected: false } });
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-not-connected"]').exists()).toBe(true);
        await wrapper.find('[data-testid="odoo-send-open-settings"]').trigger('click');
        expect(push).toHaveBeenCalledWith('/settings');
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('explains when this Odoo has no Documents app', async () => {
        api({ status: { ...CONNECTED, apps: ['crm'] } });
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-no-documents"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="odoo-send-submit"]').exists()).toBe(false);
    });

    it('sends a first PDF to the chosen folder', async () => {
        const calls = api({ send: { documents: { ok: true, created: true, url: 'https://acme.odoo.com/odoo/documents/tok1' } } });
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-target"]').text()).toBe('To acme.odoo.com as Mitchell Admin');
        expect(wrapper.find('[data-testid="odoo-send-submit"]').attributes('disabled')).toBeDefined();

        await wrapper.find('[data-testid="odoo-folder-41"]').trigger('click');
        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();

        const sent = calls.find((c) => c.path === '/integrations/odoo/send');
        expect(JSON.parse(sent.options.body)).toEqual({
            dbKey: 'user:me', noteId: 'note-1', title: 'Quote',
            pdfRequest: { htmlContent: '<h1>Quote</h1>', cssStyles: '', printStyles: {} },
            documents: { folderId: 41 },
        });
        expect(wrapper.find('[data-testid="odoo-send-result"]').text()).toContain('Sent to Odoo Documents.');
        const open = wrapper.find('[data-testid="odoo-send-open"]');
        expect(open.attributes()).toMatchObject({ href: 'https://acme.odoo.com/odoo/documents/tok1', target: '_blank', rel: 'noopener noreferrer' });
    });

    it('preselects the remembered folder', async () => {
        api({ links: { links: [], defaults: { folderId: 41 } } });
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-folder-41"]').classes()).toContain('font-medium');
        expect(wrapper.find('[data-testid="odoo-send-submit"]').attributes('disabled')).toBeUndefined();
    });

    it('updates what was sent before, without asking for a folder', async () => {
        const calls = api({
            links: { links: [{ destination: 'documents', sameOdoo: true, url: 'https://acme.odoo.com/odoo/documents/tok1', lastSentAt: new Date(Date.now() - 3 * 86400000).toISOString(), lastSentBy: 'Kris' }], defaults: {} },
            send: { documents: { ok: true, created: false, url: 'https://acme.odoo.com/odoo/documents/tok1' } },
        });
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-last-sent"]').text()).toMatch(/Sent 3 days ago by Kris/);
        expect(wrapper.find('[data-testid="odoo-folder-list"]').exists()).toBe(false);
        expect(calls.some((c) => c.path === '/integrations/odoo/folders')).toBe(false);
        expect(wrapper.find('[data-testid="odoo-send-submit"]').text()).toBe('Update in Odoo');

        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();
        expect(JSON.parse(calls.find((c) => c.path === '/integrations/odoo/send').options.body).documents).toEqual({});
        expect(wrapper.find('[data-testid="odoo-send-result"]').text()).toContain('Updated in Odoo Documents.');
    });

    it('ignores a link to a different Odoo', async () => {
        api({ links: { links: [{ destination: 'documents', sameOdoo: false, lastSentAt: new Date().toISOString() }], defaults: {} } });
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-last-sent"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="odoo-folder-list"]').exists()).toBe(true);
    });

    it('shows Odoo’s refusal in plain words', async () => {
        api({ links: { links: [], defaults: { folderId: 2 } }, send: { documents: { ok: false, error: 'access_denied', message: "Your Odoo user can't create or update this document in Odoo Documents." } } });
        const wrapper = mountModal();
        await flushPromises();
        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-result"]').text()).toBe("Your Odoo user can't create or update this document in Odoo Documents.");
    });
});
