import { describe, it, expect } from 'vitest';
import { printStyleFieldHint } from '@/utils/printStyleValidation';

describe('printStyleFieldHint', () => {
    it('is silent for valid and empty values and for free-text fields', () => {
        expect(printStyleFieldHint('pageMargin', '2cm')).toBeNull();
        expect(printStyleFieldHint('pageMargin', '')).toBeNull();
        expect(printStyleFieldHint('headerFontColor', '#666666')).toBeNull();
        expect(printStyleFieldHint('headerFontSize', '12')).toBeNull();
        expect(printStyleFieldHint('customCSS', 'anything { at: all }')).toBeNull();
        expect(printStyleFieldHint('printHeaderHtml', '<b>x</b>')).toBeNull();
        expect(printStyleFieldHint('h1', 'color: red')).toBeNull();
    });

    it('explains values the server replaces with its default', () => {
        expect(printStyleFieldHint('pageMargin', '2em')).toMatch(/default applies.*length/);
        expect(printStyleFieldHint('headerHeight', '1.5cm; color: red')).toMatch(/default applies/);
        expect(printStyleFieldHint('headerFontSize', '200')).toMatch(/6 to 72/);
        expect(printStyleFieldHint('footerFontColor', 'red')).toMatch(/hex colour/);
    });

    it('lists font names the server drops', () => {
        expect(printStyleFieldHint('googleFontFamily', 'Lora, "Bad"')).toBe('Ignored in the PDF: "Bad".');
        expect(printStyleFieldHint('googleFontFamily', 'Lora, Open Sans')).toBeNull();
        expect(printStyleFieldHint('googleFontFamily', '</style>')).toMatch(/default applies/);
    });
});
