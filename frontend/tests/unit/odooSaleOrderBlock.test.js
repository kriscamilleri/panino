import { describe, expect, it } from 'vitest';
import { applyDocumentVariables, renderDocumentHtml } from '@panino/content-merge/markdown-render';
import {
    buildBlockMarkdown, escapeCell, findBlocks, formatCell, insertBlock, parseConfig, replaceBlock,
} from '@/utils/odooSaleOrderBlock';

const USD = { code: 'USD', symbol: '$', position: 'before', decimals: 2 };
const OPTIONS = { locale: 'en-US', timeZone: 'UTC', now: new Date('2026-10-29T14:05:00Z') };

function snapshot(overrides = {}) {
    return {
        order: { id: 1, name: 'S00001', url: 'https://odoo.example.com/odoo/sale.order/1' },
        fields: [
            { name: 'partner_id', label: 'Customer', cell: { type: 'text', value: 'Azure Interior' } },
            { name: 'amount_total', label: 'Total', cell: { type: 'monetary', value: 1364.48, currency: USD } },
        ],
        columns: [
            { name: 'name', label: 'Description', type: 'text' },
            { name: 'product_uom_qty', label: 'Quantity', type: 'float' },
            { name: 'price_subtotal', label: 'Subtotal', type: 'monetary' },
        ],
        lines: [
            { kind: 'line', cells: [{ type: 'text', value: 'Screens\nNoise-reducing' }, { type: 'number', value: 3 }, { type: 'monetary', value: 825, currency: USD }] },
            { kind: 'section', text: 'Services' },
            { kind: 'note', text: 'Delivered Monday' },
        ],
        truncated: false,
        ...overrides,
    };
}

