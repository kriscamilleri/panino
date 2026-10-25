import { describe, it, expect } from 'vitest';
import * as csstree from 'css-tree';
import {
    sanitizeStylesheet,
    sanitizeDeclarations,
    isAllowedRendererRequest,
    isAllowedCssUrl,
    isAllowedImport,
    describeBlockedUrl,
    CSS_LIMITS,
} from '../../pdfSanitize.js';

/** Parse strictly: throws when the CSS is not a single well-formed stylesheet. */
function parsesCleanly(css, context = 'stylesheet') {
    let errors = 0;
    const ast = csstree.parse(css, {
        context,
        parseValue: true,
        parseAtrulePrelude: true,
        parseRulePrelude: true,
        parseCustomProperty: true,
        onParseError() { errors += 1; },
    });
    let raw = 0;
    csstree.walk(ast, node => { if (node.type === 'Raw') raw += 1; });
    return errors === 0 && raw === 0;
}

const BREAKOUTS = [
    '</style><script>alert(1)</script><style>',
    'a{color:red} </style><img src=http://127.0.0.1:1/x onerror=alert(1)>',
    'a</style><b{color:red}',
    'p{content:"</style><script>alert(1)</script>"}',
    'p{background:url("</style><script>alert(1)</script>")}',
    'p{background:url(data:text/html,</style><script>alert(1)</script>)}',
    '/* </style> */ p{color:red}',
    'p{--x: </style><script>alert(1)</script>}',
    '@media print { </style> }',
    'p { color: red; } </STYLE ><script>1</script>',
];

