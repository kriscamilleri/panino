// Building blocks for MCP tools (docs/specs/active/ai-integration.md §5.3): portable
// input schemas, annotations, argument reading and result text. Each area file in
// this folder uses them; mcpTools.js collects the areas.
/* ------------------------------------------------------------------ *
 * Schemas: type object, string/integer/boolean properties, descriptions.
 * Nothing else (see PORTABLE_SCHEMA_KEYS and the test that enforces it).
 * ------------------------------------------------------------------ */

export const str = (description) => ({ type: 'string', description });
export const int = (description) => ({ type: 'integer', description });
export const bool = (description) => ({ type: 'boolean', description });
export const object = (properties = {}, required = []) => ({ type: 'object', properties, required });

export const ID_HINT = 'Document id, as returned by search_documents, list_documents or list_folders.';
export const SPACE_FOR_EXISTING = 'Optional. Space id from list_spaces. Leave out: the Document is found in any database this connection can reach.';
export const SPACE_FOR_NEW = 'Optional. Space id from list_spaces to create it in that shared space. Leave out (or "personal") for the personal database.';
export const EXPECTED = 'Optional but recommended: the updated_at value from your last get_document. If the Document changed since, nothing is written and you are told to read it again.';

export const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const ADDITIVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** A write that replaces or removes something (revision history still keeps it). */
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
/** The same, where repeating the call changes nothing more: set a name or value, remove a key. */
export const REPLACING = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

/** Keywords a portable tool schema may use (enforced by tests). */
export const PORTABLE_SCHEMA_KEYS = Object.freeze({
    root: ['type', 'properties', 'required'],
    property: ['type', 'description', 'enum'],
    types: ['string', 'integer', 'boolean'],
});

/* ------------------------------------------------------------------ *
 * Result text
 * ------------------------------------------------------------------ */

export function where(doc) {
    const parts = [];
    if (doc.space) parts.push(`space ${doc.spaceName || doc.space}`);
    if (doc.folderPath) parts.push(`folder ${doc.folderPath}`);
    if (doc.inTrash) parts.push('in Trash');
    return parts.length ? ` — ${parts.join(', ')}` : '';
}

export function documentLine(doc, index) {
    return `${index + 1}. ${doc.title || '(untitled)'}${where(doc)} — id ${doc.id} — updated ${doc.updatedAt || 'unknown'}`;
}

export function documentHeader(doc) {
    return [
        `Title: ${doc.title || '(untitled)'}`,
        `id: ${doc.id}`,
        `space: ${doc.space || 'personal'}`,
        `folder: ${doc.folderPath || '(top level)'}`,
        `updated_at: ${doc.updatedAt}`,
        ...(doc.inTrash ? ['in Trash: yes'] : []),
    ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Argument reading: snake_case in, typed values out; wrong types are
 * tool errors that name the argument.
 * ------------------------------------------------------------------ */

export class ArgumentError extends Error {}

export function reader(args) {
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const get = (name, type, { required = false } = {}) => {
        const value = input[name];
        if (value === undefined || value === null) {
            if (required) throw new ArgumentError(`The argument "${name}" is required.`);
            return undefined;
        }
        if (type === 'integer') {
            const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
            if (!Number.isInteger(number)) throw new ArgumentError(`The argument "${name}" must be a whole number.`);
            return number;
        }
        if (type === 'boolean') {
            if (value === 'true' || value === 'false') return value === 'true';
            if (typeof value !== 'boolean') throw new ArgumentError(`The argument "${name}" must be true or false.`);
            return value;
        }
        if (typeof value !== 'string') throw new ArgumentError(`The argument "${name}" must be text.`);
        return value;
    };
    return get;
}
