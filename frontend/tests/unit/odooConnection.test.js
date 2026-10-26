// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { appLabels, keyExpiryMessage, keyExpiryState, odooHost } from '@/utils/odooConnection';

vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt-token' }) }));

const { useOdooStore } = await import('@/store/odooStore');
const { default: OdooConnectionModal } = await import('@/components/OdooConnectionModal.vue');

const TODAY = new Date(2026, 9, 26);
const KEY = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678';

describe('keyExpiryState', () => {
    it('counts whole days to the expiry date', () => {
        expect(keyExpiryState('2027-01-24', TODAY)).toEqual({ state: 'ok', daysLeft: 90 });
        expect(keyExpiryState('2026-11-09', TODAY)).toEqual({ state: 'soon', daysLeft: 14 });
        expect(keyExpiryState('2026-10-26', TODAY)).toEqual({ state: 'soon', daysLeft: 0 });
        expect(keyExpiryState('2026-10-25', TODAY)).toEqual({ state: 'expired', daysLeft: -1 });
        expect(keyExpiryState(null, TODAY)).toEqual({ state: 'unknown', daysLeft: null });
        expect(keyExpiryState('26/10/2026', TODAY)).toEqual({ state: 'unknown', daysLeft: null });
    });

    it('says something only when it matters', () => {
        expect(keyExpiryMessage('2027-01-24', TODAY)).toBe('');
        expect(keyExpiryMessage('2026-10-27', TODAY)).toBe('The API key expires in 1 day, on 2026-10-27.');
        expect(keyExpiryMessage('2026-11-05', TODAY)).toBe('The API key expires in 10 days, on 2026-11-05.');
        expect(keyExpiryMessage('2026-10-26', TODAY)).toMatch(/expires today/);
        expect(keyExpiryMessage('2026-10-01', TODAY)).toMatch(/expired on 2026-10-01/);
    });
});

describe('appLabels and odooHost', () => {
    it('names apps in a fixed order and ignores unknown ones', () => {
        expect(appLabels(['sales', 'crm', 'knowledge', 'other'])).toEqual(['Knowledge', 'CRM', 'Sales']);
        expect(appLabels(undefined)).toEqual([]);
    });

    it('shows the host without the scheme', () => {
        expect(odooHost('https://acme.odoo.com')).toBe('acme.odoo.com');
        expect(odooHost('http://odoo:8069')).toBe('odoo:8069');
    });
});

function respond(status, body) {
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

const CONNECTED = {
    connected: true,
    baseUrl: 'https://acme.odoo.com',
    databaseName: 'acme',
    keyExpiresOn: '2099-01-01',
    odooUserName: 'Mitchell Admin',
    odooVersion: '20.0+e',
    apps: ['documents', 'knowledge', 'crm', 'sales'],
    lastVerifiedAt: '2026-10-26T10:00:00.000Z',
    lastError: null,
    lastErrorMessage: null,
};

describe('odooStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('treats a 404 as the integration being off', async () => {
        vi.stubGlobal('fetch', vi.fn(() => respond(404, { error: 'Not found' })));
        const store = useOdooStore();
        await store.fetchStatus();
        expect(store.available).toBe(false);
        expect(store.error).toBe('');
    });

    it('sends the connection with the session token and keeps the server message on failure', async () => {
        const fetch = vi.fn()
            .mockImplementationOnce(() => respond(400, { error: 'key_rejected', message: 'Odoo rejected the API key.' }))
            .mockImplementationOnce(() => respond(200, CONNECTED));
        vi.stubGlobal('fetch', fetch);
        const store = useOdooStore();
        const input = { baseUrl: 'https://acme.odoo.com', databaseName: 'acme', apiKey: KEY, keyExpiresOn: '' };

        expect(await store.connect(input)).toBe(false);
        expect(store.error).toBe('Odoo rejected the API key.');
        const [url, options] = fetch.mock.calls[0];
        expect(url).toMatch(/\/integrations\/odoo$/);
        expect(options.method).toBe('PUT');
        expect(options.headers.Authorization).toBe('Bearer jwt-token');
        expect(JSON.parse(options.body)).toEqual(input);

        expect(await store.connect(input)).toBe(true);
        expect(store.isConnected).toBe(true);
        expect(store.error).toBe('');
    });

    it('disconnects', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 204, json: () => Promise.reject(new Error('no body')) })));
        const store = useOdooStore();
        store.status = CONNECTED;
        expect(await store.disconnect()).toBe(true);
        expect(store.status).toEqual({ connected: false });
    });
});

