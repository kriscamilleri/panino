import { describe, expect, it } from 'vitest';
import {
    APP_ROUTE_LINK_TITLE,
    findDocumentLinkIds,
    formatDocumentHref,
    isDocumentId,
    parseDocumentHref,
} from '../documentLinks.js';
import { createDocumentRenderer, renderDocumentHtml } from '../markdownRender.js';
import { applyStyleMap } from '../styledRenderer.js';

const ID = '6f1c2a3b-1d2e-4f5a-8b6c-7d8e9f0a1b2c';
const OTHER = '11111111-2222-4333-8444-555555555555';

describe('Document addresses', () => {
    it('parses valid addresses, uppercase UUIDs and encoded slugs', () => {
        expect(parseDocumentHref(`panino:doc/${ID}`)).toEqual({ kind: 'doc', id: ID, heading: null });
        expect(parseDocumentHref(`PANINO:doc/${ID.toUpperCase()}#budget`)).toEqual({ kind: 'doc', id: ID, heading: 'budget' });
        expect(parseDocumentHref(`panino:doc/${ID}#bud%C3%A9get`)).toEqual({ kind: 'doc', id: ID, heading: 'budéget' });
    });

    it('marks every other panino: address invalid and ignores other schemes', () => {
        expect(parseDocumentHref('panino:doc/not-a-uuid')).toEqual({ kind: 'invalid' });
        expect(parseDocumentHref(`panino:folder/${ID}`)).toEqual({ kind: 'invalid' });
        expect(parseDocumentHref(`panino:doc/${ID}#bad slug`)).toEqual({ kind: 'invalid' });
        expect(parseDocumentHref(`panino:doc/${ID}#%E0%A4%A`)).toEqual({ kind: 'invalid' });
        expect(parseDocumentHref(`panino:doc/${ID}x`)).toEqual({ kind: 'invalid' });
        expect(parseDocumentHref('https://panino.sh')).toBeNull();
        expect(parseDocumentHref('#budget')).toBeNull();
        expect(parseDocumentHref(undefined)).toBeNull();
    });

    it('formats addresses only from a valid id and slug', () => {
        expect(formatDocumentHref(ID.toUpperCase())).toBe(`panino:doc/${ID}`);
        expect(formatDocumentHref(ID, 'budget')).toBe(`panino:doc/${ID}#budget`);
        expect(() => formatDocumentHref('nope')).toThrow();
        expect(() => formatDocumentHref(ID, 'a b')).toThrow();
        expect(isDocumentId(ID)).toBe(true);
        expect(isDocumentId(`${ID} `)).toBe(false);
    });

    it('finds linked ids without duplicates', () => {
        expect(findDocumentLinkIds(`[a](panino:doc/${ID}) [b](PANINO:DOC/${ID.toUpperCase()}#x) [c](panino:doc/${OTHER}) panino:doc/bad`)).toEqual([ID, OTHER]);
        expect(findDocumentLinkIds('panino:doc/'.repeat(200000))).toEqual([]);
    });
});

describe('rendering Document links', () => {
    const source = `[Plan](panino:doc/${ID}) [Budget](panino:doc/${ID}#budget) [Bad](panino:doc/nope) [Screen](#/settings) [Out](https://example.com)`;

    it("'app': routes with data attributes, built from the validated parts", () => {
        const html = renderDocumentHtml(source, { documentLinks: 'app' });
        expect(html).toContain(`<a href="#/doc/${ID}" class="pn-doc-link" data-pn-doc="${ID}">Plan</a>`);
        expect(html).toContain(`<a href="#/doc/${ID}?heading=budget" class="pn-doc-link" data-pn-doc="${ID}" data-pn-heading="budget">Budget</a>`);
        expect(html).toContain('<span class="pn-link-broken">Bad</span>');
        expect(html).toContain(`<span class="pn-link-broken" title="${APP_ROUTE_LINK_TITLE.replace("'", "'")}">Screen</span>`);
        expect(html).toContain('<a href="https://example.com">Out</a>');
    });

    it("'pdf': no href, and only for ids the caller resolved", () => {
        const all = renderDocumentHtml(source, { documentLinks: 'pdf' });
        expect(all).toContain(`<a class="pn-doc-link" data-pn-doc="${ID}">Plan</a>`);
        expect(all).not.toContain(`href="panino:`);
        const none = renderDocumentHtml(source, { documentLinks: 'pdf', env: { resolvedDocumentIds: new Set([OTHER]) } });
        expect(none).toContain('<span class="pn-doc-link">Plan</span>');
        const some = renderDocumentHtml(source, { documentLinks: 'pdf', env: { resolvedDocumentIds: new Set([ID]) } });
        expect(some).toContain(`<a class="pn-doc-link" data-pn-doc="${ID}" data-pn-heading="budget">Budget</a>`);
    });

    it("'text' (the default): a span with the label", () => {
        const html = renderDocumentHtml(source);
        expect(html).toContain('<span class="pn-doc-link">Plan</span>');
        expect(html).toContain('<span class="pn-doc-link">Budget</span>');
        expect(html).not.toContain('panino:');
    });

    it('treats a link to a heading of this Document as an in-Document link', () => {
        const html = renderDocumentHtml(`[Here](panino:doc/${ID}#budget) [Gone](panino:doc/${ID}#gone)\n\n## Budget\n`, {
            documentLinks: 'pdf',
            env: { documentId: ID, resolvedDocumentIds: new Set() },
        });
        expect(html).toContain('<a href="#pn-budget" data-pn-heading="budget">Here</a>');
        expect(html).toContain('<a href="#pn-gone" data-pn-heading="gone" class="pn-link-broken">Gone</a>');
    });

    it('never copies the author\'s string into an href', () => {
        const html = renderDocumentHtml(`[x](panino:doc/${ID}#"onmouseover=alert(1)) [y](panino:doc/${ID}%22onclick=x)`, { documentLinks: 'app' });
        expect(html).not.toContain('onmouseover');
        expect(html).not.toContain('onclick');
    });

    it('keeps external links opening in a new tab under the styled renderer', () => {
        const md = applyStyleMap(createDocumentRenderer({ documentLinks: 'app' }), { a: 'color: blue' });
        const html = md.render(`[out](https://x.y) [doc](panino:doc/${ID}) [bad](panino:x)`);
        expect(html).toContain('<a href="https://x.y" style="color: blue" target="_blank" rel="noopener noreferrer">out</a>');
        expect(html).toContain(`<a href="#/doc/${ID}" class="pn-doc-link" data-pn-doc="${ID}" style="color: blue">doc</a>`);
        // A broken link is a span, so it takes no link style.
        expect(html).toContain('<span class="pn-link-broken">bad</span>');
    });

    it('handles links nested in emphasis and images inside links', () => {
        const html = renderDocumentHtml(`**[a *b*](panino:doc/nope)** [![i](x.png)](#/x)`);
        expect(html).toContain('<strong><span class="pn-link-broken">a <em>b</em></span></strong>');
        expect(html).toContain('<img src="x.png" alt="i"></span>');
    });
});