describe('sanitizeStylesheet: break-out', () => {
    it.each(BREAKOUTS)('contains no markup after %s', (css) => {
        const out = sanitizeStylesheet(css);
        // `</` is the only sequence that can end a <style> element; other markup-looking
        // text inside a CSS string is inert there.
        expect(out).not.toMatch(/<\//);
        expect(parsesCleanly(out)).toBe(true);
    });

    it('cannot produce the characters that end a style element even through a nested string', () => {
        const out = sanitizeStylesheet('p{content:"<</style>/style>"}');
        expect(out).not.toMatch(/<\//);
        expect(out).toBe('p{content:"<<\\/style>/style>"}');
    });
});

describe('sanitizeStylesheet: imports and urls', () => {
    it('keeps @import to Google Fonts and drops any other', () => {
        const out = sanitizeStylesheet([
            "@import url('https://fonts.googleapis.com/css2?family=Lora&display=swap');",
            '@import url("https://fonts.googleapis.com/css2?family=Inter");',
            '@import "http://evil.test/x.css";',
            '@import url(http://evil.test/y.css) print;',
            '@import url(https://fonts.gstatic.com/not-a-stylesheet.css);',
            '@import url("HTTPS://FONTS.GOOGLEAPIS.COM.evil.test/css2");',
            'a { color: red }',
        ].join('\n'));
        expect(out).toContain('@import url(https://fonts.googleapis.com/css2?family=Lora&display=swap)');
        expect(out).toContain('@import url(https://fonts.googleapis.com/css2?family=Inter)');
        expect(out).not.toContain('evil.test');
        expect(out).not.toContain('gstatic');
        expect(out).toContain('a{color:red}');
    });

    it('keeps url(data:) and fragment urls and drops http(s) urls at the declaration level', () => {
        const out = sanitizeStylesheet([
            'a { background: url(data:image/png;base64,AAAA); color: red }',
            'b { background-image: url(http://evil.test/a.png); color: blue }',
            'c { background: url("https://evil.test/b.png") }',
            'd { filter: url(#blur) }',
            'e { cursor: url(//evil.test/c.cur), auto }',
            'f { background: image-set("http://evil.test/x.png" 1x) }',
            'g { background: -webkit-image-set(url(http://evil.test/y.png) 1x) }',
            'h { list-style-image: url(javascript:alert(1)) }',
            ':root { --bg: url(http://evil.test/z) }',
        ].join('\n'));
        expect(out).toContain('a{background:url(data:image/png;base64,AAAA);color:red}');
        expect(out).toContain('b{color:blue}');
        expect(out).toContain('c{}');
        expect(out).toContain('d{filter:url(#blur)}');
        expect(out).not.toContain('evil.test');
        expect(out).not.toContain('javascript');
        expect(out).toContain(':root{}');
    });

    it('drops @namespace and @charset', () => {
        const out = sanitizeStylesheet('@charset "utf-8"; @namespace svg url(http://www.w3.org/2000/svg); a{color:red}');
        expect(out).toBe('a{color:red}');
    });
});

describe('sanitizeStylesheet: layout CSS round-trips', () => {
    const LAYOUT = [
        '@page { size: A4; margin: 2cm 1.5cm }',
        '@page :first { margin-top: 4cm }',
        '@media print { h1 { break-before: page; page-break-after: avoid } }',
        '.cols { columns: 2; column-gap: 1.5rem; column-rule: 1px solid #ccc }',
        '.grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-areas: "a b c" "d e f"; gap: 1rem }',
        '.flex { display: flex; justify-content: space-between; align-items: center }',
        '@font-face { font-family: X; src: url(data:font/woff2;base64,AAAA) format("woff2") }',
        'h1 { font-family: "Playfair Display", Georgia, serif; font-size: 2.25rem !important }',
        ':root { --accent: #2563eb } a { color: var(--accent, red) }',
        '@supports (display: grid) { .x { display: grid } }',
        '@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }',
        'table { width: 100%; border-collapse: collapse } td:nth-child(2n+1) { background: rgba(0,0,0,.05) }',
        'pre > code { background: transparent; padding: 0 }',
        '#preview-content, [data-testid="preview-content"] { max-width: 72ch }',
    ];

    it.each(LAYOUT)('keeps the meaning of %s', (css) => {
        const out = sanitizeStylesheet(css);
        // Same AST after whitespace-insensitive generation of the original.
        const expected = csstree.generate(csstree.parse(css, { parseValue: true, parseAtrulePrelude: true, parseCustomProperty: true }));
        expect(out).toBe(expected);
    });

    it('keeps CSS nesting, including rules without a leading &', () => {
        expect(sanitizeStylesheet('.a { color: red; .b { color: blue } }')).toBe('.a{color:red;.b{color:blue}}');
        expect(sanitizeStylesheet('.a { .b { color: blue } color: red }')).toBe('.a{.b{color:blue}color:red}');
        expect(sanitizeStylesheet('.a { color: red; .c & { color: green } }')).toBe('.a{color:red;.c &{color:green}}');
        expect(sanitizeStylesheet('.a { & .b { color: blue } &:hover { color: red } }')).toBe('.a{& .b{color:blue}&:hover{color:red}}');
        expect(sanitizeStylesheet('.a { @media print { .b { color: blue } } }')).toBe('.a{@media print{.b{color:blue}}}');
    });

    it('applies the url policy and break-out rules inside nested rules too', () => {
        expect(sanitizeStylesheet('.a { .b { background: url(http://evil.test/x) } color: red }')).toBe('.a{color:red}');
        const out = sanitizeStylesheet('.a { .b { color: blue } </style><script>alert(1)</script> }');
        expect(out).toBe('.a{.b{color:blue}}');
    });

    it('refuses oversized input before parsing', () => {
        const big = 'p{col or: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx}'.repeat(5000);
        expect(big.length).toBeGreaterThan(CSS_LIMITS.stylesheetBytes);
        const started = Date.now();
        expect(sanitizeStylesheet(big)).toBe('');
        expect(Date.now() - started).toBeLessThan(50);
        expect(sanitizeDeclarations('color: red;'.repeat(2000))).toBe('');
        // Just under the cap still parses in bounded time.
        const under = 'p{col or: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx}'.repeat(4000);
        expect(under.length).toBeLessThan(CSS_LIMITS.stylesheetBytes);
        const t = Date.now();
        sanitizeStylesheet(under);
        expect(Date.now() - t).toBeLessThan(3000);
    });

    it('drops only the broken rule, not the sheet', () => {
        const out = sanitizeStylesheet('a { color: red } b { color: } c { col or: blue } d { color: green }');
        expect(out).toContain('a{color:red}');
        expect(out).toContain('d{color:green}');
    });

    it('returns an empty string for non-strings and blank input', () => {
        expect(sanitizeStylesheet(undefined)).toBe('');
        expect(sanitizeStylesheet(null)).toBe('');
        expect(sanitizeStylesheet(42)).toBe('');
        expect(sanitizeStylesheet('   ')).toBe('');
    });
});

describe('sanitizeDeclarations', () => {
    it('keeps a style attribute value', () => {
        expect(sanitizeDeclarations('width: 120px; border: 3px solid #333;')).toBe('width:120px;border:3px solid #333');
    });

    it('cannot close the rule block or the attribute', () => {
        const out = sanitizeDeclarations('color: red } body { background: url(http://evil.test) } x { a: "</style>');
        expect(out).toBe('');
        // A stray quote becomes a string delimiter in well-formed CSS: the output parses
        // as a declaration list, and the document sanitizer sets attributes through the
        // DOM, so it cannot grow a second attribute (see pdf.test.js).
        const quoted = sanitizeDeclarations('color: red" onload="alert(1)');
        expect(parsesCleanly(quoted, 'declarationList')).toBe(true);
        expect((quoted.match(/"/g) || []).length % 2).toBe(0);
    });

    it('drops urls to external hosts and keeps data urls', () => {
        expect(sanitizeDeclarations('background: url(http://evil.test/x.png); color: red')).toBe('color:red');
        expect(sanitizeDeclarations('background: url(data:image/gif;base64,R0lG)')).toBe('background:url(data:image/gif;base64,R0lG)');
    });

    it('keeps page break declarations used by the pagebreak marker', () => {
        expect(sanitizeDeclarations('break-after: page; page-break-after: always; clear: both;'))
            .toBe('break-after:page;page-break-after:always;clear:both');
    });
});

describe('isAllowedRendererRequest', () => {
    it('allows data: and about: always', () => {
        expect(isAllowedRendererRequest('data:image/png;base64,AAAA', { remoteFonts: false })).toBe(true);
        expect(isAllowedRendererRequest('about:blank', { remoteFonts: false })).toBe(true);
    });
    it('allows Google Fonts only when remote fonts are on', () => {
        const url = 'https://fonts.googleapis.com/css2?family=Lora';
        expect(isAllowedRendererRequest(url, { remoteFonts: true })).toBe(true);
        expect(isAllowedRendererRequest('https://fonts.gstatic.com/s/lora/x.woff2', { remoteFonts: true })).toBe(true);
        expect(isAllowedRendererRequest(url, { remoteFonts: false })).toBe(false);
    });
    it('blocks everything else', () => {
        for (const url of [
            'http://localhost:8000/me',
            'http://127.0.0.1:8000/images/x',
            'http://169.254.169.254/latest/meta-data/',
            'https://fonts.googleapis.com.evil.test/',
            'http://fonts.googleapis.com/css2',
            'https://evil.test/?u=https://fonts.googleapis.com/',
            'file:///etc/passwd',
            'blob:null/x',
            'chrome://version',
            '',
            undefined,
        ]) {
            expect(isAllowedRendererRequest(url, { remoteFonts: true }), String(url)).toBe(false);
        }
    });
});

describe('url helpers', () => {
    it('isAllowedCssUrl and isAllowedImport agree with the policy', () => {
        expect(isAllowedCssUrl('DATA:image/png;base64,AA')).toBe(true);
        expect(isAllowedCssUrl('#id')).toBe(true);
        expect(isAllowedCssUrl('https://fonts.gstatic.com/x')).toBe(true);
        expect(isAllowedCssUrl('https://example.com/x.png')).toBe(false);
        expect(isAllowedCssUrl('')).toBe(false);
        expect(isAllowedImport('https://fonts.googleapis.com/css2?family=X')).toBe(true);
        expect(isAllowedImport('https://fonts.gstatic.com/x.css')).toBe(false);
    });
    it('describeBlockedUrl logs an origin, not a path or query', () => {
        expect(describeBlockedUrl('http://127.0.0.1:8000/images/secret?token=abc')).toBe('http://127.0.0.1:8000');
        expect(describeBlockedUrl('not a url')).toBe('not a url');
        expect(describeBlockedUrl('javascript:alert(1)')).toBe('javascript:');
    });
});