describe('sales order blocks', () => {
    describe('buildBlockMarkdown', () => {
        it('writes a header table, a lines table and an updated line between markers', () => {
            expect(buildBlockMarkdown(snapshot(), OPTIONS)).toBe([
                '<!-- odoo:sale.order {"v":1,"id":1,"ref":"S00001","fields":["partner_id","amount_total"],"columns":["name","product_uom_qty","price_subtotal"]} -->',
                '| Sales order | **S00001** |',
                '| --- | --- |',
                '| Customer | Azure Interior |',
                '| Total | $\u00a01,364.48 |',
                '',
                '| Description | Quantity | Subtotal |',
                '| --- | --: | --: |',
                '| Screens<br>Noise-reducing | 3 | $\u00a0825.00 |',
                '| **Services** |  |  |',
                '| *Delivered Monday* |  |  |',
                '',
                '*From Odoo, updated Oct 29, 2026, 2:05 PM.* [Open in Odoo](https://odoo.example.com/odoo/sale.order/1)',
                '<!-- /odoo:sale.order -->',
            ].join('\n'));
        });

        it('renders as two tables and nothing else visible', () => {
            const html = renderDocumentHtml(buildBlockMarkdown(snapshot(), OPTIONS));
            expect(html.match(/<table>/g)).toHaveLength(2);
            expect(html).toContain('<td>Screens<br>Noise-reducing</td>');
            expect(html).toContain('<td style="text-align:right">$\u00a0825.00</td>');
            // The markers stay as HTML comments, which no output shows.
            expect(html.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('odoo:');
        });

        it('leaves out the lines table when no column is chosen', () => {
            const markdown = buildBlockMarkdown(snapshot({ columns: [], lines: [] }), OPTIONS);
            expect(renderDocumentHtml(markdown).match(/<table>/g)).toHaveLength(1);
        });

        it('says when lines were cut off, and drops a link that is not http(s)', () => {
            const markdown = buildBlockMarkdown(snapshot({ truncated: true, order: { id: 1, name: 'S1', url: 'javascript:alert(1)' } }), OPTIONS);
            expect(markdown).toContain('Only the first 500 lines are shown.');
            expect(markdown).not.toContain('Open in Odoo');
        });

        it('round-trips through findBlocks', () => {
            const [block] = findBlocks(`# Quote\n\n${buildBlockMarkdown(snapshot(), OPTIONS)}\n\nThanks`);
            expect(block.closed).toBe(true);
            expect(block.config).toEqual({ id: 1, ref: 'S00001', fields: ['partner_id', 'amount_total'], columns: ['name', 'product_uom_qty', 'price_subtotal'] });
        });

        it('keeps the settings comment open until its own end, whatever the reference says', () => {
            const markdown = buildBlockMarkdown(snapshot({ order: { id: 1, name: 'S1 --> <b>x</b>', url: '' } }), OPTIONS);
            expect(markdown.split('\n')[0]).not.toMatch(/-->.*-->/);
            expect(findBlocks(markdown)[0].config.ref).toBe('S1 --> <b>x</b>');
        });
    });

    describe('Odoo data cannot escape its cell', () => {
        const hostile = [
            '<img src=x onerror=alert(1)>',
            'a | b',
            '[click](javascript:alert(1))',
            '![x](https://evil.example/x.png)',
            '`code` *bold* _em_ ~~gone~~',
            '{{ title }}',
            '<!-- /odoo:sale.order -->',
            'line\n<!-- /odoo:sale.order -->\n| fake | row |',
        ];

        it.each(hostile)('%s', (value) => {
            const data = snapshot({ fields: [{ name: 'partner_id', label: value, cell: { type: 'text', value } }] });
            const markdown = buildBlockMarkdown(data, OPTIONS);
            const blocks = findBlocks(markdown);
            expect(blocks).toHaveLength(1);
            expect(blocks[0].raw).toBe(markdown);
            const html = renderDocumentHtml(applyDocumentVariables(markdown, { globals: { title: 'SUBSTITUTED' } }));
            expect(html).not.toMatch(/<img|<a href="javascript|<code>|<strong>bold|<em>em|<s>|SUBSTITUTED/);
            // Still exactly the header row, the value row and the lines table's rows.
            expect(html.match(/<tr>/g)).toHaveLength(2 + 1 + 3);
        });

        it('escapeCell keeps ordinary punctuation readable', () => {
            expect(escapeCell('[FURN_6667] Chair (Black) - #1 & more > less')).toBe('[FURN_6667] Chair (Black) - #1 & more > less');
            expect(escapeCell('  one\r\n\r\n two  ')).toBe('one<br>two');
        });

        it('escapeCell escapes only what would take effect', () => {
            expect(escapeCell('<b>')).toBe('&lt;b>');
            expect(escapeCell('&copy; & &#169;')).toBe('&amp;copy; & &amp;#169;');
            expect(escapeCell('{x} {{y}}')).toBe('{x} &#123;{y}}');
            expect(escapeCell('_em_ snake_case')).toBe('\\_em\\_ snake_case');
            expect(escapeCell('[a](b) [c][d] [e]: f [g]')).toBe('[a\\](b) [c\\][d] [e\\]: f [g]');
            expect(escapeCell('a|b *c* `d` ~e~ \\')).toBe('a\\|b \\*c\\* \\`d\\` \\~e\\~ \\\\');
        });
    });

    describe('formatCell', () => {
        it('formats each type in the given locale', () => {
            expect(formatCell(null)).toBe('');
            expect(formatCell({ type: 'number', value: 1.5 }, { locale: 'de-DE' })).toBe('1,5');
            expect(formatCell({ type: 'monetary', value: 1250, currency: { symbol: '€', position: 'after', decimals: 2 } }, { locale: 'de-DE' })).toBe('1.250,00\u00a0€');
            expect(formatCell({ type: 'monetary', value: 3, currency: { symbol: '¥', position: 'before', decimals: 0 } }, { locale: 'en-US' })).toBe('¥\u00a03');
            expect(formatCell({ type: 'date', value: '2026-11-25' }, { locale: 'en-GB' })).toBe('25 Nov 2026');
            expect(formatCell({ type: 'datetime', value: '2026-09-26T21:41:22Z' }, { locale: 'en-GB', timeZone: 'Europe/Berlin' })).toBe('26 Sept 2026, 23:41');
            expect(formatCell({ type: 'boolean', value: true })).toBe('Yes');
        });
    });

    describe('findBlocks', () => {
        it('finds several blocks with their offsets', () => {
            const one = buildBlockMarkdown(snapshot(), OPTIONS);
            const two = buildBlockMarkdown(snapshot({ order: { id: 2, name: 'S00002', url: '' } }), OPTIONS);
            const text = `Intro\n${one}\nMiddle\n${two}`;
            const blocks = findBlocks(text);
            expect(blocks.map((block) => block.config.id)).toEqual([1, 2]);
            expect(text.slice(blocks[1].start, blocks[1].end)).toBe(two);
        });

        it('marks damaged settings and an unclosed block', () => {
            const text = [
                '<!-- odoo:sale.order {not json} -->', '| a |', '<!-- /odoo:sale.order -->',
                '<!-- odoo:sale.order {"v":1,"id":3,"ref":"S3","fields":[],"columns":[]} -->', 'no end',
            ].join('\n');
            const blocks = findBlocks(text);
            expect(blocks).toHaveLength(2);
            expect(blocks[0]).toMatchObject({ config: null, closed: true });
            expect(blocks[1]).toMatchObject({ closed: false, config: { id: 3 } });
        });

        it('ignores markers that are not on a line of their own', () => {
            expect(findBlocks('see <!-- odoo:sale.order {"v":1} --> here')).toEqual([]);
        });
    });

    it('parseConfig refuses anything but the expected shape', () => {
        const ok = { v: 1, id: 4, ref: 'S4', fields: ['partner_id'], columns: ['name'] };
        expect(parseConfig(ok)).toEqual({ id: 4, ref: 'S4', fields: ['partner_id'], columns: ['name'] });
        for (const bad of [null, { ...ok, v: 2 }, { ...ok, id: -1 }, { ...ok, id: '4' }, { ...ok, fields: ['Bad Name'] }, { ...ok, columns: 'name' }]) {
            expect(parseConfig(bad)).toBeNull();
        }
    });

    describe('insertBlock', () => {
        it('inserts after the cursor’s line, as its own paragraph', () => {
            const next = insertBlock({ value: 'Hello world\nNext', selectionStart: 3, selectionEnd: 3 }, 'BLOCK');
            expect(next.value).toBe('Hello world\n\nBLOCK\n\nNext');
            expect(next.selectionStart).toBe('Hello world\n\nBLOCK'.length);
        });

        it('inserts into an empty Document and at the end', () => {
            expect(insertBlock({ value: '', selectionStart: 0, selectionEnd: 0 }, 'BLOCK').value).toBe('BLOCK\n');
            expect(insertBlock({ value: 'Text\n', selectionStart: 5, selectionEnd: 5 }, 'BLOCK').value).toBe('Text\n\nBLOCK\n');
        });
    });

    describe('replaceBlock', () => {
        const block = buildBlockMarkdown(snapshot(), OPTIONS);
        const text = `Before\n\n${block}\n\nAfter`;

        it('replaces only the block and keeps the cursor where it was', () => {
            const [found] = findBlocks(text);
            const cursor = text.length;
            const next = replaceBlock({ value: text, selectionStart: cursor, selectionEnd: cursor }, found, 'NEW');
            expect(next.value).toBe('Before\n\nNEW\n\nAfter');
            expect(next.selectionStart).toBe(next.value.length);
        });

        it('finds the block when text before it changed', () => {
            const [found] = findBlocks(text);
            const edited = `Added a line\n${text}`;
            expect(replaceBlock({ value: edited, selectionStart: 0, selectionEnd: 0 }, found, 'NEW').value).toBe('Added a line\nBefore\n\nNEW\n\nAfter');
        });

        it('gives up when the block was edited or removed meanwhile, or never closed', () => {
            const [found] = findBlocks(text);
            expect(replaceBlock({ value: text.replace('Azure', 'Blue'), selectionStart: 0, selectionEnd: 0 }, found, 'NEW')).toBeNull();
            expect(replaceBlock({ value: 'Before\n\nAfter', selectionStart: 0, selectionEnd: 0 }, found, 'NEW')).toBeNull();
            expect(replaceBlock({ value: text, selectionStart: 0, selectionEnd: 0 }, { ...found, closed: false }, 'NEW')).toBeNull();
        });
    });
});
