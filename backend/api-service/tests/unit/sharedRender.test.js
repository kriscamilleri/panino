import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyDocumentVariables, renderDocumentHtml } from '@panino/content-merge/markdown-render';
import { articleBody } from '../../odooKnowledge.js';

/**
 * Renderer parity (docs/specs/active/odoo-integration.md §13): the API renders the
 * shared fixture to the HTML recorded in shared/tests/fixtures, the same bytes the
 * frontend's test checks, so a server-rendered article matches the Preview.
 */
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../shared/tests/fixtures');
const markdown = fs.readFileSync(path.join(fixtures, 'document.md'), 'utf8');
const expected = fs.readFileSync(path.join(fixtures, 'document.html'), 'utf8');

describe('the shared renderer on the API side', () => {
    it('renders the fixture exactly as the frontend does', () => {
        const body = applyDocumentVariables(markdown, {
            globals: { Author: 'Kris', customer: 'ignored by front matter' },
            now: new Date('2026-10-28T09:30:00Z'),
            formatDate: () => '2026-10-28',
            formatTime: () => '09:30',
        });
        expect(renderDocumentHtml(body)).toBe(expected);
    });

    it('turns the rendered fixture into a Knowledge article body', () => {
        const body = articleBody(expected, 'Quarterly review', { keepInternalImages: true });
        expect(body.startsWith('<p>Prepared for')).toBe(true);
        expect(body).toContain('<ul class="o_checklist"><li>Review numbers</li><li class="o_checked">Send invoice</li><li>Plain item</li></ul>');
        expect(body).toContain('<img src="/images/11111111-1111-4111-8111-111111111111" alt="Office map">');
        expect(body).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
        expect(body).not.toContain('style=');
    });
});
