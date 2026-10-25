import { describe, expect, it } from 'vitest';
import {
    parseLength,
    parseColor,
    parseFontSize,
    parseAlign,
    parsePaperSize,
    parseFontFamilies,
    validatePrintStyleValue,
    validatePrintStyles,
    PRINT_ELEMENT_KEYS,
} from '../printStyleRules.js';

const DEFAULTS = {
    h1: 'font-size: 2rem;',
    p: 'margin: 0;',
    customCSS: 'body { color: #111 }',
    googleFontFamily: 'Source Sans 3, Lora',
    printHeaderHtml: 'Header',
    printFooterHtml: 'Page %p of %P',
    headerFontSize: '10',
    headerFontColor: '#666666',
    headerAlign: 'center',
    footerFontSize: '10',
    footerFontColor: '#666666',
    footerAlign: 'center',
    headerHeight: '2cm',
    footerHeight: '2.5cm',
    pageMargin: '2cm',
    enablePageNumbers: true,
};

describe('parseLength', () => {
    it('accepts plain lengths in the print units', () => {
        for (const v of ['2cm', '15mm', '0.5in', '12pt', '20px', '.5cm', ' 2cm ', '0']) {
            expect(parseLength(v), v).not.toBeNull();
        }
    });
    it('rejects anything that is not a plain length', () => {
        for (const v of ['2em', '10%', '2cm; color: red', '2cm }', 'calc(1cm + 1px)', '-1cm', 'auto', '', 2, null]) {
            expect(parseLength(v), String(v)).toBeNull();
        }
    });
});

describe('parseColor', () => {
    it('accepts hex and rgb()/rgba() colours', () => {
        for (const v of ['#666', '#666666', '#66666680', '#ABCDEF', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'rgba(1, 2, 3, 1)', 'rgb(10%, 20%, 30%)']) {
            expect(parseColor(v), v).not.toBeNull();
        }
    });
    it('rejects break-outs and other syntax', () => {
        for (const v of ['red', '#666; background: url(http://evil)', '#666" onload="x', 'rgb(var(--x), 0, 0)', 'url(http://evil)', 'hsl(1, 2%, 3%)']) {
            expect(parseColor(v), v).toBeNull();
        }
    });
});

describe('parseFontSize', () => {
    it('accepts integers from 6 to 72, as strings or numbers', () => {
        expect(parseFontSize('10')).toBe('10');
        expect(parseFontSize(12)).toBe('12');
        expect(parseFontSize('6')).toBe('6');
        expect(parseFontSize('72')).toBe('72');
    });
    it('rejects values outside the range and non-integers', () => {
        for (const v of ['5', '73', '10.5', '10px', '10; color: red', '', null]) {
            expect(parseFontSize(v), String(v)).toBeNull();
        }
    });
});

describe('parseAlign and parsePaperSize', () => {
    it('normalise the allowed values', () => {
        expect(parseAlign('Left')).toBe('left');
        expect(parseAlign('justify')).toBeNull();
        expect(parsePaperSize('Letter')).toBe('Letter');
        expect(parsePaperSize('A3')).toBeNull();
        expect(parsePaperSize('A4; margin: 0')).toBeNull();
    });
});

describe('parseFontFamilies', () => {
    it('keeps word, space and hyphen names and drops the rest', () => {
        expect(parseFontFamilies('Source Sans 3, Lora')).toEqual({ value: 'Source Sans 3, Lora', dropped: [] });
        expect(parseFontFamilies('Lora, "Evil"; }, Open-Sans')).toEqual({ value: 'Lora, Open-Sans', dropped: ['"Evil"; }'] });
        expect(parseFontFamilies('</style><script>')).toBeNull();
        expect(parseFontFamilies('')).toBeNull();
    });
});

describe('validatePrintStyleValue', () => {
    it('accepts any string for element keys and free text', () => {
        for (const key of PRINT_ELEMENT_KEYS) {
            expect(validatePrintStyleValue(key, 'color: red }').ok).toBe(true);
        }
        expect(validatePrintStyleValue('customCSS', 'anything').ok).toBe(true);
        expect(validatePrintStyleValue('h1', 12).ok).toBe(false);
    });
    it('rejects unknown keys', () => {
        expect(validatePrintStyleValue('headerText', 'x')).toEqual({ ok: false, reason: 'unknown setting' });
        expect(validatePrintStyleValue('__proto__', 'x').ok).toBe(false);
    });
    it('coerces enablePageNumbers to a boolean', () => {
        expect(validatePrintStyleValue('enablePageNumbers', 'true')).toEqual({ ok: true, value: true });
        expect(validatePrintStyleValue('enablePageNumbers', 'yes')).toEqual({ ok: true, value: false });
    });
});

describe('validatePrintStyles', () => {
    it('returns the defaults for a missing or malformed object', () => {
        expect(validatePrintStyles(undefined, DEFAULTS).styles).toEqual(DEFAULTS);
        expect(validatePrintStyles([], DEFAULTS).styles).toEqual(DEFAULTS);
        expect(validatePrintStyles('x', DEFAULTS).styles).toEqual(DEFAULTS);
    });

    it('falls back to the default for each malformed structured field and reports it', () => {
        const { styles, invalid } = validatePrintStyles({
            pageSize: 'A3',
            pageMargin: '2cm; } body { background: url(http://evil) }',
            headerHeight: '1.5em',
            footerHeight: '3cm',
            headerFontColor: '#666" onload="x',
            footerFontColor: 'rgb(1,2,3)',
            headerFontSize: '200',
            footerFontSize: 12,
            headerAlign: 'justify',
            googleFontFamily: 'Lora, Bad"Name',
            headerText: 'unknown key',
        }, DEFAULTS);

        expect(styles.pageSize).toBeUndefined();
        expect(styles.pageMargin).toBe('2cm');
        expect(styles.headerHeight).toBe('2cm');
        expect(styles.footerHeight).toBe('3cm');
        expect(styles.headerFontColor).toBe('#666666');
        expect(styles.footerFontColor).toBe('rgb(1,2,3)');
        expect(styles.headerFontSize).toBe('10');
        expect(styles.footerFontSize).toBe('12');
        expect(styles.headerAlign).toBe('center');
        expect(styles.googleFontFamily).toBe('Lora');
        expect(styles).not.toHaveProperty('headerText');

        const keys = invalid.map(i => i.key).sort();
        expect(keys).toEqual(['googleFontFamily', 'headerAlign', 'headerFontColor', 'headerFontSize', 'headerHeight', 'headerText', 'pageMargin', 'pageSize']);
    });

    it('keeps valid values and lets empty text switch a field off', () => {
        const { styles, invalid } = validatePrintStyles({
            pageSize: 'Letter',
            printHeaderHtml: '',
            printFooterHtml: '<b>Page %p</b>',
            customCSS: '',
            googleFontFamily: '',
            h1: 'color: red;',
            enablePageNumbers: false,
        }, DEFAULTS);
        expect(invalid).toEqual([]);
        expect(styles.pageSize).toBe('Letter');
        expect(styles.printHeaderHtml).toBe('');
        expect(styles.printFooterHtml).toBe('<b>Page %p</b>');
        expect(styles.customCSS).toBe('');
        expect(styles.googleFontFamily).toBe('');
        expect(styles.h1).toBe('color: red;');
        expect(styles.enablePageNumbers).toBe(false);
        expect(styles.p).toBe(DEFAULTS.p);
    });

    it('does not let input mutate the defaults object', () => {
        const defaults = { ...DEFAULTS };
        validatePrintStyles({ h1: 'x' }, defaults);
        expect(defaults).toEqual(DEFAULTS);
    });
});
