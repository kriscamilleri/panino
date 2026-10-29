// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import { buildBlockMarkdown, findBlocks } from '@/utils/odooSaleOrderBlock';

const doc = reactive({ selectedFile: { id: 'note-1', dbKey: 'user:me', title: 'Quote', content: '' } });
const editor = reactive({ isEditorAvailable: true });

vi.mock('@/store/authStore', () => ({ useAuthStore: () => ({ token: 'jwt' }) }));
vi.mock('@/store/docStore', async () => {
    const { defineStore } = await import('pinia');
    return { useDocStore: defineStore('doc', { state: () => doc }) };
});
vi.mock('@/store/draftStore', () => ({ useDraftStore: () => ({ getDraft: () => undefined }) }));
vi.mock('@/store/editorStore', () => ({
    useEditorStore: () => ({
        get isEditorAvailable() { return editor.isEditorAvailable; },
        // The editor applies the pure edit to the whole text, cursor at the end.
        transformText: (fn) => {
            const value = doc.selectedFile.content;
            const next = fn({ value, selectionStart: value.length, selectionEnd: value.length });
            doc.selectedFile.content = next.value;
            return next.value !== value;
        },
    }),
}));
vi.mock('@/store/syncStore', () => ({ useSyncStore: () => ({ isOnline: true }) }));
vi.mock('@/store/uiStore', () => ({ useUiStore: () => ({ showEditor: true, toggleEditor: vi.fn() }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { default: OdooDataBlockModal } = await import('@/components/OdooDataBlockModal.vue');

const CONNECTED = { connected: true, baseUrl: 'https://acme.odoo.com', apps: ['sales'] };
const FIELDS = {
    order: [
        { name: 'partner_id', label: 'Customer', type: 'many2one' },
        { name: 'amount_total', label: 'Total', type: 'monetary' },
        { name: 'client_order_ref', label: 'Customer Reference', type: 'char' },
    ],
    line: [
        { name: 'name', label: 'Description', type: 'text' },
        { name: 'product_uom_qty', label: 'Quantity', type: 'float' },
        { name: 'price_subtotal', label: 'Subtotal', type: 'monetary' },
    ],
    defaults: { fields: ['partner_id', 'amount_total'], columns: ['name', 'product_uom_qty', 'price_subtotal'] },
};

/** The snapshot the fake API answers, built from what was asked. */
function snapshotFor(url, { name = 'S00007', customer = 'Deco Addict' } = {}) {
    const params = new URL(url, 'http://x').searchParams;
    const list = (key) => (params.get(key) ? params.get(key).split(',') : []);
    const values = { partner_id: { type: 'text', value: customer }, amount_total: { type: 'number', value: 100 }, client_order_ref: { type: 'text', value: 'PO-1' }, name: { type: 'text', value: name } };
    const label = (catalog, field) => catalog.find((entry) => entry.name === field)?.label || field;
    return {
        order: { id: 7, name, url: 'https://acme.odoo.com/odoo/sale.order/7' },
        fields: list('fields').map((field) => ({ name: field, label: label(FIELDS.order, field), cell: values[field] })),
        columns: list('columns').map((field) => ({ name: field, label: label(FIELDS.line, field), type: 'text' })),
        lines: [{ kind: 'line', cells: list('columns').map((field) => ({ type: 'text', value: `${field}-value` })) }],
        truncated: false,
    };
}

function api(order = {}, { layouts = [] } = {}) {
    const calls = [];
    const saved = [...layouts];
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
        const path = new URL(url, 'http://x').pathname;
        calls.push(url);
        calls.requests = [...(calls.requests || []), { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null }];
        if (path === '/addons/odoo/sale-order-layouts' && options.method === 'POST') {
            const layout = { id: `layout-${saved.length + 1}`, ...JSON.parse(options.body) };
            saved.push(layout);
            return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve(layout) });
        }
        const body = path === '/addons/odoo' ? CONNECTED
            : path === '/addons/odoo/sale-order-layouts' ? { layouts: saved }
            : path === '/addons/odoo/sale-orders' ? { orders: [{ id: 7, name: 'S00007', partnerName: 'Deco Addict', status: 'Quotation' }] }
                : path === '/addons/odoo/sale-orders/fields' ? FIELDS
                    : path === '/addons/odoo/sale-orders/7' ? snapshotFor(url, order)
                        : null;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    }));
    return calls;
}

