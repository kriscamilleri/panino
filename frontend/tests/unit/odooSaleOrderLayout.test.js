import { describe, expect, it } from 'vitest';
import { applyDocumentVariables, renderDocumentHtml } from '@panino/content-merge/markdown-render';
import { BUILT_IN_LAYOUTS, layoutFields, parseLayout, renderLayout, tableLayout } from '@/utils/odooSaleOrderLayout';
import { buildBlockMarkdown, escapeCell, findBlocks, formatCell, replaceBlock } from '@/utils/odooSaleOrderBlock';

const USD = { code: 'USD', symbol: '$', position: 'before', decimals: 2 };
const OPTIONS = { locale: 'en-US', timeZone: 'UTC', now: new Date('2026-10-29T14:05:00Z') };
const format = (cell) => escapeCell(formatCell(cell, { locale: 'en-US', timeZone: 'UTC' }));
const render = (body, snapshot) => renderLayout(body, snapshot, { formatValue: format, escapeText: escapeCell, updated: 'NOW' });

function snapshot(overrides = {}) {
    return {
        order: { id: 20, name: 'S00020', url: 'https://odoo.example.com/odoo/sale.order/20' },
        fields: [
            { name: 'partner_id', label: 'Customer', cell: { type: 'text', value: 'Joel Willis' } },
            { name: 'amount_total', label: 'Total', cell: { type: 'monetary', value: 1364.48, currency: USD } },
        ],
        columns: [
            { name: 'name', label: 'Description', type: 'text' },
            { name: 'price_subtotal', label: 'Subtotal', type: 'monetary' },
        ],
        lines: [
            { kind: 'line', cells: [{ type: 'text', value: 'Desk' }, { type: 'monetary', value: 825, currency: USD }] },
            { kind: 'section', text: 'Services' },
            { kind: 'line', cells: [{ type: 'text', value: 'Install' }, { type: 'monetary', value: 100, currency: USD }] },
            { kind: 'note', text: 'Delivered Monday' },
        ],
        ...overrides,
    };
}

