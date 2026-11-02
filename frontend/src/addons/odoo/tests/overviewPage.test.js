// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive, ref } from 'vue';

const push = vi.fn();
const isPhone = ref(false);
const syncStore = reactive({
    isOnline: true,
    isSyncing: false,
    databases: new Map(),
    sync: vi.fn(async () => {}),
});
const flushPendingSave = vi.fn(async () => {});
const addToast = vi.fn();

vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt', user: { id: 'me' } }) }));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => syncStore }));
vi.mock('@/store/editorStore', () => ({ useEditorStore: () => ({ flushPendingSave }) }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ addToast }) }));
vi.mock('@/composables/useViewport', () => ({ useViewport: () => ({ isPhone }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/addons/odoo/components/OdooSyncsCard.vue', () => ({
    default: { props: ['dbKey', 'spaceMode', 'overviewLink'], template: '<div data-testid="syncs-card">{{ dbKey }} {{ spaceMode }} {{ overviewLink }}</div>' },
}));

const { default: OdooOverviewPage } = await import('@/addons/odoo/components/OdooOverviewPage.vue');

const ME = 'user:me';
const SPACE = 'space:s1';
const CONNECTED = { connected: true, baseUrl: 'https://acme.odoo.com', odooUserName: 'Mitchell Admin', apps: ['documents', 'knowledge'] };
const doc = (noteId, state, extra = {}) => ({
    dbKey: ME, placeName: 'My Notes', noteId, title: noteId, state, canSend: true,
    lastSentAt: new Date(Date.now() - 2 * 86400000).toISOString(), lastSentBy: null, lastSentByMe: true,
    records: [{ destination: 'documents', key: 'documents', label: 'Documents PDF', sameOdoo: true, url: `https://acme.odoo.com/odoo/documents/${noteId}`, syncId: null }],
    failure: null,
    ...extra,
});
const OVERVIEW = {
    odooHost: 'https://acme.odoo.com',
    truncated: false,
    total: 5,
    places: [{ dbKey: ME, name: 'My Notes', role: 'owner' }, { dbKey: SPACE, name: 'Writers', role: 'editor' }],
    documents: [
        doc('failing', 'sync_failed', { canSend: false, failure: { error: 'images_failed', message: 'Some images could not be uploaded to the article.' } }),
        doc('proposal', 'changed', { dbKey: SPACE, placeName: 'Writers', lastSentBy: 'Sam', lastSentByMe: false }),
        doc('prices', 'changed'),
        doc('handbook', 'current'),
        doc('offer', 'current', { canSend: false }),
    ],
    syncs: [{ id: 'sync-1', dbKey: SPACE }],
};

/** fetch by path; `resend` answers POST /resend by dbKey. */
function api({ status = CONNECTED, overview = OVERVIEW, resend = () => ({ results: {} }) } = {}) {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
        const path = new URL(url, 'http://x').pathname;
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ path, body });
        const payload = path === '/addons/odoo' ? status
            : path === '/addons/odoo/overview' ? overview
                : path === '/addons/odoo/resend' ? resend(body)
                    : null;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
    }));
    return calls;
}

const mountPage = (query = {}) => mount(OdooOverviewPage, { props: { query } });
const rowIds = (wrapper) => wrapper.findAll('[data-testid^="odoo-overview-row-"]').map((row) => row.attributes('data-testid').replace('odoo-overview-row-', ''));