const ModalStub = { props: ['show', 'title'], template: '<div v-if="show"><h2>{{ title }}</h2><slot /><slot name="footer" /></div>' };
const mountModal = () => mount(OdooDataBlockModal, { props: { show: true }, global: { stubs: { BaseModal: ModalStub } } });
const byTestId = (wrapper, id) => wrapper.find(`[data-testid="${id}"]`);
const lastSnapshotCall = (calls) => new URL(calls.filter((url) => url.includes('/sale-orders/7')).at(-1), 'http://x').searchParams;

describe('OdooDataBlockModal', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        doc.selectedFile.content = '';
        editor.isEditorAvailable = true;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('opens on the order search when the Document has no blocks, then inserts with the defaults', async () => {
        doc.selectedFile.content = '# Quote';
        const calls = api();
        const wrapper = mountModal();
        await flushPromises();
        expect(byTestId(wrapper, 'odoo-data-order-list').exists()).toBe(true);
        await byTestId(wrapper, 'odoo-data-order-7').trigger('click');
        await flushPromises();
        expect(wrapper.findAll('[data-testid="odoo-data-fields-item"]').map((item) => item.text())).toEqual(['Customer', 'Total']);
        await byTestId(wrapper, 'odoo-data-submit').trigger('click');
        await flushPromises();
        expect(lastSnapshotCall(calls).get('fields')).toBe('partner_id,amount_total');
        expect(lastSnapshotCall(calls).get('columns')).toBe('name,product_uom_qty,price_subtotal');
        expect(doc.selectedFile.content.startsWith('# Quote\n\n<!-- odoo:sale.order {"v":1,"id":7,"ref":"S00007"')).toBe(true);
        expect(doc.selectedFile.content).toContain('| Customer | Deco Addict |');
        // Back on the list, which now shows the new block.
        expect(byTestId(wrapper, 'odoo-data-block-0').text()).toContain('S00007');
    });

    it('sends the values and columns in the order chosen', async () => {
        const calls = api();
        const wrapper = mountModal();
        await flushPromises();
        await byTestId(wrapper, 'odoo-data-order-7').trigger('click');
        await flushPromises();
        // Remove Customer, add Customer Reference, move Subtotal to the front.
        await wrapper.find('[aria-label="Remove Customer"]').trigger('click');
        await byTestId(wrapper, 'odoo-data-fields-add').setValue('client_order_ref');
        await wrapper.find('[aria-label="Move Subtotal up"]').trigger('click');
        await wrapper.find('[aria-label="Move Subtotal up"]').trigger('click');
        await byTestId(wrapper, 'odoo-data-submit').trigger('click');
        await flushPromises();
        expect(lastSnapshotCall(calls).get('fields')).toBe('amount_total,client_order_ref');
        expect(lastSnapshotCall(calls).get('columns')).toBe('price_subtotal,name,product_uom_qty');
    });

    it('refreshes a block in place and leaves the rest of the Document alone', async () => {
        const old = buildBlockMarkdown(snapshotFor('/x?fields=partner_id&columns=name', { customer: 'Old Name' }));
        doc.selectedFile.content = `Before\n\n${old}\n\nAfter`;
        const calls = api({ customer: 'New Name' });
        const wrapper = mountModal();
        await flushPromises();
        await byTestId(wrapper, 'odoo-data-refresh-0').trigger('click');
        await flushPromises();
        expect(lastSnapshotCall(calls).get('fields')).toBe('partner_id');
        expect(doc.selectedFile.content).toContain('| Customer | New Name |');
        expect(doc.selectedFile.content).not.toContain('Old Name');
        expect(doc.selectedFile.content.startsWith('Before\n\n')).toBe(true);
        expect(doc.selectedFile.content.endsWith('\n\nAfter')).toBe(true);
        expect(byTestId(wrapper, 'odoo-data-block-0').text()).toContain('Updated at');
    });

    it('refuses to refresh a block whose order now has another reference', async () => {
        const old = buildBlockMarkdown(snapshotFor('/x?fields=partner_id&columns=name'));
        doc.selectedFile.content = old;
        api({ name: 'S00999' });
        const wrapper = mountModal();
        await flushPromises();
        await byTestId(wrapper, 'odoo-data-refresh-all').trigger('click');
        await flushPromises();
        expect(doc.selectedFile.content).toBe(old);
        expect(byTestId(wrapper, 'odoo-data-block-0').text()).toContain('may come from another Odoo');
        expect(byTestId(wrapper, 'odoo-data-error').text()).toBe('One sales order could not be refreshed.');
    });

    it('edits a block with its own values and columns', async () => {
        doc.selectedFile.content = buildBlockMarkdown(snapshotFor('/x?fields=amount_total&columns=price_subtotal,name'));
        const calls = api();
        const wrapper = mountModal();
        await flushPromises();
        await byTestId(wrapper, 'odoo-data-edit-0').trigger('click');
        await flushPromises();
        expect(wrapper.findAll('[data-testid="odoo-data-fields-item"]').map((item) => item.text())).toEqual(['Total']);
        expect(wrapper.findAll('[data-testid="odoo-data-columns-item"]').map((item) => item.text())).toEqual(['Subtotal', 'Description']);
        await byTestId(wrapper, 'odoo-data-columns-defaults').trigger('click');
        await byTestId(wrapper, 'odoo-data-submit').trigger('click');
        await flushPromises();
        expect(lastSnapshotCall(calls).get('columns')).toBe('name,product_uom_qty,price_subtotal');
        const blocks = findBlocks(doc.selectedFile.content);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].config.columns).toEqual(['name', 'product_uom_qty', 'price_subtotal']);
    });

    it('lists a damaged block without offering to rewrite it', async () => {
        doc.selectedFile.content = '<!-- odoo:sale.order {broken} -->\n| a |\n<!-- /odoo:sale.order -->';
        api();
        const wrapper = mountModal();
        await flushPromises();
        expect(byTestId(wrapper, 'odoo-data-block-0').text()).toContain('damaged');
        expect(byTestId(wrapper, 'odoo-data-refresh-0').exists()).toBe(false);
        expect(byTestId(wrapper, 'odoo-data-refresh-all').exists()).toBe(false);
    });

    it('asks for the editor when it is not shown', async () => {
        doc.selectedFile.content = buildBlockMarkdown(snapshotFor('/x?fields=partner_id&columns=name'));
        editor.isEditorAvailable = false;
        api();
        const wrapper = mountModal();
        await flushPromises();
        expect(byTestId(wrapper, 'odoo-data-no-editor').exists()).toBe(true);
        expect(byTestId(wrapper, 'odoo-data-refresh-0').attributes('disabled')).toBeDefined();
    });

    describe('layouts', () => {
        const startChoosing = async (wrapper) => {
            await flushPromises();
            await byTestId(wrapper, 'odoo-data-order-7').trigger('click');
            await flushPromises();
        };

        it('inserts with a starter layout, asking Odoo only for what it uses', async () => {
            const calls = api();
            const wrapper = mountModal();
            await startChoosing(wrapper);
            await byTestId(wrapper, 'odoo-data-layout').setValue('builtin:quotation');
            expect(byTestId(wrapper, 'odoo-data-layout-body').element.value).toContain('## Quotation {{order.name}}');
            await byTestId(wrapper, 'odoo-data-submit').trigger('click');
            await flushPromises();
            const params = lastSnapshotCall(calls);
            expect(params.get('fields').split(',')).toEqual(['name', 'partner_id', 'date_order', 'validity_date', 'user_id', 'amount_untaxed', 'amount_tax', 'amount_total']);
            expect(params.get('columns').split(',')).toEqual(['name', 'product_uom_qty', 'product_uom_id', 'price_unit', 'tax_ids', 'price_subtotal']);
            expect(doc.selectedFile.content).toContain('## Quotation S00007');
            expect(doc.selectedFile.content).toContain('**Deco Addict**');
            expect(findBlocks(doc.selectedFile.content)[0].config.layout).toContain('{{#lines}}');
            expect(byTestId(wrapper, 'odoo-data-block-0').text()).toContain('Markdown layout');
        });

        it('checks a layout as it is written, and saves it for reuse', async () => {
            const calls = api();
            const wrapper = mountModal();
            await startChoosing(wrapper);
            await byTestId(wrapper, 'odoo-data-layout').setValue('builtin:lines');
            const body = byTestId(wrapper, 'odoo-data-layout-body');
            await body.setValue('{{#lines}} unclosed');
            expect(byTestId(wrapper, 'odoo-data-layout-error').text()).toContain('never closed');
            expect(byTestId(wrapper, 'odoo-data-submit').attributes('disabled')).toBeDefined();

            await body.setValue('Customer: ');
            body.element.setSelectionRange(10, 10);
            await byTestId(wrapper, 'odoo-data-insert-order').setValue('partner_id');
            await flushPromises();
            expect(body.element.value).toBe('Customer: {{order.partner_id}}');
            await body.setValue('Customer: {{order.partner_id}} {{order.nonsense}}');
            expect(byTestId(wrapper, 'odoo-data-layout-unknown').text()).toContain('order.nonsense');

            await byTestId(wrapper, 'odoo-data-layout-name').setValue('One line');
            await byTestId(wrapper, 'odoo-data-layout-save').trigger('click');
            await flushPromises();
            expect(calls.requests.find((r) => r.method === 'POST').body).toEqual({ name: 'One line', body: 'Customer: {{order.partner_id}} {{order.nonsense}}' });
            expect(byTestId(wrapper, 'odoo-data-layout').element.value).toBe('layout-1');
            expect(byTestId(wrapper, 'odoo-data-layout-message').text()).toBe('Saved “One line”.');
        });

        it('turns the table choice into an editable layout', async () => {
            api();
            const wrapper = mountModal();
            await startChoosing(wrapper);
            await byTestId(wrapper, 'odoo-data-edit-markdown').trigger('click');
            const body = byTestId(wrapper, 'odoo-data-layout-body').element.value;
            expect(body).toContain('| Customer | {{order.partner_id}} |');
            expect(body).toContain('| Description | Quantity | Subtotal |');
            expect(byTestId(wrapper, 'odoo-data-layout').element.value).toBe('custom');
        });

        it('edits a layout block with its own layout', async () => {
            doc.selectedFile.content = buildBlockMarkdown(snapshotFor('/x?fields=partner_id&columns='), { layout: 'Hello {{order.partner_id}}' });
            const calls = api({ customer: 'Edited' });
            const wrapper = mountModal();
            await flushPromises();
            await byTestId(wrapper, 'odoo-data-edit-0').trigger('click');
            await flushPromises();
            expect(byTestId(wrapper, 'odoo-data-layout').element.value).toBe('block');
            await byTestId(wrapper, 'odoo-data-layout-body').setValue('Bye {{order.partner_id}}');
            await byTestId(wrapper, 'odoo-data-submit').trigger('click');
            await flushPromises();
            expect(lastSnapshotCall(calls).get('fields')).toBe('partner_id');
            expect(doc.selectedFile.content).toContain('\nBye Edited\n');
            expect(findBlocks(doc.selectedFile.content)).toHaveLength(1);
        });
    });
});
