// The OpenAPI 3.1 description of the v1 REST API, served at
// GET /addons/ai/v1/openapi.json. Each area in api/ describes its own paths next
// to its routes; tests/integration/rest.test.js checks every path here is
// answered by the router.
import { AREAS } from './api/index.js';
import { documentSummary, errorSchema, fullDocument } from './api/openapiKit.js';

export const API_USAGE_NOTE = [
    'Panino stores Markdown Documents in folders, in a personal database and in shared spaces.',
    'Authenticate every request with "Authorization: Bearer pnk_…" (an API key from Settings → Add-ons → AI agents).',
    'Find Documents with GET /search?q=… (all databases) or GET /tree; read one with GET /documents/{id}',
    '(add ?format=markdown for the raw body). Address an existing Document by id alone; the server finds its database.',
    'To create in a space, pass space=<spaceId> (see GET /spaces). Writes need a read-write key.',
    'Prefer POST /documents/{id}/append for adding to a log, and send expectedUpdatedAt from your last read with',
    'PATCH to avoid overwriting someone else\'s edit (409 VERSION_CONFLICT means read again).',
    'DELETE moves a Document to the Trash folder; nothing is removed. Every API edit is kept in revision history.',
].join(' ');

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Every area's paths, merged per method (areas may share a path). */
function mergedPaths() {
    const paths = {};
    for (const area of AREAS) {
        for (const [path, item] of Object.entries(area.paths || {})) {
            paths[path] ??= {};
            for (const [method, operation] of Object.entries(item)) {
                if (paths[path][method]) throw new Error(`Two areas describe ${method.toUpperCase()} ${path}.`);
                paths[path][method] = operation;
            }
        }
    }
    return Object.fromEntries(Object.keys(paths).sort().map((path) => [path, paths[path]]));
}

/** "GET documents/{id}"-style lines for the API's index route. */
export function listRoutes() {
    const lines = [];
    for (const [path, item] of Object.entries(mergedPaths())) {
        for (const method of METHODS) if (item[method]) lines.push(`${method.toUpperCase()} ${path.slice(1)}`);
    }
    return lines;
}

/**
 * @param {string|null} [v1Base] the public base URL of the v1 API, when known
 * @returns {object} OpenAPI 3.1 document for the v1 REST API
 */
export function buildOpenApiDocument(v1Base = null) {
    return {
        openapi: '3.1.0',
        info: { title: 'Panino API', version: '1.0.0', description: API_USAGE_NOTE },
        servers: v1Base ? [{ url: v1Base }] : [{ url: '/addons/ai/v1', description: 'Relative to the API service' }],
        security: [{ apiKey: [] }],
        components: {
            securitySchemes: {
                apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'pnk_…', description: 'Create in Settings → Add-ons → AI agents' },
            },
            schemas: { Error: errorSchema, DocumentSummary: documentSummary, Document: fullDocument },
        },
        paths: mergedPaths(),
    };
}
