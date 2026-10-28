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
const buildArticle = vi.fn(async () => '<h1>Quote</h1><p>Hi</p>');
vi.mock('@/composables/useDocumentArticle', () => ({ useDocumentArticle: () => ({ buildForSelected: buildArticle }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const { default: OdooSendModal } = await import('@/components/OdooSendModal.vue');

const CONNECTED = { connected: true, baseUrl: 'https://acme.odoo.com', odooUserName: 'Mitchell Admin', apps: ['documents', 'knowledge', 'crm', 'sales'] };
const FOLDERS = { folders: [{ id: 2, name: 'Inbox', parentName: null }, { id: 41, name: 'Sales', parentName: 'Finance' }] };
const RECORDS = { records: [
    { resModel: 'crm.lead', resId: 1, name: 'Club Office Furnitures', partnerName: 'Azure Interior', status: 'Qualified', sent: false },
    { resModel: 'sale.order', resId: 7, name: 'S00007', partnerName: 'Deco Addict', status: 'Quotation', sent: false },
] };
const PDF_REQUEST = { htmlContent: '<h1>Quote</h1>', cssStyles: '', printStyles: {} };
const ARTICLES = { articles: [{ id: 10, name: 'Company handbook', parentName: null }, { id: 11, name: 'Sales playbook', parentName: 'Company handbook' }] };

/** fetch answering by path; `send` is the response to POST /send. */
function api({ status = CONNECTED, links = { links: [], defaults: { folderId: null } }, records = RECORDS, send } = {}) {
    const calls = [];
    const fetch = vi.fn((url, options = {}) => {
        const path = new URL(url, 'http://x').pathname;
        calls.push({ path, url, options });
        const body = path === '/addons/odoo' ? status
            : path === '/addons/odoo/links' ? links
                : path === '/addons/odoo/folders' ? FOLDERS
                    : path === '/addons/odoo/articles' ? ARTICLES
                    : path === '/addons/odoo/records' ? records
                        : path === '/addons/odoo/send' ? send
                            : null;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });
    vi.stubGlobal('fetch', fetch);
    return calls;
}

const ModalStub = { props: ['show', 'title'], template: '<div v-if="show"><slot /><slot name="footer" /></div>' };
const mountModal = () => mount(OdooSendModal, { props: { show: true }, global: { stubs: { BaseModal: ModalStub } } });
const sentBody = (calls) => JSON.parse(calls.find((c) => c.path === '/addons/odoo/send').options.body);

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
        buildArticle.mockClear();
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

    it('explains when this Odoo has nowhere to send a PDF', async () => {
        api({ status: { ...CONNECTED, apps: [] } });
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-no-destination"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="odoo-send-submit"]').exists()).toBe(false);
    });

    it('offers only the chatter when there is no Documents app', async () => {
        api({ status: { ...CONNECTED, apps: ['crm'] } });
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-documents"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="odoo-send-chatter"]').text()).toContain('PDF to an opportunity');
        expect(wrapper.find('[data-testid="odoo-send-chatter"]').text()).not.toContain('sales order');
        expect(wrapper.find('[data-testid="odoo-send-submit"]').attributes('disabled')).toBeDefined();
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

        expect(sentBody(calls)).toEqual({
            dbKey: 'user:me', noteId: 'note-1', title: 'Quote', pdfRequest: PDF_REQUEST, documents: { folderId: 41 },
        });
        expect(wrapper.find('[data-testid="odoo-send-result"]').text()).toContain('Sent to Odoo Documents.');
        const open = wrapper.find('[data-testid="odoo-send-open"]');
        expect(open.attributes()).toMatchObject({ href: 'https://acme.odoo.com/odoo/documents/tok1', target: '_blank', rel: 'noopener noreferrer' });
        expect(wrapper.find('[data-testid="odoo-send-chatter-result"]').exists()).toBe(false);
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
            links: { links: [{ destination: 'documents', targetKey: '', sameOdoo: true, url: 'https://acme.odoo.com/odoo/documents/tok1', lastSentAt: new Date(Date.now() - 3 * 86400000).toISOString(), lastSentBy: 'Kris' }], defaults: {} },
            send: { documents: { ok: true, created: false, url: 'https://acme.odoo.com/odoo/documents/tok1' } },
        });
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-last-sent"]').text()).toMatch(/Sent 3 days ago by Kris/);
        expect(wrapper.find('[data-testid="odoo-folder-list"]').exists()).toBe(false);
        expect(calls.some((c) => c.path === '/addons/odoo/folders')).toBe(false);
        expect(wrapper.find('[data-testid="odoo-send-submit"]').text()).toBe('Update in Odoo');

        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();
        expect(sentBody(calls).documents).toEqual({});
        expect(wrapper.find('[data-testid="odoo-send-result"]').text()).toContain('Updated in Odoo Documents.');
    });

    it('ignores a link to a different Odoo', async () => {
        api({ links: { links: [{ destination: 'documents', targetKey: '', sameOdoo: false, lastSentAt: new Date().toISOString() }], defaults: {} } });
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

    it('posts the PDF on a chosen opportunity as an internal note', async () => {
        const calls = api({ send: { chatter: { ok: true, created: true, recreated: false, noteMissing: false, url: 'https://acme.odoo.com/odoo/crm.lead/1' } } });
        const wrapper = mountModal();
        await flushPromises();
        // The picker is not fetched until the destination is ticked.
        expect(calls.some((c) => c.path === '/addons/odoo/records')).toBe(false);
        expect(wrapper.find('[data-testid="odoo-send-chatter"]').text()).toContain('PDF to an opportunity or sales order');

        await wrapper.find('[data-testid="odoo-send-documents-toggle"]').setValue(false);
        await wrapper.find('[data-testid="odoo-send-chatter-toggle"]').setValue(true);
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-chatter"]').text()).toContain("Posted as an internal note. The customer isn't emailed.");
        const picker = calls.find((c) => c.path === '/addons/odoo/records');
        expect(new URL(picker.url).searchParams.get('noteId')).toBe('note-1');
        expect(wrapper.find('[data-testid="odoo-send-submit"]').attributes('disabled')).toBeDefined();

        const option = wrapper.find('[data-testid="odoo-record-crm.lead-1"]');
        expect(option.text()).toContain('Club Office Furnitures');
        expect(option.text()).toContain('Azure Interior · Qualified');
        await option.trigger('click');
        expect(wrapper.find('[data-testid="odoo-send-submit"]').text()).toBe('Send');
        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();

        const body = sentBody(calls);
        expect(body.documents).toBeUndefined();
        expect(body.chatter).toEqual({ resModel: 'crm.lead', resId: 1 });
        expect(wrapper.find('[data-testid="odoo-send-chatter-result"]').text()).toContain('Posted as an internal note.');
        expect(wrapper.find('[data-testid="odoo-send-chatter-open"]').attributes('href')).toBe('https://acme.odoo.com/odoo/crm.lead/1');
    });

    it('lists the records already sent to first, and updates there', async () => {
        const lastSentAt = new Date(Date.now() - 2 * 3600000).toISOString();
        const calls = api({
            links: { links: [{ destination: 'chatter', targetKey: 'sale.order:7', sameOdoo: true, url: 'https://acme.odoo.com/odoo/sale.order/7', lastSentAt, lastSentBy: 'Kris' }], defaults: {} },
            records: { records: [{ ...RECORDS.records[1], sent: true }, RECORDS.records[0]] },
            send: { chatter: { ok: true, created: false, recreated: false, noteMissing: true, url: 'https://acme.odoo.com/odoo/sale.order/7' } },
        });
        const wrapper = mountModal();
        await flushPromises();
        await wrapper.find('[data-testid="odoo-send-documents-toggle"]').setValue(false);
        await wrapper.find('[data-testid="odoo-send-chatter-toggle"]').setValue(true);
        await flushPromises();

        const options = wrapper.findAll('[data-testid="odoo-record-list"] [role="option"]');
        expect(options[0].text()).toContain('S00007');
        expect(wrapper.find('[data-testid="odoo-record-sent-sale.order-7"]').text()).toBe('· Sent 2 hours ago by Kris');
        await wrapper.find('[data-testid="odoo-record-sale.order-7"]').trigger('click');
        expect(wrapper.find('[data-testid="odoo-send-chatter-last-sent"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="odoo-send-submit"]').text()).toBe('Update in Odoo');

        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();
        expect(sentBody(calls).chatter).toEqual({ resModel: 'sale.order', resId: 7 });
        expect(wrapper.find('[data-testid="odoo-send-chatter-result"]').text()).toContain('The PDF was replaced, but the note saying so could not be posted.');
    });

    it('sends to both destinations and reports each on its own', async () => {
        const calls = api({
            links: { links: [], defaults: { folderId: 2 } },
            send: {
                documents: { ok: false, error: 'access_denied', message: "Your Odoo user can't create or update this document in Odoo Documents." },
                chatter: { ok: true, created: true, url: 'https://acme.odoo.com/odoo/crm.lead/1' },
            },
        });
        const wrapper = mountModal();
        await flushPromises();
        await wrapper.find('[data-testid="odoo-send-chatter-toggle"]').setValue(true);
        await flushPromises();
        await wrapper.find('[data-testid="odoo-record-crm.lead-1"]').trigger('click');
        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();

        expect(sentBody(calls)).toMatchObject({ documents: { folderId: 2 }, chatter: { resModel: 'crm.lead', resId: 1 } });
        expect(wrapper.find('[data-testid="odoo-send-result"]').classes()).toContain('pn-alert-error');
        expect(wrapper.find('[data-testid="odoo-send-chatter-result"]').classes()).toContain('pn-alert-success');
        // Not everything went through, so the footer still offers Cancel, not Done.
        expect(wrapper.text()).toContain('Cancel');
    });

    it('sends an article to Knowledge under a chosen parent, without building a PDF', async () => {
        const calls = api({ send: { knowledge: { ok: true, created: true, url: 'https://acme.odoo.com/knowledge/article/120' } } });
        const wrapper = mountModal();
        await flushPromises();
        expect(calls.some((c) => c.path === '/addons/odoo/articles')).toBe(false);
        await wrapper.find('[data-testid="odoo-send-documents-toggle"]').setValue(false);
        await wrapper.find('[data-testid="odoo-send-knowledge-toggle"]').setValue(true);
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-knowledge"]').text()).toContain('Images are uploaded into the article.');
        expect(wrapper.find('[data-testid="odoo-send-submit"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-testid="odoo-article-top"]').text()).toBe('Top level');
        expect(wrapper.find('[data-testid="odoo-article-11"]').text()).toBe('Company handbook / Sales playbook');

        await wrapper.find('[data-testid="odoo-article-11"]').trigger('click');
        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();

        expect(buildForSelected).not.toHaveBeenCalled();
        expect(buildArticle).toHaveBeenCalledTimes(1);
        expect(sentBody(calls)).toEqual({ dbKey: 'user:me', noteId: 'note-1', title: 'Quote', knowledge: { parentId: 11, html: '<h1>Quote</h1><p>Hi</p>' } });
        expect(wrapper.find('[data-testid="odoo-send-knowledge-result"]').text()).toContain('Sent to Odoo Knowledge.');
        expect(wrapper.find('[data-testid="odoo-send-knowledge-open"]').attributes('href')).toBe('https://acme.odoo.com/knowledge/article/120');
    });

    it('puts an article at the top level, and preselects the remembered parent next time', async () => {
        const calls = api({ links: { links: [], defaults: { folderId: null, parentArticleId: 0 } }, send: { knowledge: { ok: true, created: true } } });
        const wrapper = mountModal();
        await flushPromises();
        await wrapper.find('[data-testid="odoo-send-documents-toggle"]').setValue(false);
        await wrapper.find('[data-testid="odoo-send-knowledge-toggle"]').setValue(true);
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-article-top"]').classes()).toContain('font-medium');
        expect(wrapper.find('[data-testid="odoo-send-submit"]').attributes('disabled')).toBeUndefined();
        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();
        expect(sentBody(calls).knowledge).toEqual({ parentId: 0, html: '<h1>Quote</h1><p>Hi</p>' });
    });

    it('updates an article sent before, without asking where it goes', async () => {
        const calls = api({
            links: { links: [{ destination: 'knowledge', targetKey: '', sameOdoo: true, url: 'https://acme.odoo.com/knowledge/article/120', lastSentAt: new Date(Date.now() - 60000).toISOString(), lastSentBy: 'Kris' }], defaults: {} },
            send: { knowledge: { ok: true, created: false, url: 'https://acme.odoo.com/knowledge/article/120' } },
        });
        const wrapper = mountModal();
        await flushPromises();
        await wrapper.find('[data-testid="odoo-send-documents-toggle"]').setValue(false);
        await wrapper.find('[data-testid="odoo-send-knowledge-toggle"]').setValue(true);
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-knowledge-last-sent"]').text()).toMatch(/Sent 1 minute ago by Kris/);
        expect(wrapper.find('[data-testid="odoo-article-list"]').exists()).toBe(false);
        expect(calls.some((c) => c.path === '/addons/odoo/articles')).toBe(false);
        expect(wrapper.find('[data-testid="odoo-send-submit"]').text()).toBe('Update in Odoo');
        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();
        expect(sentBody(calls).knowledge).toEqual({ html: '<h1>Quote</h1><p>Hi</p>' });
        expect(wrapper.find('[data-testid="odoo-send-knowledge-result"]').text()).toContain('Updated in Odoo Knowledge.');
    });

    it('keeps a Document in sync instead of sending it once', async () => {
        const calls = api({ links: { links: [], defaults: { folderId: null, parentArticleId: 10 } } });
        vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
            const path = new URL(url, 'http://x').pathname;
            calls.push({ path, url, options });
            if (path === '/addons/odoo/syncs' && options.method === 'POST') {
                return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ sync: { id: 's1', scope: 'note', status: 'active', lastRunAt: null } }) });
            }
            const body = path === '/addons/odoo' ? CONNECTED
                : path === '/addons/odoo/links' ? { links: [], defaults: { folderId: null, parentArticleId: 10 } }
                    : path === '/addons/odoo/articles' ? ARTICLES
                        : null;
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
        }));
        const wrapper = mountModal();
        await flushPromises();
        await wrapper.find('[data-testid="odoo-send-documents-toggle"]').setValue(false);
        await wrapper.find('[data-testid="odoo-send-knowledge-toggle"]').setValue(true);
        await flushPromises();
        await wrapper.find('[data-testid="odoo-send-keep-in-sync"]').setValue(true);
        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();

        expect(calls.some((c) => c.path === '/addons/odoo/send')).toBe(false);
        const created = calls.find((c) => c.path === '/addons/odoo/syncs' && c.options.method === 'POST');
        expect(JSON.parse(created.options.body)).toEqual({ dbKey: 'user:me', scope: 'note', sourceId: 'note-1', parentArticleId: 10 });
        expect(buildArticle).not.toHaveBeenCalled();
        expect(wrapper.find('[data-testid="odoo-send-knowledge-result"]').text()).toContain('Kept in sync with Odoo Knowledge from now on.');
        expect(wrapper.find('[data-testid="odoo-send-knowledge-synced"]').text()).toContain('Kept in sync on its own, first sync on its way.');
        expect(wrapper.find('[data-testid="odoo-send-knowledge-toggle"]').attributes('disabled')).toBeDefined();
    });

    it('shows a synced Document as such and will not send it by hand', async () => {
        const calls = api({
            links: {
                links: [{ destination: 'knowledge', targetKey: '', sameOdoo: true, url: 'https://acme.odoo.com/knowledge/article/5', lastSentAt: new Date().toISOString(), lastSentBy: 'Kris', syncId: 's1' }],
                defaults: {},
                sync: { id: 's1', scope: 'folder', sourceName: 'Docs', status: 'active', lastRunAt: new Date(Date.now() - 120000).toISOString() },
            },
            send: { documents: { ok: true, created: true } },
        });
        const wrapper = mountModal();
        await flushPromises();
        const synced = wrapper.find('[data-testid="odoo-send-knowledge-synced"]');
        expect(synced.text()).toContain('Kept in sync with the folder "Docs", last synced 2 minutes ago.');
        expect(synced.find('a').attributes('href')).toBe('https://acme.odoo.com/knowledge/article/5');
        expect(wrapper.find('[data-testid="odoo-send-knowledge-toggle"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('[data-testid="odoo-send-knowledge"]').text()).toContain('Synced to Knowledge');

        await wrapper.find('[data-testid="odoo-folder-41"]').trigger('click');
        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();
        expect(sentBody(calls).knowledge).toBeUndefined();
        expect(sentBody(calls).documents).toEqual({ folderId: 41 });
    });

    it('says when images could not be sent', async () => {
        api({ links: { links: [], defaults: { folderId: null, parentArticleId: 0 } }, send: { knowledge: { ok: true, created: true, imagesUploaded: 1, imagesMissing: 2 } } });
        const wrapper = mountModal();
        await flushPromises();
        await wrapper.find('[data-testid="odoo-send-documents-toggle"]').setValue(false);
        await wrapper.find('[data-testid="odoo-send-knowledge-toggle"]').setValue(true);
        await flushPromises();
        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-knowledge-result"]').text()).toBe('Sent to Odoo Knowledge. 2 images could not be sent and show as "Image not sent".');
    });

    it('warns about the key and points to Settings when Odoo rejects it', async () => {
        const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
        api({ status: { ...CONNECTED, keyExpiresOn: inDays(2) }, links: { links: [], defaults: { folderId: 2 } }, send: { documents: { ok: false, error: 'key_rejected', message: 'Odoo rejected the API key.' } } });
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-key-notice"]').text()).toMatch(/expires in 2 days/);
        expect(wrapper.find('[data-testid="odoo-send-key-rejected"]').exists()).toBe(false);

        await wrapper.find('[data-testid="odoo-send-submit"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-send-result"]').text()).toBe('Odoo rejected the API key.');
        expect(wrapper.find('[data-testid="odoo-send-key-rejected"]').exists()).toBe(true);
        await wrapper.find('[data-testid="odoo-send-key-rejected-settings"]').trigger('click');
        expect(push).toHaveBeenCalledWith('/settings');
        expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('cannot send with nothing ticked', async () => {
        api();
        const wrapper = mountModal();
        await flushPromises();
        await wrapper.find('[data-testid="odoo-folder-41"]').trigger('click');
        expect(wrapper.find('[data-testid="odoo-send-submit"]').attributes('disabled')).toBeUndefined();
        await wrapper.find('[data-testid="odoo-send-documents-toggle"]').setValue(false);
        expect(wrapper.find('[data-testid="odoo-send-submit"]').attributes('disabled')).toBeDefined();
    });
});
