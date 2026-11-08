/**
 * Typewriter mode settings (docs/specs/active/typewriter-mode.md §9.2).
 *
 * Stored as one row of the synced `settings` table, id `typewriter`, holding
 * `{ version: 1, desktop: {…}, phone: {…} }`. Everything read from that row
 * goes through the normalisers here: synced JSON may come from another
 * version of the app, or be broken, and must never throw or reach the editor
 * unchecked.
 */

/** The id of the `settings` row. */
export const TYPEWRITER_SETTINGS_ID = 'typewriter';
export const TYPEWRITER_SETTINGS_VERSION = 1;

export const FORM_FACTORS = ['desktop', 'phone'];
export const SCROLLING_STYLES = ['typewriter', 'margin', 'off'];
export const DIM_MODES = ['off', 'paragraph', 'sentence'];
export const DIM_STRENGTHS = ['subtle', 'medium', 'strong'];

/** Scrim alpha per dim strength (§7.4). */
export const DIM_ALPHA = Object.freeze({ subtle: 0.4, medium: 0.6, strong: 0.75 });

export const ANCHOR_MIN = 20;
export const ANCHOR_MAX = 80;
export const CONTEXT_LINES_MIN = 0;
export const CONTEXT_LINES_MAX = 10;

/** The three line positions the UI offers; storage allows any 20–80. */
export const ANCHOR_PRESETS = Object.freeze([
    { value: 33, label: 'Higher' },
    { value: 50, label: 'Middle' },
    { value: 67, label: 'Lower' },
]);

const DEFAULTS = Object.freeze({
    desktop: Object.freeze({
        enabled: false,
        scrolling: 'typewriter',
        anchorPercent: 50,
        contextLines: 3,
        highlightLine: true,
        dim: 'paragraph',
        dimStrength: 'medium',
    }),
    phone: Object.freeze({
        enabled: false,
        scrolling: 'typewriter',
        anchorPercent: 50,
        contextLines: 2,
        highlightLine: true,
        dim: 'paragraph',
        dimStrength: 'medium',
    }),
});

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

function clampInteger(value, min, max, fallback) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * The default settings of a form factor.
 *
 * @param {'desktop'|'phone'} [formFactor]
 * @returns {{ enabled: boolean, scrolling: string, anchorPercent: number, contextLines: number, highlightLine: boolean, dim: string, dimStrength: string }}
 */
export function defaultTypewriterSettings(formFactor = 'desktop') {
    return { ...DEFAULTS[pick(formFactor, FORM_FACTORS, 'desktop')] };
}

/**
 * One form factor's settings from anything: allow-lists for enums, clamped
 * and rounded integers, real booleans, and the default for every field that
 * is missing or invalid. Never throws.
 *
 * @param {unknown} raw
 * @param {'desktop'|'phone'} [formFactor]
 */
export function normalizeTypewriterSettings(raw, formFactor = 'desktop') {
    const defaults = defaultTypewriterSettings(formFactor);
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
        scrolling: pick(source.scrolling, SCROLLING_STYLES, defaults.scrolling),
        anchorPercent: clampInteger(source.anchorPercent, ANCHOR_MIN, ANCHOR_MAX, defaults.anchorPercent),
        contextLines: clampInteger(source.contextLines, CONTEXT_LINES_MIN, CONTEXT_LINES_MAX, defaults.contextLines),
        highlightLine: typeof source.highlightLine === 'boolean' ? source.highlightLine : defaults.highlightLine,
        dim: pick(source.dim, DIM_MODES, defaults.dim),
        dimStrength: pick(source.dimStrength, DIM_STRENGTHS, defaults.dimStrength),
    };
}

/**
 * The whole stored row, from its JSON text or an already parsed value. Invalid
 * JSON or an unknown shape gives the defaults for both form factors.
 *
 * @param {unknown} raw
 * @returns {{ version: number, desktop: object, phone: object }}
 */
export function normalizeTypewriterRow(raw) {
    let value = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        } catch {
            value = null;
        }
    }
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        version: TYPEWRITER_SETTINGS_VERSION,
        desktop: normalizeTypewriterSettings(source.desktop, 'desktop'),
        phone: normalizeTypewriterSettings(source.phone, 'phone'),
    };
}

/**
 * The preset closest to a stored anchor, so the three-way control shows one
 * of its options as chosen even for a value set elsewhere (a future slider).
 *
 * @param {number} percent
 * @returns {number} one of the ANCHOR_PRESETS values
 */
export function nearestAnchorPreset(percent) {
    const value = clampInteger(percent, ANCHOR_MIN, ANCHOR_MAX, 50);
    let best = ANCHOR_PRESETS[0].value;
    for (const preset of ANCHOR_PRESETS) {
        if (Math.abs(preset.value - value) < Math.abs(best - value)) best = preset.value;
    }
    return best;
}

/** Copy for the options (§9.6), shared by the desktop popover and phone Settings. */
export const TYPEWRITER_COPY = Object.freeze({
    mode: 'Typewriter mode',
    modeHelp: 'Keep the line you are writing in one place and fade the rest.',
    scrolling: 'Scrolling',
    linePosition: 'Line position',
    contextLines: 'Lines kept above and below the cursor',
    highlightLine: 'Highlight current line',
    dim: 'Dim',
    dimStrength: 'Dim strength',
});

export const SCROLLING_OPTIONS = Object.freeze([
    { value: 'typewriter', label: 'Typewriter' },
    { value: 'margin', label: 'Keep lines visible' },
    { value: 'off', label: 'Off' },
]);

export const DIM_OPTIONS = Object.freeze([
    { value: 'off', label: 'Off' },
    { value: 'paragraph', label: 'Paragraph' },
    { value: 'sentence', label: 'Sentence' },
]);

export const DIM_STRENGTH_OPTIONS = Object.freeze([
    { value: 'subtle', label: 'Subtle' },
    { value: 'medium', label: 'Medium' },
    { value: 'strong', label: 'Strong' },
]);

/**
 * Which dependent controls show (§9.6): the line position only for
 * typewriter scrolling, the context lines unless scrolling is off, the dim
 * strength unless dimming is off.
 *
 * @param {{ scrolling: string, dim: string }} settings
 * @returns {{ linePosition: boolean, contextLines: boolean, dimStrength: boolean }}
 */
export function visibleTypewriterControls(settings) {
    return {
        linePosition: settings?.scrolling === 'typewriter',
        contextLines: settings?.scrolling !== 'off',
        dimStrength: settings?.dim !== 'off',
    };
}
