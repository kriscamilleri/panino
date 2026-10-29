import { describe, expect, it } from 'vitest';
import { IMAGE_PLACEHOLDER, articleBody, bodySignature } from '../../knowledge.js';

describe('articleBody', () => {
    it('drops a first heading that repeats the title, and only that one', () => {
        expect(articleBody('<h1>Quote  for Acme</h1><p>Hello</p><h1>Quote for Acme</h1>', 'quote for acme'))
            .toBe('<p>Hello</p><h1>Quote for Acme</h1>');
        expect(articleBody('<h1>Something else</h1><p>Hello</p>', 'Quote')).toBe('<h1>Something else</h1><p>Hello</p>');
        expect(articleBody('<p>Intro</p><h1>Quote</h1>', 'Quote')).toBe('<p>Intro</p><h1>Quote</h1>');
    });

    it('turns task lists into Knowledge checklists', () => {
        const html = '<ul class="contains-task-list">\n'
            + '<li class="task-list-item"><input class="task-list-item-checkbox" disabled="" type="checkbox"> open</li>\n'
            + '<li class="task-list-item"><input class="task-list-item-checkbox" checked="" disabled="" type="checkbox"> <strong>done</strong></li>\n'
            + '</ul><ol class="contains-task-list"><li class="task-list-item"><input checked="" type="checkbox"> ordered</li></ol>';
        expect(articleBody(html, 'T')).toBe(
            '<ul class="o_checklist"><li>open</li><li class="o_checked"><strong>done</strong></li></ul>'
            + '<ul class="o_checklist"><li class="o_checked">ordered</li></ul>',
        );
    });

    it('replaces Panino images with placeholders, keeps external ones, and keeps lists, tables and code', () => {
        const html = '<p><img src="/images/a.png" alt="Diagram"></p><p><img src="https://x/y.png"></p><p><img src="data:image/png;base64,AAAA"></p>'
            + '<ul><li>a</li></ul><table><thead><tr><th>h</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><pre><code>x = 1</code></pre>';
        expect(articleBody(html, 'T')).toBe(
            `<p><span class="o_panino_image_placeholder">${IMAGE_PLACEHOLDER}: Diagram</span></p>`
            + '<p><img src="https://x/y.png"></p>'
            + `<p><span class="o_panino_image_placeholder">${IMAGE_PLACEHOLDER}</span></p>`
            + '<ul><li>a</li></ul><table><thead><tr><th>h</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><pre><code>x = 1</code></pre>',
        );
    });

    it('keeps Panino images for upload when asked, and only those', () => {
        const id = '11111111-1111-4111-8111-111111111111';
        const html = `<p><img src="/images/${id}" alt="Mine"><img src="/images/not-an-id.png" alt="Odd"><img src="https://x/y.png"></p>`;
        expect(articleBody(html, 'T', { keepInternalImages: true })).toBe(
            `<p><img src="/images/${id}" alt="Mine"><span class="o_panino_image_placeholder">${IMAGE_PLACEHOLDER}: Odd</span><img src="https://x/y.png"></p>`,
        );
    });

    it('strips scripts, styles, event handlers and unsafe links', () => {
        const html = '<style>p{color:red}</style><p style="color:red" onclick="x()">Hi <a href="javascript:alert(1)">bad</a> '
            + '<a href="https://example.com">good</a> <a href="mailto:a@b.c">mail</a></p><script>alert(1)</script>'
            + '<iframe src="https://x"></iframe><input type="text" value="x"><img src="x" onerror="alert(1)">';
        expect(articleBody(html, 'T')).toBe(
            '<p>Hi <a>bad</a> <a href="https://example.com" target="_blank" rel="noopener noreferrer">good</a> '
            + `<a href="mailto:a@b.c" target="_blank" rel="noopener noreferrer">mail</a></p><span class="o_panino_image_placeholder">${IMAGE_PLACEHOLDER}</span>`,
        );
    });

    it('copes with nothing', () => {
        expect(articleBody(undefined, 'T')).toBe('');
        expect(articleBody('', '')).toBe('');
        expect(articleBody('<h1>T</h1>', 'T')).toBe('');
    });
});

describe('bodySignature', () => {
    it('ignores Odoo’s formatting, editor attributes and image ids, but not words or structure', () => {
        const ours = '<h2>Plan</h2>\n<p>Hello <strong>there</strong></p>\n<ul class="o_checklist"><li class="o_checked">done</li></ul>';
        const theirs = '<h2 data-oe-protected="false">Plan</h2><p contenteditable="true">Hello  <strong>there</strong></p>\n<ul class=" o_checklist "  data-x="1">\n  <li class="o_checked">done</li>\n</ul>';
        expect(bodySignature(theirs)).toBe(bodySignature(ours));
        expect(bodySignature('<p>Hello <strong>here</strong></p>')).not.toBe(bodySignature('<p>Hello <strong>there</strong></p>'));
        expect(bodySignature('<p>one</p><p>two</p>')).not.toBe(bodySignature('<p>one two</p>'));
        expect(bodySignature('<ul><li>a</li></ul>')).not.toBe(bodySignature('<ol><li>a</li></ol>'));

        const withImages = '<p><img src="/images/4b1e4d2a-6c1f-4a8e-9d3b-2f7c1e5a9b01" alt="Floor"></p><p><img src="https://example.com/x.png" alt="x"></p>';
        const inOdoo = '<p><img src="/web/image/512-9f8e/plan.png" alt="Floor" class="img-fluid"></p><p><img src="https://example.com/x.png" alt="x"></p>';
        expect(bodySignature(inOdoo)).toBe(bodySignature(withImages));
        expect(bodySignature('<p><img src="https://example.com/other.png" alt="x"></p>')).not.toBe(bodySignature('<p><img src="https://example.com/x.png" alt="x"></p>'));
        // An image Panino could not send is a placeholder in Odoo; that is not drift either.
        expect(bodySignature('<p><span class="o_panino_image_placeholder">Image not sent: Floor</span></p>')).toBe(bodySignature('<p><img src="/images/4b1e4d2a-6c1f-4a8e-9d3b-2f7c1e5a9b01" alt="Floor"></p>'));
        expect(bodySignature('<p>text</p>')).not.toBe(bodySignature('<p><img src="/images/4b1e4d2a-6c1f-4a8e-9d3b-2f7c1e5a9b01" alt="Floor"></p>'));
    });

    it('treats an empty article as empty however Odoo stores it', () => {
        expect(bodySignature(false)).toBe('');
        expect(bodySignature('')).toBe('');
        expect(bodySignature('<p><br></p>')).toBe('');
        expect(bodySignature('<p>\n</p><div></div>')).toBe('');
        expect(bodySignature('<p>x</p>')).not.toBe('');
    });
});