describe('sales order layouts', () => {
    describe('renderLayout', () => {
        it('fills order values and repeats the lines, keeping the table unbroken', () => {
            const body = [
                '## Quote {{order.name}} for {{order.partner_id}}',
                '',
                '| Item | Amount |',
                '| --- | --: |',
                '{{#lines}}',
                '| {{line.name}} | {{line.price_subtotal}} |',
                '{{/lines}}',
                '',
                'Total: {{order.amount_total}} · {{odoo.updated}} · [Odoo]({{odoo.url}})',
            ].join('\n');
            expect(render(body, snapshot())).toBe([
                '## Quote S00020 for Joel Willis',
                '',
                '| Item | Amount |',
                '| --- | --: |',
                '| Desk | $\u00a0825.00 |',
                '| Install | $\u00a0100.00 |',
                '',
                'Total: $\u00a01,364.48 · NOW · [Odoo](https://odoo.example.com/odoo/sale.order/20)',
            ].join('\n'));
        });

        it('renders each kind of line through its own part', () => {
            const body = '{{#lines}}\n{{#product}}\n- {{line.name}}\n{{/product}}\n{{#section}}\n### {{line.name}}\n{{/section}}\n{{#note}}\n> {{line.name}}\n{{/note}}\n{{/lines}}';
            expect(render(body, snapshot())).toBe('- Desk\n### Services\n- Install\n> Delivered Monday');
        });

        it('leaves out sections and notes when the lines part has no kinds', () => {
            expect(render('{{#lines}}\n{{line.name}};\n{{/lines}}', snapshot())).toBe('Desk;\nInstall;');
        });

        it('leaves the Document’s own variables for the Document to fill', () => {
            expect(render('Dear {{ contact }}, {{order.partner_id}}', snapshot())).toBe('Dear {{ contact }}, Joel Willis');
        });

        it('gives nothing for a field the snapshot lacks, and drops a link that is not http(s)', () => {
            expect(render('[{{order.missing}}]({{odoo.url}})', snapshot({ order: { id: 1, name: 'S1', url: 'javascript:alert(1)' } }))).toBe('[]()');
        });

        it('keeps Odoo values from starting a heading, list or quote at the start of a line', () => {
            const hostile = snapshot({ fields: [{ name: 'partner_id', label: 'C', cell: { type: 'text', value: '# Big' } }] });
            expect(render('{{order.partner_id}}', hostile)).toBe('\\# Big');
            const numbered = snapshot({ fields: [{ name: 'partner_id', label: 'C', cell: { type: 'text', value: '1. first' } }] });
            expect(renderDocumentHtml(render('{{order.partner_id}}', numbered))).toBe('<p>1. first</p>\n');
        });
    });

    describe('Odoo values cannot escape a layout', () => {
        it.each([
            '<img src=x onerror=alert(1)>',
            '[click](javascript:alert(1))',
            '{{ title }}',
            '<!-- /odoo:sale.order -->',
            '- item\n# heading',
        ])('%s', (value) => {
            const data = snapshot({ fields: [{ name: 'partner_id', label: 'C', cell: { type: 'text', value } }] });
            const markdown = buildBlockMarkdown(data, { ...OPTIONS, layout: '{{order.partner_id}}\n\nafter' });
            expect(findBlocks(markdown)).toHaveLength(1);
            const html = renderDocumentHtml(applyDocumentVariables(markdown, { globals: { title: 'SUBSTITUTED' } }));
            expect(html).not.toMatch(/<img|<a href|<h1|<li|SUBSTITUTED/);
        });
    });

    describe('parseLayout', () => {
        it.each([
            ['', 'empty'],
            ['{{#lines}} x', 'never closed'],
            ['x {{/lines}}', 'does not close'],
            ['{{#lines}}{{#lines}}{{/lines}}{{/lines}}', 'cannot be inside another {{#lines}}'],
            ['{{#product}}x{{/product}}', 'only works inside {{#lines}}'],
            ['{{line.name}}', 'only works inside {{#lines}}'],
            ['{{#lines}}{{#product}}{{#note}}{{/note}}{{/product}}{{/lines}}', 'cannot be inside another line part'],
            ['a <!-- b', 'HTML comments'],
            ['x'.repeat(8001), 'at most 8000'],
        ])('refuses %j', (body, message) => {
            const result = parseLayout(body);
            expect(result.ok).toBe(false);
            expect(result.error).toContain(message);
        });

        it('accepts every built-in layout', () => {
            for (const layout of BUILT_IN_LAYOUTS) expect(parseLayout(layout.body).ok).toBe(true);
        });
    });

    it('layoutFields lists what to ask Odoo for, once each', () => {
        expect(layoutFields('{{order.partner_id}} {{order.name}} {{#lines}}{{line.name}} {{line.tax_ids}} {{line.name}}{{/lines}} {{odoo.url}} {{ title }}'))
            .toEqual({ fields: ['partner_id', 'name'], columns: ['name', 'tax_ids'] });
    });

    it('tableLayout draws the table block as an editable layout', () => {
        const describe = (scope, name) => ({
            partner_id: { label: 'Customer' }, name: { label: 'Description' }, price_subtotal: { label: 'Sub|total', type: 'monetary' },
        })[name];
        const body = tableLayout(['partner_id'], ['name', 'price_subtotal'], describe);
        expect(parseLayout(body).ok).toBe(true);
        expect(body).toContain('| Description | Sub\\|total |\n| --- | --: |');
        const html = renderDocumentHtml(render(body, snapshot()));
        expect(html.match(/<table>/g)).toHaveLength(2);
        expect(html).toContain('<td><strong>Services</strong></td>');
    });

    describe('layout blocks', () => {
        const layout = BUILT_IN_LAYOUTS[0].body;

        it('carry their layout, and read it back with the fields to ask for', () => {
            const markdown = buildBlockMarkdown(snapshot(), { ...OPTIONS, layout });
            const [block] = findBlocks(markdown);
            expect(block.closed).toBe(true);
            expect(block.config.layout).toBe(layout);
            expect(block.config.fields).toEqual(expect.arrayContaining(['partner_id', 'amount_total']));
            expect(block.config.columns).toEqual(expect.arrayContaining(['name', 'price_subtotal']));
            expect(markdown.split('\n')[0]).toMatch(/^<!-- odoo:sale\.order \{"v":2,.* -->$/);
        });

        it('render the Quotation layout as heading, address lines and two tables', () => {
            const html = renderDocumentHtml(buildBlockMarkdown(snapshot(), { ...OPTIONS, layout }));
            expect(html).toContain('<h2>Quotation S00020</h2>');
            expect(html).toContain('<strong>Joel Willis</strong><br>');
            expect(html.match(/<table>/g)).toHaveLength(2);
            expect(html).toContain('<td><strong>Total</strong></td>');
        });

        it('keep the layout as written under the marker, with nothing escaped', () => {
            const markdown = buildBlockMarkdown(snapshot(), { ...OPTIONS, layout: 'Hi "{{order.partner_id}}"\\\nTotal {{order.amount_total}}\n\n' });
            expect(markdown.split('\n').slice(0, 5)).toEqual([
                '<!-- odoo:sale.order {"v":2,"id":20,"ref":"S00020"} -->',
                '<!-- odoo:layout',
                'Hi "{{order.partner_id}}"\\',
                'Total {{order.amount_total}}',
                '-->',
            ]);
            expect(findBlocks(markdown)[0].config.layout).toBe('Hi "{{order.partner_id}}"\\\nTotal {{order.amount_total}}');
            // The layout comment is one HTML block; only what it drew shows.
            expect(renderDocumentHtml(markdown).replace(/<!--[\s\S]*?-->\n?/g, '')).toBe('<p>Hi “Joel Willis”<br>\nTotal $\u00a01,364.48</p>\n');
        });

        it('pick up a layout edited in place in the Document', () => {
            const markdown = buildBlockMarkdown(snapshot(), { ...OPTIONS, layout: 'A {{order.name}}' });
            expect(findBlocks(markdown.replace('A {{order.name}}', 'B {{order.partner_id}}'))[0].config).toMatchObject({ layout: 'B {{order.partner_id}}', fields: ['partner_id'] });
        });

        it('still read the older form with the layout in the marker JSON', () => {
            const text = '<!-- odoo:sale.order {"v":2,"id":1,"ref":"S1","layout":"Hi {{order.partner_id}}"} -->\nHi X\n<!-- /odoo:sale.order -->';
            expect(findBlocks(text)[0].config).toMatchObject({ id: 1, layout: 'Hi {{order.partner_id}}' });
        });

        it('are damaged when the layout comment is missing', () => {
            const text = '<!-- odoo:sale.order {"v":2,"id":1,"ref":"S1"} -->\nHi X\n<!-- /odoo:sale.order -->';
            expect(findBlocks(text)[0].config).toBeNull();
        });

        it('are damaged when the carried layout no longer parses', () => {
            const text = '<!-- odoo:sale.order {"v":2,"id":1,"ref":"S1","layout":"{{#lines}}"} -->\nx\n<!-- /odoo:sale.order -->';
            expect(findBlocks(text)[0].config).toBeNull();
        });

        it('replace in place on refresh like table blocks', () => {
            const old = buildBlockMarkdown(snapshot(), { ...OPTIONS, layout });
            const text = `Intro\n\n${old}\n\nTerms`;
            const [found] = findBlocks(text);
            const next = buildBlockMarkdown(snapshot({ fields: [{ name: 'partner_id', label: 'Customer', cell: { type: 'text', value: 'New Name' } }] }), { ...OPTIONS, layout });
            const result = replaceBlock({ value: text, selectionStart: 0, selectionEnd: 0 }, found, next);
            expect(result.value).toContain('**New Name**');
            expect(result.value.startsWith('Intro\n\n')).toBe(true);
            expect(result.value.endsWith('\n\nTerms')).toBe(true);
        });
    });
});
