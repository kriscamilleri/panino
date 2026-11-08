import { describe, expect, it } from 'vitest';
import {
    ANCHOR_PRESETS,
    DIM_ALPHA,
    defaultTypewriterSettings,
    nearestAnchorPreset,
    normalizeTypewriterRow,
    normalizeTypewriterSettings,
} from '@/utils/typewriterSettings';

describe('typewriter settings defaults (§9.2)', () => {
    it('gives the desktop defaults', () => {
        expect(defaultTypewriterSettings('desktop')).toEqual({
            enabled: false,
            scrolling: 'typewriter',
            anchorPercent: 50,
            contextLines: 3,
            highlightLine: true,
            dim: 'paragraph',
            dimStrength: 'medium',
        });
    });

    it('keeps two context lines on phones', () => {
        expect(defaultTypewriterSettings('phone').contextLines).toBe(2);
        expect(defaultTypewriterSettings('phone').enabled).toBe(false);
    });

    it('treats an unknown form factor as desktop', () => {
        expect(defaultTypewriterSettings('watch')).toEqual(defaultTypewriterSettings('desktop'));
    });

    it('returns a fresh object each time', () => {
        const a = defaultTypewriterSettings();
        a.enabled = true;
        expect(defaultTypewriterSettings().enabled).toBe(false);
    });

    it('maps dim strengths to the scrim alphas of §7.4', () => {
        expect(DIM_ALPHA).toEqual({ subtle: 0.4, medium: 0.6, strong: 0.75 });
        expect(ANCHOR_PRESETS.map((preset) => preset.value)).toEqual([33, 50, 67]);
    });
});

describe('normalizeTypewriterSettings', () => {
    it('fills every missing field with the default', () => {
        expect(normalizeTypewriterSettings({}, 'phone')).toEqual(defaultTypewriterSettings('phone'));
        expect(normalizeTypewriterSettings(undefined)).toEqual(defaultTypewriterSettings('desktop'));
    });

    it('never throws on malformed input', () => {
        for (const raw of [null, 42, 'yes', [], [1, 2], () => {}, Symbol('x'), NaN]) {
            expect(() => normalizeTypewriterSettings(raw)).not.toThrow();
            expect(normalizeTypewriterSettings(raw)).toEqual(defaultTypewriterSettings('desktop'));
        }
    });

    it('clamps and rounds the anchor to 20–80 and the lines to 0–10', () => {
        expect(normalizeTypewriterSettings({ anchorPercent: 5 }).anchorPercent).toBe(20);
        expect(normalizeTypewriterSettings({ anchorPercent: 99 }).anchorPercent).toBe(80);
        expect(normalizeTypewriterSettings({ anchorPercent: 33.4 }).anchorPercent).toBe(33);
        expect(normalizeTypewriterSettings({ anchorPercent: '67' }).anchorPercent).toBe(67);
        expect(normalizeTypewriterSettings({ contextLines: -3 }).contextLines).toBe(0);
        expect(normalizeTypewriterSettings({ contextLines: 50 }).contextLines).toBe(10);
        expect(normalizeTypewriterSettings({ contextLines: 2.6 }).contextLines).toBe(3);
    });

    it('falls back to the default for non-numeric integers', () => {
        expect(normalizeTypewriterSettings({ anchorPercent: 'middle' }).anchorPercent).toBe(50);
        expect(normalizeTypewriterSettings({ contextLines: Infinity }).contextLines).toBe(3);
        expect(normalizeTypewriterSettings({ contextLines: '' }).contextLines).toBe(3);
        expect(normalizeTypewriterSettings({ contextLines: null }).contextLines).toBe(3);
    });

    it('takes enums only from their allow-lists', () => {
        const result = normalizeTypewriterSettings({ scrolling: 'smooth', dim: 'line', dimStrength: 'max' });
        expect(result.scrolling).toBe('typewriter');
        expect(result.dim).toBe('paragraph');
        expect(result.dimStrength).toBe('medium');
        const valid = normalizeTypewriterSettings({ scrolling: 'margin', dim: 'sentence', dimStrength: 'strong' });
        expect(valid).toMatchObject({ scrolling: 'margin', dim: 'sentence', dimStrength: 'strong' });
    });

    it('accepts only real booleans', () => {
        expect(normalizeTypewriterSettings({ enabled: 'true' }).enabled).toBe(false);
        expect(normalizeTypewriterSettings({ enabled: 1 }).enabled).toBe(false);
        expect(normalizeTypewriterSettings({ enabled: true }).enabled).toBe(true);
        expect(normalizeTypewriterSettings({ highlightLine: false }).highlightLine).toBe(false);
        expect(normalizeTypewriterSettings({ highlightLine: 0 }).highlightLine).toBe(true);
    });

    it('drops unknown keys', () => {
        expect(normalizeTypewriterSettings({ enabled: true, evil: '<script>' })).not.toHaveProperty('evil');
    });
});

describe('normalizeTypewriterRow', () => {
    it('reads the stored JSON text', () => {
        const row = normalizeTypewriterRow(JSON.stringify({ version: 1, desktop: { enabled: true }, phone: { contextLines: 7 } }));
        expect(row.version).toBe(1);
        expect(row.desktop.enabled).toBe(true);
        expect(row.phone.contextLines).toBe(7);
        expect(row.phone.enabled).toBe(false);
    });

    it('gives both defaults for invalid JSON or an unknown shape', () => {
        const expected = { version: 1, desktop: defaultTypewriterSettings('desktop'), phone: defaultTypewriterSettings('phone') };
        expect(normalizeTypewriterRow('{not json')).toEqual(expected);
        expect(normalizeTypewriterRow('[]')).toEqual(expected);
        expect(normalizeTypewriterRow(null)).toEqual(expected);
        expect(normalizeTypewriterRow('"text"')).toEqual(expected);
    });
});

describe('nearestAnchorPreset', () => {
    it('picks the closest of Higher, Middle and Lower', () => {
        expect(nearestAnchorPreset(20)).toBe(33);
        expect(nearestAnchorPreset(45)).toBe(50);
        expect(nearestAnchorPreset(60)).toBe(67);
        expect(nearestAnchorPreset(80)).toBe(67);
        expect(nearestAnchorPreset('junk')).toBe(50);
    });
});