const ModalStub = { props: ['show', 'title'], template: '<div v-if="show"><slot /></div>' };

function mountModal() {
    return mount(OdooConnectionModal, {
        props: { show: true },
        global: { stubs: { BaseModal: ModalStub } },
        attachTo: document.body,
    });
}

describe('OdooConnectionModal', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('connects, then clears the key and shows the connection', async () => {
        const fetch = vi.fn()
            .mockImplementationOnce(() => respond(200, { connected: false }))
            .mockImplementationOnce(() => respond(200, CONNECTED));
        vi.stubGlobal('fetch', fetch);
        const wrapper = mountModal();
        await flushPromises();

        await wrapper.find('[data-testid="odoo-base-url"]').setValue('https://acme.odoo.com/odoo/discuss');
        await wrapper.find('[data-testid="odoo-database"]').setValue('acme');
        await wrapper.find('[data-testid="odoo-api-key"]').setValue(KEY);
        expect(wrapper.find('[data-testid="odoo-api-key"]').attributes('type')).toBe('password');
        await wrapper.find('[data-testid="odoo-connect-form"]').trigger('submit');
        await flushPromises();

        expect(JSON.parse(fetch.mock.calls[1][1].body).apiKey).toBe(KEY);
        expect(wrapper.find('[data-testid="odoo-connected-summary"]').text()).toContain('acme.odoo.com · acme as Mitchell Admin');
        expect(wrapper.text()).toContain('Documents, Knowledge, CRM, Sales');
        expect(wrapper.html()).not.toContain(KEY);
        expect(wrapper.vm.$.setupState.form.apiKey).toBe('');
    });

    it('clears the key after a failed attempt and shows the server message', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockImplementationOnce(() => respond(200, { connected: false }))
            .mockImplementationOnce(() => respond(400, { error: 'not_odoo_19', message: 'Panino works with Odoo 19 or later.' })));
        const wrapper = mountModal();
        await flushPromises();
        await wrapper.find('[data-testid="odoo-base-url"]').setValue('https://old.example.com');
        await wrapper.find('[data-testid="odoo-api-key"]').setValue(KEY);
        await wrapper.find('[data-testid="odoo-connect-form"]').trigger('submit');
        await flushPromises();

        expect(wrapper.find('[data-testid="odoo-modal-error"]').text()).toBe('Panino works with Odoo 19 or later.');
        expect(wrapper.find('[data-testid="odoo-api-key"]').element.value).toBe('');
    });

    it('warns about an expiring key and shows a stored error first', async () => {
        const soon = new Date();
        soon.setDate(soon.getDate() + 3);
        const iso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
        vi.stubGlobal('fetch', vi.fn(() => respond(200, { ...CONNECTED, keyExpiresOn: iso })));
        const wrapper = mountModal();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-key-expiry"]').text()).toMatch(/expires in 3 days/);

        vi.stubGlobal('fetch', vi.fn(() => respond(200, { ...CONNECTED, lastError: 'key_rejected', lastErrorMessage: 'Odoo rejected the API key.' })));
        await wrapper.find('[data-testid="odoo-check"]').trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-last-error"]').text()).toBe('Odoo rejected the API key.');
        expect(wrapper.find('[data-testid="odoo-key-expiry"]').exists()).toBe(false);
    });

    it('changes the key without showing the old one', async () => {
        vi.stubGlobal('fetch', vi.fn(() => respond(200, CONNECTED)));
        const wrapper = mountModal();
        await flushPromises();
        await wrapper.find('[data-testid="odoo-change"]').trigger('click');
        expect(wrapper.find('[data-testid="odoo-base-url"]').element.value).toBe('https://acme.odoo.com');
        expect(wrapper.find('[data-testid="odoo-api-key"]').element.value).toBe('');
        await wrapper.find('[data-testid="odoo-change-cancel"]').trigger('click');
        expect(wrapper.find('[data-testid="odoo-connected"]').exists()).toBe(true);
    });
});
