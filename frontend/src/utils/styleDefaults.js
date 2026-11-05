/**
 * The style defaults and the print CSS builder live in the shared package
 * (`shared/styleDefaults.js`) so the API renders PDFs with the same styles.
 * This module keeps the old import path.
 */
export { DEFAULT_PREVIEW_STYLES, DEFAULT_PRINT_STYLES, buildPrintCss } from '@panino/content-merge/style-defaults';
