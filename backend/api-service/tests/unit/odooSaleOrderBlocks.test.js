import { describe, expect, it } from 'vitest';
import {
    DEFAULT_LINE_COLUMNS, MAX_CHOSEN_FIELDS, catalogFromFieldsGet, cellFor, chooseFields, parseFieldList,
} from '../../odooSaleOrderBlocks.js';

describe('sales order blocks', () => {
    describe('catalogFromFieldsGet', () => {
        const catalog = catalogFromFieldsGet({
            id: { type: 'integer', string: 'ID' },
            name: { type: 'char', string: 'Order Reference' },
            partner_id: { type: 'many2one', string: 'Customer', relation: 'res.partner' },
            state: { type: 'selection', string: 'Status', selection: [['sale', 'Sales Order']] },
            tag_ids: { type: 'many2many', string: 'Tags', relation: 'crm.tag' },
            note: { type: 'html', string: 'Terms' },
            image: { type: 'binary', string: 'Image' },
            order_line: { type: 'one2many', string: 'Lines' },
            message_ids: { type: 'char', string: 'Messages' },
            activity_state: { type: 'selection', string: 'Activity State', selection: [] },
            access_token: { type: 'char', string: 'Token' },
            amount_total: { type: 'monetary', string: 'Total' },
        });

        it('keeps plain value fields, sorted by label', () => {
            expect([...catalog.keys()]).toEqual(['partner_id', 'name', 'state', 'tag_ids', 'amount_total']);
        });

        it('never offers binary, html, one2many or technical fields', () => {
            for (const name of ['id', 'note', 'image', 'order_line', 'message_ids', 'activity_state', 'access_token']) {
                expect(catalog.has(name)).toBe(false);
            }
        });

        it('keeps selection labels and many2many relations for reading', () => {
            expect(catalog.get('state').selection.get('sale')).toBe('Sales Order');
            expect(catalog.get('tag_ids').relation).toBe('crm.tag');
        });
    });

    describe('chooseFields', () => {
        const catalog = new Map(['name', 'product_uom_qty', 'price_unit', 'price_subtotal', 'discount'].map((name) => [name, { name }]));

        it('gives the defaults the database has when nothing is asked', () => {
            expect(chooseFields(undefined, catalog, DEFAULT_LINE_COLUMNS)).toEqual(['name', 'product_uom_qty', 'price_unit', 'discount', 'price_subtotal']);
        });

        it('keeps the asked order, drops unknown names and repeats', () => {
            expect(chooseFields(['price_subtotal', 'image', 'name', 'price_subtotal'], catalog, DEFAULT_LINE_COLUMNS))
                .toEqual(['price_subtotal', 'name']);
        });

        it('allows choosing nothing', () => {
            expect(chooseFields([], catalog, DEFAULT_LINE_COLUMNS)).toEqual([]);
        });

        it('caps the number of fields', () => {
            const many = new Map(Array.from({ length: 50 }, (_, i) => [`f${i}`, {}]));
            expect(chooseFields([...many.keys()], many, [])).toHaveLength(MAX_CHOSEN_FIELDS);
        });
    });

    it('parseFieldList reads a comma list and tells absent from empty', () => {
        expect(parseFieldList(undefined)).toBeUndefined();
        expect(parseFieldList(['a'])).toBeUndefined();
        expect(parseFieldList('')).toEqual([]);
        expect(parseFieldList(' name, price_unit ,,')).toEqual(['name', 'price_unit']);
    });

    describe('cellFor', () => {
        const usd = { code: 'USD', symbol: '$', position: 'before', decimals: 2 };

        it('turns Odoo values into typed cells', () => {
            expect(cellFor({ type: 'char' }, 'S00001')).toEqual({ type: 'text', value: 'S00001' });
            expect(cellFor({ type: 'selection', selection: new Map([['sale', 'Sales Order']]) }, 'sale')).toEqual({ type: 'text', value: 'Sales Order' });
            expect(cellFor({ type: 'many2one' }, [7, 'Azure Interior'])).toEqual({ type: 'text', value: 'Azure Interior' });
            expect(cellFor({ type: 'float' }, 1.5)).toEqual({ type: 'number', value: 1.5 });
            expect(cellFor({ type: 'monetary' }, 825, { currency: usd })).toEqual({ type: 'monetary', value: 825, currency: usd });
            expect(cellFor({ type: 'date' }, '2026-11-25')).toEqual({ type: 'date', value: '2026-11-25' });
            expect(cellFor({ type: 'datetime' }, '2026-09-26 21:41:22')).toEqual({ type: 'datetime', value: '2026-09-26T21:41:22Z' });
            expect(cellFor({ type: 'boolean' }, false)).toEqual({ type: 'boolean', value: false });
        });

        it('treats Odoo’s false as no value, but keeps a zero', () => {
            expect(cellFor({ type: 'char' }, false)).toBeNull();
            expect(cellFor({ type: 'many2one' }, false)).toBeNull();
            expect(cellFor({ type: 'date' }, false)).toBeNull();
            expect(cellFor({ type: 'float' }, 0)).toEqual({ type: 'number', value: 0 });
        });

        it('joins many2many names it could read', () => {
            const names = new Map([['account.tax', new Map([[3, '15%'], [5, 'Eco tax']])]]);
            expect(cellFor({ type: 'many2many', relation: 'account.tax' }, [3, 5, 9], { names })).toEqual({ type: 'text', value: '15%, Eco tax' });
            expect(cellFor({ type: 'many2many', relation: 'account.tax' }, [], { names })).toBeNull();
            expect(cellFor({ type: 'many2many', relation: 'crm.tag' }, [1], { names })).toBeNull();
        });

        it('refuses malformed dates and caps long text', () => {
            expect(cellFor({ type: 'date' }, 'next week')).toBeNull();
            expect(cellFor({ type: 'datetime' }, '2026-09-26T21:41:22')).toBeNull();
            expect(cellFor({ type: 'text' }, 'x'.repeat(5000)).value).toHaveLength(2000);
        });
    });
});
