import { describe, expect, it } from 'vitest';
import { IMAGE_PLACEHOLDER, articleBody } from '../../odooKnowledge.js';

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
