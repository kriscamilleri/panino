/**
 * Inline hints for the Print Styles page: the structured settings are checked with the
 * same rules the server applies, so a value the server would silently replace with its
 * default is shown as invalid while it is typed.
 */
import { validatePrintStyleValue } from '@panino/content-merge/print-style-rules';

const STRUCTURED_KEYS = new Set([
    'pageSize', 'pageMargin', 'headerHeight', 'footerHeight',
    'headerFontColor', 'footerFontColor', 'headerFontSize', 'footerFontSize',
    'headerAlign', 'footerAlign', 'googleFontFamily',
]);

/**
 * @param {string} key print-style setting key
 * @param {unknown} value the current field value
 * @returns {string|null} a hint when the server would replace or trim the value, else null
 */
export function printStyleFieldHint(key, value) {
    if (!STRUCTURED_KEYS.has(key)) return null;
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const result = validatePrintStyleValue(key, value);
    if (!result.ok) return `Not used in the PDF (the default applies): ${result.reason}.`;
    if (result.dropped?.length) return `Ignored in the PDF: ${result.dropped.join(', ')}.`;
    return null;
}
