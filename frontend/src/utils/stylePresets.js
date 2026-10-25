/**
 * Named styles: saved preview or print styles that folders, templates and
 * Documents can choose. See docs/specs/active/named-styles.md.
 */
import { DEFAULT_PREVIEW_STYLES, DEFAULT_PRINT_STYLES } from './styleDefaults';
import { parseFrontMatter, unquoteValue } from './frontMatter';

export const STYLE_KINDS = Object.freeze(['preview', 'print']);
export const ASSIGNMENT_TARGETS = Object.freeze(['folder', 'template']);

/** The front matter key that names a Document's style of each kind. */
export const STYLE_FRONT_MATTER_KEYS = Object.freeze({
  preview: 'preview-style',
  print: 'print-style',
});

export const MAX_STYLE_NAME_LENGTH = 80;
export const MAX_STYLES_JSON_BYTES = 200 * 1024;

/**
 * @param {string} kind
 * @returns {boolean}
 */
export function isStyleKind(kind) {
  return STYLE_KINDS.includes(kind);
}

/**
 * @param {string} kind 'preview' or 'print'
 * @returns {Readonly<Object<string, string|boolean>>}
 */
export function defaultStylesFor(kind) {
  return kind === 'print' ? DEFAULT_PRINT_STYLES : DEFAULT_PREVIEW_STYLES;
}

/**
 * A style name with surrounding space removed and inner runs collapsed.
 * @param {string} name
 * @returns {string}
 */
export function normalizeStyleName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Why a name cannot be used, or null when it can. Names are unique per kind
 * within a library, compared without regard to case.
 * @param {string} name
 * @param {Array<{id: string, name: string}>} existing styles of the same kind
 * @param {string|null} [ignoreId] the style being renamed
 * @returns {string|null}
 */
export function styleNameError(name, existing = [], ignoreId = null) {
  const normalized = normalizeStyleName(name);
  if (!normalized) return 'Enter a name.';
  if (normalized.length > MAX_STYLE_NAME_LENGTH) {
    return `Use ${MAX_STYLE_NAME_LENGTH} characters or fewer.`;
  }
  const wanted = normalized.toLowerCase();
  const taken = existing.some((s) => s.id !== ignoreId && normalizeStyleName(s.name).toLowerCase() === wanted);
  return taken ? 'A style with that name already exists.' : null;
}

/**
 * The id of the assignment row for a folder or template and a kind. Fixed
 * rather than random, so two devices that set the same folder's default end
 * up writing one row instead of two that compete.
 * @param {'folder'|'template'} targetType
 * @param {string} targetId
 * @param {'preview'|'print'} kind
 * @returns {string}
 */
export function assignmentId(targetType, targetId, kind) {
  if (!ASSIGNMENT_TARGETS.includes(targetType)) throw new Error(`Unknown style target: ${targetType}`);
  if (!isStyleKind(kind)) throw new Error(`Unknown style kind: ${kind}`);
  if (!targetId) throw new Error('A style target id is required.');
  return `${targetType}:${targetId}:${kind}`;
}

/**
 * A complete styles object for a kind: the stored values laid over the
 * built-in defaults. Keys the defaults do not have are dropped, values become
 * strings, and `enablePageNumbers` becomes a boolean. Unreadable JSON gives
 * the defaults.
 * @param {string|object|null} stored JSON text or an object
 * @param {'preview'|'print'} kind
 * @returns {Object<string, string|boolean>}
 */
export function parseStyleValues(stored, kind) {
  const defaults = defaultStylesFor(kind);
  let values = stored;
  if (typeof stored === 'string') {
    try {
      values = JSON.parse(stored);
    } catch {
      values = null;
    }
  }
  const result = { ...defaults };
  if (!values || typeof values !== 'object' || Array.isArray(values)) return result;

  for (const key of Object.keys(defaults)) {
    if (!Object.hasOwn(values, key) || values[key] == null) continue;
    if (typeof defaults[key] === 'boolean') {
      result[key] = values[key] === true || String(values[key]).toLowerCase() === 'true';
    } else {
      result[key] = String(values[key]);
    }
  }
  return result;
}

/**
 * Styles as stored text, or an error when they are too large to keep.
 * @param {object} values
 * @param {'preview'|'print'} kind
 * @returns {string}
 */
export function serializeStyleValues(values, kind) {
  const json = JSON.stringify(parseStyleValues(values, kind));
  if (new TextEncoder().encode(json).length > MAX_STYLES_JSON_BYTES) {
    throw new Error('These styles are too large to save.');
  }
  return json;
}

/**
 * The style names a Document chooses in its front matter.
 * @param {string} markdown
 * @returns {{ preview: string, print: string }} empty strings when not set
 */
export function readDocumentStyleNames(markdown) {
  const { metadata } = parseFrontMatter(markdown || '');
  const lowered = Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key.trim().toLowerCase(), value]),
  );
  return {
    preview: unquoteValue(lowered[STYLE_FRONT_MATTER_KEYS.preview]),
    print: unquoteValue(lowered[STYLE_FRONT_MATTER_KEYS.print]),
  };
}

/**
 * Pick the named style a Document uses for one kind. Its own front matter
 * wins, then the nearest folder with a default, then nothing (the library
 * Default). Names and assignments that point at a missing style are skipped.
 *
 * @param {object} input
 * @param {'preview'|'print'} input.kind
 * @param {string} [input.documentStyleName] from front matter
 * @param {string[]} [input.folderTrail] folder ids, the Document's own folder first
 * @param {Array<{id: string, kind: string, name: string}>} [input.presets] the library's styles
 * @param {Map<string, string|null>} [input.assignments] assignment id → style id
 * @returns {{ preset: object|null, source: 'document'|'folder'|'default', folderId?: string }}
 */
export function resolveStylePreset({
  kind,
  documentStyleName = '',
  folderTrail = [],
  presets = [],
  assignments = new Map(),
}) {
  const ofKind = presets.filter((p) => p.kind === kind);

  const wanted = normalizeStyleName(documentStyleName).toLowerCase();
  if (wanted) {
    const named = ofKind.find((p) => normalizeStyleName(p.name).toLowerCase() === wanted);
    if (named) return { preset: named, source: 'document' };
  }

  for (const folderId of folderTrail) {
    if (!folderId) continue;
    const presetId = assignments.get(assignmentId('folder', folderId, kind));
    if (!presetId) continue;
    const assigned = ofKind.find((p) => p.id === presetId);
    if (assigned) return { preset: assigned, source: 'folder', folderId };
  }

  return { preset: null, source: 'default' };
}
