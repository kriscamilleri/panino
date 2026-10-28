/**
 * Named styles and their resolution live in the shared package
 * (`shared/stylePresets.js`) so the API picks a Document's print style the way
 * the Styles pages do. This module keeps the old import path.
 */
export {
    STYLE_KINDS, ASSIGNMENT_TARGETS, STYLE_FRONT_MATTER_KEYS, MAX_STYLE_NAME_LENGTH, MAX_STYLES_JSON_BYTES,
    isStyleKind, defaultStylesFor, normalizeStyleName, styleNameError, assignmentId, parseStyleValues,
    serializeStyleValues, readDocumentStyleNames, resolveStylePreset, writeDocumentStyleNames,
} from '@panino/content-merge/style-presets';
