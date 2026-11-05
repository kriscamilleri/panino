/**
 * The inline styling the Preview and the PDF export put on rendered elements:
 * one `style` attribute per element kind from a style map (`h1`, `p`, `ul`,
 * `table`, …), `target="_blank" rel="noopener noreferrer"` on external links.
 * Shared so the API's server-side PDFs (Odoo syncs) look like a person's own
 * export. The browser adds its own concerns on top (image auth tokens, global
 * CSS injection) through the hooks.
 */

/**
 * @param {import('markdown-it')} md a renderer from `createDocumentRenderer`
 * @param {Object<string, string>} styleMap element kind → CSS declarations
 * @param {{ rewriteImageSrc?: (src: string) => string }} [hooks]
 * @returns {import('markdown-it')} the same renderer
 */
export function applyStyleMap(md, styleMap, { rewriteImageSrc } = {}) {
    const styles = styleMap || {};

    const wrapRule = (ruleName, styleKey) => {
        const originalRule = md.renderer.rules[ruleName] || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
        md.renderer.rules[ruleName] = (tokens, idx, options, env, self) => {
            const css = styles[styleKey];
            if (css) tokens[idx].attrSet('style', css);
            return originalRule(tokens, idx, options, env, self);
        };
    };

    // Headings carry their own tag name (h1, h2, …).
    const originalHeadingOpen = md.renderer.rules.heading_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
    md.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
        const token = tokens[idx];
        const css = styles[token.tag];
        if (css) token.attrSet('style', css);
        return originalHeadingOpen(tokens, idx, opts, env, self);
    };

    wrapRule('paragraph_open', 'p');
    wrapRule('bullet_list_open', 'ul');
    wrapRule('ordered_list_open', 'ol');
    wrapRule('list_item_open', 'li');
    wrapRule('blockquote_open', 'blockquote');
    wrapRule('em_open', 'em');
    wrapRule('strong_open', 'strong');
    wrapRule('code_inline', 'code');
    wrapRule('hr', 'hr');

    // Code blocks: ``` fences and indented blocks both take the `pre` style.
    wrapRule('fence', 'pre');
    wrapRule('code_block', 'pre');

    const originalLinkOpen = md.renderer.rules.link_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const css = styles.a;
        if (css) tokens[idx].attrSet('style', css);
        const href = tokens[idx].attrGet('href');
        if (href && (href.startsWith('http') || href.startsWith('//'))) {
            tokens[idx].attrSet('target', '_blank');
            tokens[idx].attrSet('rel', 'noopener noreferrer');
        }
        return originalLinkOpen(tokens, idx, options, env, self);
    };

    const originalImage = md.renderer.rules.image || ((t, i, o, e, s) => s.renderToken(t, i, o));
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const srcIndex = token.attrIndex('src');
        if (srcIndex >= 0 && rewriteImageSrc) {
            token.attrs[srcIndex][1] = rewriteImageSrc(token.attrs[srcIndex][1]);
        }
        const css = styles.img;
        if (css) token.attrSet('style', css);
        return originalImage(tokens, idx, options, env, self);
    };

    wrapRule('table_open', 'table');
    wrapRule('tr_open', 'tr');
    wrapRule('th_open', 'th');
    wrapRule('td_open', 'td');
    return md;
}
