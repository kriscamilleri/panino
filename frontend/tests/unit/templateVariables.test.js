import { describe, it, expect } from 'vitest';
import { extractInputLabels, resolveTemplateVariables } from '../../src/utils/templateVariables';

// ---------------------------------------------------------------------------
// extractInputLabels
// ---------------------------------------------------------------------------
describe('extractInputLabels', () => {
    it('extracts unique labels from content with {{input:Label}} placeholders', () => {
        const content = 'Hello {{input:Name}}, your order {{input:OrderId}} is confirmed.';
        const labels = extractInputLabels(content);
        expect(labels).toEqual(['Name', 'OrderId']);
    });

    it('returns an empty array when no placeholders are present', () => {
        expect(extractInputLabels('Plain markdown with no variables.')).toEqual([]);
        expect(extractInputLabels('')).toEqual([]);
    });

    it('returns labels in order of first appearance', () => {
        const content = '{{input:Gamma}} {{input:Alpha}} {{input:Beta}} {{input:Alpha}}';
        const labels = extractInputLabels(content);
        // Alpha appears at position 2 but was already seen, so order is Gamma, Alpha, Beta
        expect(labels).toEqual(['Gamma', 'Alpha', 'Beta']);
    });

    it('deduplicates repeated labels', () => {
        const content =
            '{{input:Foo}} and {{input:Foo}} and {{input:Foo}} again, plus {{input:Bar}}';
        const labels = extractInputLabels(content);
        expect(labels).toEqual(['Foo', 'Bar']);
        expect(labels.length).toBe(2);
    });

    it('does not extract {{today}} or {{now}} as input labels', () => {
        const content = 'Today is {{today}} and now is {{now}}. Input: {{input:Name}}';
        const labels = extractInputLabels(content);
        expect(labels).toEqual(['Name']);
    });

    it('handles labels containing colons', () => {
        const content = 'Value: {{input:prefix:suffix}}';
        const labels = extractInputLabels(content);
        expect(labels).toEqual(['prefix:suffix']);
    });

    it('handles labels with spaces', () => {
        const content = '{{input:Full Name}} and {{input:Email Address}}';
        const labels = extractInputLabels(content);
        expect(labels).toEqual(['Full Name', 'Email Address']);
    });

    it('handles labels containing special regex characters', () => {
        const content = '{{input:a+b}} {{input:x?y}} {{input:(group)}} {{input:dot.not}}';
        const labels = extractInputLabels(content);
        expect(labels).toEqual(['a+b', 'x?y', '(group)', 'dot.not']);
    });

    it('handles labels containing unicode characters', () => {
        const content = '{{input:Überschrift}} {{input:日本語}} {{input:🍕}}';
        const labels = extractInputLabels(content);
        expect(labels).toEqual(['Überschrift', '日本語', '🍕']);
    });

    it('handles labels containing hyphens and underscores', () => {
        const content = '{{input:my-label}} {{input:snake_case_name}}';
        const labels = extractInputLabels(content);
        expect(labels).toEqual(['my-label', 'snake_case_name']);
    });
});

