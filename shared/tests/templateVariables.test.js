import { describe, expect, it } from 'vitest';
import {
    extractInputLabels,
    formatDate,
    resolveTemplateTitle,
    resolveTemplateVariables,
} from '../templateVariables.js';

// The frontend's own suite (frontend/tests/unit/templateVariables.test.js) still runs
// against these functions through its re-export; this covers what the API relies on.
const fixed = () => new Date(2026, 10, 7, 9, 5, 3);

describe('resolveTemplateVariables', () => {
    it('fills dates from the clock it is given, and inputs by label', () => {
        const out = resolveTemplateVariables(
            '# {{input:Client}} — {{today:dd-MM-yyyy}} {{now:HH:mm}}\n{{input:Client}}',
            { Client: 'Acme' },
            { now: fixed },
        );
        expect(out).toBe('# Acme — 07-11-2026 09:05\nAcme');
    });

    it('keeps $ patterns in a value literal', () => {
        expect(resolveTemplateVariables('Price: {{input:Price}}', { Price: "$& $1 $' $$" })).toBe("Price: $& $1 $' $$");
    });

    it('leaves global variables and unknown placeholders for render time', () => {
        expect(resolveTemplateVariables('{{ company }} {{input:Missing}}', {})).toBe('{{ company }} {{input:Missing}}');
    });

    it('treats a missing body as empty', () => {
        expect(resolveTemplateVariables(undefined)).toBe('');
    });
});

describe('resolveTemplateTitle', () => {
    it('uses the title pattern with placeholders filled', () => {
        expect(resolveTemplateTitle({ name: 'Bug', titlePattern: ' Bug: {{input:Title}} ' }, { Title: 'Login' })).toBe('Bug: Login');
        expect(resolveTemplateTitle({ name: 'Journal', titlePattern: 'Journal {{today:yyyy-MM-dd}}' }, {}, { now: fixed })).toBe('Journal 2026-11-07');
    });

    it('falls back to the template name when there is no pattern or it comes out empty', () => {
        expect(resolveTemplateTitle({ name: 'Meeting', titlePattern: '' })).toBe('Meeting');
        expect(resolveTemplateTitle({ name: 'Meeting', titlePattern: '   ' })).toBe('Meeting');
        expect(resolveTemplateTitle({ name: 'Meeting', titlePattern: '{{input:Topic}}' }, { Topic: '  ' })).toBe('Meeting');
    });
});

describe('extractInputLabels and formatDate', () => {
    it('lists labels from the body and the title pattern once each, in order', () => {
        expect(extractInputLabels('{{input:B}} {{input:A}}', '{{input:A}} {{input:C}}')).toEqual(['B', 'A', 'C']);
        expect(extractInputLabels(undefined, undefined)).toEqual([]);
    });

    it('formats with the simple tokens', () => {
        expect(formatDate(fixed(), 'yyyy/MM/dd HH:mm:ss yy')).toBe('2026/11/07 09:05:03 26');
    });
});
