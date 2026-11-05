/**
 * The Document front matter helpers live in the shared package
 * (`shared/frontMatter.js`) so the API reads a Document the same way the
 * Preview does. This module keeps the old import path.
 */
export { parseFrontMatter, unquoteValue, setFrontMatterValues, removeFrontMatterKeys } from '@panino/content-merge/front-matter';
