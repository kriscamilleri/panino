/**
 * The table of contents marker (docs/specs/active/editor-toc-and-internal-links.md §4.2):
 * its settings and the MarkdownIt rule that wraps a table in `<nav class="pn-toc">`.
 * Kept apart from tableOfContents.js, which builds tables with the full Document
 * renderer, so markdownRender.js can install this rule without an import cycle.
 */

import { parseMarkerLine } from './markerBlocks.js';

export const TOC_MARKER_NAME = 'panino:toc';
export const DEFAULT_TOC_TITLE = 'Contents';
export const MAX_TOC_TITLE_LENGTH = 80;

/** The wrapper strings. Fixed: nothing from the marker's JSON reaches HTML. */
const NAV_NUMBERED = '<nav class="pn-toc pn-toc-numbered" aria-label="Table of contents">\n';
const NAV_BULLETS = '<nav class="pn-toc" aria-label="Table of contents">\n';
const NAV_CLOSE = '</nav>\n';

/**
 * @typedef {object} TocConfig
 * @property {number|null} min first heading level listed, or null for the adaptive default
 * @property {number|null} max last heading level listed, or null for the adaptive default
 * @property {boolean} numbered outline numbers (the default) or plain bullets
 * @property {string} title the label above the list; '' for none
 */

const isLevel = (value) => Number.isInteger(value) && value >= 1 && value <= 6;

/**
 * Validate a marker's settings.
 *
 * @param {unknown} json the parsed JSON; null for a bare `<!-- panino:toc -->`;
 *   undefined when the JSON did not parse
 * @returns {TocConfig|null} null when the settings are damaged
 */
export function parseTocConfig(json) {
    if (json === null) return { min: null, max: null, numbered: true, title: DEFAULT_TOC_TITLE };
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    if (json.v !== undefined && json.v !== 1) return null;
    const min = json.min === undefined ? null : json.min;
    const max = json.max === undefined ? null : json.max;
    if (min !== null && !isLevel(min)) return null;
    if (max !== null && !isLevel(max)) return null;
    if (min !== null && max !== null && min > max) return null;
    if (json.numbered !== undefined && typeof json.numbered !== 'boolean') return null;
    if (json.title !== undefined && (typeof json.title !== 'string' || json.title.length > MAX_TOC_TITLE_LENGTH)) return null;
    return {
        min,
        max,
        numbered: json.numbered !== false,
        title: json.title === undefined ? DEFAULT_TOC_TITLE : json.title,
    };
}

/**
 * Read a single-line `html_block` as a table of contents marker.
 *
 * @param {object} token
 * @returns {import('./markerBlocks.js').MarkerLine|null}
 */
function tocMarkerToken(token) {
    if (token.type !== 'html_block' || token.level !== 0) return null;
    const content = token.content.endsWith('\n') ? token.content.slice(0, -1) : token.content;
    if (!content.startsWith('<!--') || content.indexOf('\n') !== -1) return null;
    const marker = parseMarkerLine(content);
    return marker && marker.name === TOC_MARKER_NAME ? marker : null;
}

/**
 * The core rule: a closed table between valid markers becomes `<nav>…</nav>`. Damaged
 * and unclosed tables are left as comments (which render as nothing).
 *
 * @param {object} state markdown-it core state
 */
function tocWrapperRule(state) {
    let open = null;
    for (const token of state.tokens) {
        const marker = tocMarkerToken(token);
        if (!marker) continue;
        if (marker.kind === 'open') {
            let json = null;
            if (marker.json !== null) {
                try {
                    json = JSON.parse(marker.json);
                } catch {
                    json = undefined;
                }
            }
            open = { token, config: parseTocConfig(json) };
        } else if (open) {
            if (open.config) {
                open.token.content = open.config.numbered ? NAV_NUMBERED : NAV_BULLETS;
                token.content = NAV_CLOSE;
            }
            open = null;
        }
    }
}

/**
 * The MarkdownIt plugin.
 *
 * @param {import('markdown-it')} md
 */
export function tocWrapper(md) {
    md.core.ruler.after('block', 'pn_toc_wrapper', tocWrapperRule);
}