// ---------------------------------------------------------------------------
// resolveTemplateVariables
// ---------------------------------------------------------------------------
describe('resolveTemplateVariables', () => {
    // -- {{today}} --
    describe('{{today}} replacement', () => {
        it('replaces {{today}} with the current date in YYYY-MM-DD format', () => {
            const result = resolveTemplateVariables('Date: {{today}}');
            // YYYY-MM-DD is exactly 10 characters
            const match = result.match(/Date: (\d{4}-\d{2}-\d{2})/);
            expect(match).not.toBeNull();
            const dateString = match[1];
            expect(dateString).toHaveLength(10);
            // Verify it represents a valid date
            const parsed = new Date(dateString);
            expect(isNaN(parsed.getTime())).toBe(false);
        });

        it('replaces every occurrence of {{today}}', () => {
            const result = resolveTemplateVariables('Start: {{today}}, End: {{today}}');
            const parts = result.split(', ');
            expect(parts[0]).toMatch(/^Start: \d{4}-\d{2}-\d{2}$/);
            expect(parts[1]).toMatch(/^End: \d{4}-\d{2}-\d{2}$/);
        });
    });

    // -- {{now}} --
    describe('{{now}} replacement', () => {
        it('replaces {{now}} with an ISO 8601 string containing T and Z', () => {
            const result = resolveTemplateVariables('Timestamp: {{now}}');
            const isoString = result.replace('Timestamp: ', '');
            expect(isoString).toContain('T');
            expect(isoString).toContain('Z');
            // Full ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
            expect(isoString).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
            );
        });

        it('replaces every occurrence of {{now}}', () => {
            const result = resolveTemplateVariables('Created: {{now}}, Updated: {{now}}');
            const lines = result.split(', ');
            expect(lines[0]).toMatch(/^Created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(lines[1]).toMatch(/^Updated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });
    });

    // -- {{input:Label}} --
    describe('{{input:Label}} replacement', () => {
        it('replaces {{input:Label}} with the provided value', () => {
            const result = resolveTemplateVariables(
                'Hello {{input:Name}}!',
                { Name: 'Alice' }
            );
            expect(result).toBe('Hello Alice!');
        });

        it('replaces multiple different input labels at once', () => {
            const result = resolveTemplateVariables(
                '{{input:Greeting}} {{input:Name}}! Your order #{{input:OrderId}} is ready.',
                { Greeting: 'Hi', Name: 'Bob', OrderId: '9876' }
            );
            expect(result).toBe('Hi Bob! Your order #9876 is ready.');
        });

        it('handles multiple occurrences of the same label', () => {
            const result = resolveTemplateVariables(
                'Dear {{input:Name}}, your package for {{input:Name}} has shipped.',
                { Name: 'Charlie' }
            );
            expect(result).toBe('Dear Charlie, your package for Charlie has shipped.');
        });

        it('handles all three variable types in one pass', () => {
            const result = resolveTemplateVariables(
                '# Report — {{today}}\n\nGenerated at {{now}}\n\nPrepared for {{input:Client}}\n\nSigned: {{input:Client}}',
                { Client: 'Acme Corp' }
            );
            // today replaced with YYYY-MM-DD
            expect(result).toMatch(/^# Report — \d{4}-\d{2}-\d{2}$/m);
            // now replaced with ISO timestamp
            expect(result).toMatch(/^Generated at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
            // input label replaced in both places
            expect(result).toContain('Prepared for Acme Corp');
            expect(result).toContain('Signed: Acme Corp');
            // No unreplaced template variables
            expect(result).not.toContain('{{');
            expect(result).not.toContain('}}');
        });

        it('handles labels with regex metacharacters (+, ?, (, ))', () => {
            const result = resolveTemplateVariables(
                'Value: {{input:a+b}}, Optional: {{input:x?y}}, Group: {{input:(group)}}',
                { 'a+b': 'plus', 'x?y': 'question', '(group)': 'parens' }
            );
            expect(result).toBe('Value: plus, Optional: question, Group: parens');
        });

        it('handles labels with backslash metacharacter', () => {
            const result = resolveTemplateVariables(
                'Path: {{input:C:\\Users\\me}}',
                { 'C:\\Users\\me': '/home/me' }
            );
            expect(result).toBe('Path: /home/me');
        });

        it('handles labels with dot metacharacter', () => {
            const result = resolveTemplateVariables(
                '{{input:file.name}}',
                { 'file.name': 'report.pdf' }
            );
            expect(result).toBe('report.pdf');
        });

        it('handles labels with dollar sign and caret', () => {
            const result = resolveTemplateVariables(
                '{{input:$var}} {{input:^start}}',
                { '$var': 'dollar', '^start': 'caret' }
            );
            expect(result).toBe('dollar caret');
        });

        it('handles labels containing square brackets', () => {
            const result = resolveTemplateVariables(
                '{{input:[section]}} {{input:[[nested]]}}',
                { '[section]': 's1', '[[nested]]': 'n1' }
            );
            expect(result).toBe('s1 n1');
        });

        it('handles labels with the pipe character', () => {
            const result = resolveTemplateVariables(
                'Choose: {{input:a|b}}',
                { 'a|b': 'alternative' }
            );
            expect(result).toBe('Choose: alternative');
        });

        it('leaves non-template text unchanged', () => {
            const original = '# Welcome\n\nThis is **bold** and *italic*.\n\nNo variables here.\n';
            const result = resolveTemplateVariables(original, { ignored: 'value' });
            expect(result).toBe(original);
        });

        it('leaves unrecognized {{input:Label}} placeholders intact when no value provided', () => {
            const content = 'Hello {{input:Missing}}';
            const result = resolveTemplateVariables(content, { Other: 'x' });
            expect(result).toBe(content);
        });

        it('does not replace partial template syntax', () => {
            const content = 'This is {not-a-template} and {{not-closed and }} and {{ unbalanced';
            const result = resolveTemplateVariables(content, {});
            expect(result).toBe(content);
        });
    });

    // -- Edge cases --
    describe('edge cases', () => {
        it('returns empty string when content is empty', () => {
            expect(resolveTemplateVariables('', {})).toBe('');
            expect(resolveTemplateVariables('', { Name: 'X' })).toBe('');
        });

        it('works with no input values provided (defaults to empty object)', () => {
            const result = resolveTemplateVariables('{{today}} — {{now}}');
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2} — \d{4}-\d{2}-\d{2}T/);
        });

        it('handles input values that themselves contain {{...}} patterns', () => {
            const result = resolveTemplateVariables(
                'Code: {{input:Code}}',
                { Code: '{{nested}}' }
            );
            // The substituted value should appear literally; nested {{...}} should
            // not be re-resolved since there is no recursive pass.
            expect(result).toBe('Code: {{nested}}');
        });

        it('correctly distinguishes {{today}}, {{now}}, and {{input:today}}', () => {
            // {{today}} and {{now}} are built-in; {{input:today}} is a user input label.
            const result = resolveTemplateVariables(
                'Built-in: {{today}}, Input: {{input:today}}',
                { today: 'custom date' }
            );
            // {{today}} → YYYY-MM-DD; {{input:today}} → 'custom date'
            expect(result).toMatch(/^Built-in: \d{4}-\d{2}-\d{2}, Input: custom date$/);
        });

        it('treats empty-string input value as a valid replacement', () => {
            const result = resolveTemplateVariables(
                'Name: {{input:Name}}.',
                { Name: '' }
            );
            expect(result).toBe('Name: .');
        });
    });
});
