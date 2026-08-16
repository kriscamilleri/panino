/**
 * Determines whether editor content differs from the persisted document content.
 *
 * Treat legacy null content as an empty document, matching the editor's value.
 *
 * @param {string | null | undefined} persistedContent
 * @param {string | null | undefined} nextContent
 * @returns {boolean}
 */
export function hasDocumentContentChanged(persistedContent, nextContent) {
  return (persistedContent ?? "") !== (nextContent ?? "");
}
