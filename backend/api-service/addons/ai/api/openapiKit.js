// Shared pieces of the OpenAPI 3.1 description (openapi.js): schemas, parameters
// and error responses the area files in this folder use for their paths.

export const errorSchema = {
    type: 'object',
    properties: { error: { type: 'string' }, code: { type: 'string' } },
    required: ['error', 'code'],
};

export const documentSummary = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        folderId: { type: ['string', 'null'] },
        folderPath: { type: 'string', description: 'Slash-joined folder names from the root; empty at the root' },
        space: { type: ['string', 'null'], description: 'Space id, or null for the personal database' },
        updatedAt: { type: 'string', format: 'date-time' },
        inTrash: { type: 'boolean' },
    },
};

export const fullDocument = {
    allOf: [documentSummary, {
        type: 'object',
        properties: {
            content: { type: 'string', description: 'Markdown body' },
            pinned: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
        },
    }],
};

export const spaceQuery = {
    name: 'space',
    in: 'query',
    required: false,
    description: 'Space id. Omit for the personal database (for an existing Document: omit to search every database).',
    schema: { type: 'string' },
};

export const idPath = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };

export const errors = {
    400: { description: 'Invalid input', content: { 'application/json': { schema: errorSchema } } },
    401: { description: 'Missing, invalid, revoked or expired API key', content: { 'application/json': { schema: errorSchema } } },
    403: { description: 'Read-only key used for a write (INSUFFICIENT_SCOPE)', content: { 'application/json': { schema: errorSchema } } },
    404: { description: 'Document, folder or space not found', content: { 'application/json': { schema: errorSchema } } },
    429: { description: 'Rate limited; see Retry-After', content: { 'application/json': { schema: errorSchema } } },
};

export const writeErrors = {
    ...errors,
    409: { description: 'VERSION_CONFLICT or DOCUMENT_IN_LIVE_SESSION', content: { 'application/json': { schema: errorSchema } } },
    413: { description: 'DOCUMENT_TOO_LARGE (over 2 MiB)', content: { 'application/json': { schema: errorSchema } } },
};

export function json(schema, description = 'OK') {
    return { description, content: { 'application/json': { schema } } };
}

/** A JSON request body. */
export function jsonBody(schema, required = true) {
    return { required, content: { 'application/json': { schema } } };
}