describe('OdooOverviewPage', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        isPhone.value = false;
        syncStore.isOnline = true;
        syncStore.isSyncing = false;
        syncStore.databases = new Map([[ME, { status: 'synced' }], [SPACE, { status: 'synced' }]]);
        syncStore.sync.mockReset();
        syncStore.sync.mockImplementation(async () => {});
        flushPendingSave.mockClear();
        addToast.mockClear();
        push.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('opens on what needs attention, with counts, and switches to All', async () => {
        api();
        const wrapper = mountPage();
        await flushPromises();
        expect(wrapper.get('[data-testid="odoo-overview-tab-attention"]').text()).toBe('Needs attention 3');
        expect(wrapper.get('[data-testid="odoo-overview-tab-all"]').text()).toBe('All 5');
        expect(rowIds(wrapper)).toEqual(['failing', 'proposal', 'prices']);
        expect(wrapper.get('[data-testid="odoo-overview-state-failing"]').text()).toContain('Sync failed: Some images could not be uploaded to the article.');
        expect(wrapper.get('[data-testid="odoo-overview-state-proposal"]').text()).toBe('Changed since sent · sent 2 days ago by Sam');
        expect(wrapper.get('[data-testid="odoo-overview-state-prices"]').text()).toBe('Changed since sent · sent 2 days ago by you');

        await wrapper.get('[data-testid="odoo-overview-tab-all"]').trigger('click');
        expect(rowIds(wrapper)).toHaveLength(5);
    });

    it('says everything is up to date when nothing needs attention', async () => {
        api({ overview: { ...OVERVIEW, documents: [doc('handbook', 'current')] } });
        const wrapper = mountPage();
        await flushPromises();
        expect(wrapper.get('[data-testid="odoo-overview-empty"]').text()).toContain('Everything is up to date.');
        await wrapper.get('[data-testid="odoo-overview-show-all"]').trigger('click');
        expect(rowIds(wrapper)).toEqual(['handbook']);
    });

    it('filters by place from the query, and by search', async () => {
        api();
        const wrapper = mountPage({ where: SPACE });
        await flushPromises();
        expect(wrapper.get('[data-testid="odoo-overview-where"]').element.value).toBe(SPACE);
        expect(rowIds(wrapper)).toEqual(['proposal']);
        expect(wrapper.findAll('[data-testid="syncs-card"]').map((card) => card.text())).toEqual([`${SPACE} true false`]);

        await wrapper.get('[data-testid="odoo-overview-where"]').setValue('all');
        await wrapper.get('[data-testid="odoo-overview-search"]').setValue('pri');
        expect(rowIds(wrapper)).toEqual(['prices']);
    });

    it('links to the records in Odoo in a new tab, and opens the Document in Panino', async () => {
        api();
        const wrapper = mountPage();
        await flushPromises();
        expect(wrapper.get('[data-testid="odoo-overview-link-prices-documents"]').attributes()).toMatchObject({
            href: 'https://acme.odoo.com/odoo/documents/prices', target: '_blank', rel: 'noopener noreferrer',
        });
        await wrapper.get('[data-testid="odoo-overview-open-doc-proposal"]').trigger('click');
        expect(push).toHaveBeenCalledWith({ name: 'doc', params: { fileId: 'proposal' }, query: { dbKey: SPACE } });
    });

    it('sends updates for the selected Documents, per database after syncing it, and reports each', async () => {
        const calls = api({
            resend: ({ dbKey, noteIds }) => ({
                results: Object.fromEntries(noteIds.map((id) => [id, dbKey === SPACE
                    ? { ok: false, error: 'access_denied', message: "Your Odoo user can't update this record." }
                    : { ok: true }])),
            }),
        });
        const wrapper = mountPage();
        await flushPromises();
        expect(wrapper.get('[data-testid="odoo-overview-select-failing"]').attributes('disabled')).toBeDefined();
        await wrapper.get('[data-testid="odoo-overview-select-prices"]').setValue(true);
        await wrapper.get('[data-testid="odoo-overview-select-proposal"]').setValue(true);
        expect(wrapper.get('[data-testid="odoo-overview-bulk"]').text()).toContain('2 selected');

        await wrapper.get('[data-testid="odoo-overview-send-selected"]').trigger('click');
        await flushPromises();
        expect(flushPendingSave).toHaveBeenCalled();
        expect(syncStore.sync.mock.calls.map(([key]) => key).sort()).toEqual([ME, SPACE].sort());
        const resends = calls.filter((call) => call.path === '/addons/odoo/resend').map((call) => call.body);
        expect(resends).toEqual(expect.arrayContaining([{ dbKey: ME, noteIds: ['prices'] }, { dbKey: SPACE, noteIds: ['proposal'] }]));
        expect(addToast).toHaveBeenCalledWith('Sent 1 of 2. 1 failed.', 'warning');
        expect(wrapper.get('[data-testid="odoo-overview-result-proposal"]').text()).toBe("Your Odoo user can't update this record.");
        // The failed one stays selected; the sent one does not.
        expect(wrapper.get('[data-testid="odoo-overview-bulk"]').text()).toContain('1 selected');
    });

    it('sends nothing when the latest changes have not reached the server', async () => {
        vi.useFakeTimers();
        const calls = api();
        syncStore.sync.mockImplementation(async () => { syncStore.isSyncing = true; });
        const wrapper = mountPage();
        await vi.runAllTimersAsync();
        await wrapper.get('[data-testid="odoo-overview-send-prices"]').trigger('click');
        await vi.advanceTimersByTimeAsync(11000);
        await flushPromises();
        expect(calls.some((call) => call.path === '/addons/odoo/resend')).toBe(false);
        expect(wrapper.get('[data-testid="odoo-overview-error"]').text()).toContain("haven't reached the server yet");
    });

    it('offers Send update on changed rows only, and on a phone no ticking', async () => {
        isPhone.value = true;
        api();
        const wrapper = mountPage();
        await flushPromises();
        await wrapper.get('[data-testid="odoo-overview-tab-all"]').trigger('click');
        expect(wrapper.find('[data-testid^="odoo-overview-select-"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="odoo-overview-send-prices"]').exists()).toBe(true);
        expect(wrapper.find('[data-testid="odoo-overview-send-handbook"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="odoo-overview-send-failing"]').exists()).toBe(false);
    });

    it('points to Settings when Odoo is not connected', async () => {
        const calls = api({ status: { connected: false } });
        const wrapper = mountPage();
        await flushPromises();
        expect(wrapper.find('[data-testid="odoo-overview-not-connected"]').exists()).toBe(true);
        expect(calls.some((call) => call.path === '/addons/odoo/overview')).toBe(false);
    });
});
