// Templates, global variables and PDF export in the v1 API
// (docs/specs/proposed/ai-api-expansion.md §4.3), as MCP tools, REST routes and
// OpenAPI paths. The rules are in libraryService.js; this file only adapts.
import { PDF_RUNTIME } from '../../../pdf.js';
import {
    createDocumentFromTemplate,
    exportPdf,
    getTemplate,
    listTemplates,
    listVariables,
    MCP_PDF_MAX_BYTES,
} from '../libraryService.js';
import { errorSchema, errors, fullDocument, idPath, json, jsonBody, spaceQuery, writeErrors } from './openapiKit.js';
import { body, context, first, handler, spaceParam } from './restKit.js';
import { ADDITIVE, ID_HINT, object, READ, reader, SPACE_FOR_EXISTING, str, where } from './toolKit.js';

const TEMPLATE_ID = 'Template id, as returned by list_templates.';
const SPACE_FOR_TEMPLATE = 'Optional. Space id from list_spaces, or "personal". Leave out: the template is found in any database this connection can reach.';
const SPACE_FOR_LIST = 'Optional. "personal" or a space id from list_spaces for one database. Leave out (or "all") for every database this connection can reach.';
const SPACE_FOR_ONE = 'Optional. "personal" (default) or a space id from list_spaces.';

function megabytes(bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function templateLine(template, index) {
    const parts = [`${index + 1}. ${template.name || '(unnamed)'}`, `id ${template.id}`];
    if (template.titlePattern) parts.push(`title pattern "${template.titlePattern}"`);
    if (template.inputs.length) parts.push(`inputs: ${template.inputs.join(', ')}`);
    if (template.defaultFolderPath) parts.push(`default folder ${template.defaultFolderPath}`);
    if (template.space) parts.push(`space ${template.spaceName || template.space}`);
    return parts.join(' — ');
}

export const tools = [
    {
        name: 'list_templates',
        title: 'List templates',
        description: 'The user\'s Document templates (name, title pattern, the {{input:Label}} values they ask for, default folder), most recently updated first. Use create_document_from_template to make a Document from one; get_template shows its text.',
        access: 'read',
        annotations: READ,
        inputSchema: object({ space: str(SPACE_FOR_LIST) }),
        run(ctx, args) {
            const get = reader(args);
            const result = listTemplates(ctx, { space: get('space', 'string') });
            const lines = result.templates.map(templateLine);
            if (result.truncated) lines.push(`(Only the first ${result.templates.length} templates are shown.)`);
            return { text: lines.length ? lines.join('\n') : 'No templates.', structured: result };
        },
    },
    {
        name: 'get_template',
        title: 'Read a template',
        description: 'One template\'s Markdown text, title pattern, inputs and default folder. Placeholders: {{today}} and {{now}} (optionally with a format such as {{today:dd-MM-yyyy}}) and {{input:Label}} are filled in when a Document is made from it; {{name}} global variables stay in the Document and are filled in when it is shown or exported.',
        access: 'read',
        annotations: READ,
        inputSchema: object({ id: str(TEMPLATE_ID), space: str(SPACE_FOR_TEMPLATE) }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const { template } = getTemplate(ctx, { id: get('id', 'string', { required: true }), space: get('space', 'string') });
            const header = [
                `Template: ${template.name || '(unnamed)'}`,
                `id: ${template.id}`,
                `space: ${template.space || 'personal'}`,
                `title pattern: ${template.titlePattern || '(none: the template name is used)'}`,
                `inputs: ${template.inputs.length ? template.inputs.join(', ') : '(none)'}`,
                `default folder: ${template.defaultFolderPath ?? '(top level)'}`,
                `updated_at: ${template.updatedAt}`,
            ].join('\n');
            return { text: `${header}\n\n---\n${template.content}`, structured: { template } };
        },
    },
    {
        name: 'create_document_from_template',
        title: 'New Document from a template',
        description: 'Create a Document from a template, exactly as the app\'s "New from template" does: the title comes from the template\'s title pattern (or its name), dates and {{input:Label}} values are filled in, and it goes into the template\'s default folder unless you give folder_id. It is created in the template\'s database. Returns the new Document\'s id and updated_at.',
        access: 'write',
        annotations: ADDITIVE,
        inputSchema: object({
            id: str(TEMPLATE_ID),
            inputs: str('Optional. A JSON object giving a value for each input label the template lists, for example {"Client": "Acme", "Bug Title": "Login fails"}. Labels you leave out become empty, as in the app.'),
            title: str('Optional. A title to use instead of the template\'s title pattern, 1 to 255 characters, one line.'),
            folder_id: str('Optional. Folder id from list_folders, or "root" for the top level. Default: the template\'s default folder, or the top level when it has none.'),
            space: str(SPACE_FOR_TEMPLATE),
        }, ['id']),
        run(ctx, args) {
            const get = reader(args);
            const result = createDocumentFromTemplate(ctx, {
                id: get('id', 'string', { required: true }),
                inputs: get('inputs', 'string'),
                title: get('title', 'string'),
                folderId: get('folder_id', 'string'),
                space: get('space', 'string'),
            });
            const { document, unfilledInputs } = result;
            const missing = unfilledInputs.length ? ` These inputs had no value and were left empty: ${unfilledInputs.join(', ')}.` : '';
            return {
                text: `Created "${document.title}" from the template "${result.template.name}"${where(document)} (id ${document.id}). updated_at is ${document.updatedAt}.${missing}`,
                structured: result,
            };
        },
    },
    {
        name: 'list_variables',
        title: 'List global variables',
        description: 'The global variables of one database and their values. Writing {{name}} in a Document of that database shows the value when the Document is previewed or exported (names ignore case and extra spaces; a front matter value of the same name wins). Read only.',
        access: 'read',
        annotations: READ,
        inputSchema: object({ space: str(SPACE_FOR_ONE) }),
        run(ctx, args) {
            const get = reader(args);
            const result = listVariables(ctx, { space: get('space', 'string') });
            const lines = result.variables.map((variable, index) => `${index + 1}. {{${variable.displayKey}}} = ${JSON.stringify(variable.value)}`);
            if (result.truncated) lines.push(`(Only the first ${result.variables.length} variables are shown.)`);
            return { text: lines.length ? lines.join('\n') : 'No global variables in this database.', structured: result };
        },
    },
    {
        name: 'export_pdf',
        title: 'Export a Document as PDF',
        description: `Render a Document as a PDF the way the app's Export does (its print style, global variables and images), returned as an embedded PDF resource. PDFs over ${MCP_PDF_MAX_BYTES / (1024 * 1024)} MB are refused here. Rendering takes a few seconds.`,
        access: 'read',
        annotations: READ,
        inputSchema: object({
            id: str(ID_HINT),
            page_size: { ...str('Optional. "A4" or "Letter" for this export. Default: the paper size of the Document\'s print style.'), enum: ['A4', 'Letter'] },
            space: str(SPACE_FOR_EXISTING),
        }, ['id']),
        async run(ctx, args) {
            const get = reader(args);
            const result = await exportPdf(ctx, {
                id: get('id', 'string', { required: true }),
                space: get('space', 'string'),
                pageSize: get('page_size', 'string'),
                maxBytes: MCP_PDF_MAX_BYTES,
            });
            const { document } = result;
            const pages = result.pages ? `${result.pages} page${result.pages === 1 ? '' : 's'}, ` : '';
            const style = result.printStyle ? `, print style "${result.printStyle}"` : '';
            const uri = `panino://documents/${document.id}.pdf`;
            return {
                text: `PDF of "${document.title || '(untitled)'}"${where(document)}: ${pages}${megabytes(result.bytes)} (${result.pageSize}${style}). It is attached as the resource ${uri}.`,
                structured: {
                    document,
                    uri,
                    mimeType: 'application/pdf',
                    filename: result.filename.unicode,
                    bytes: result.bytes,
                    pages: result.pages,
                    pageSize: result.pageSize,
                    printStyle: result.printStyle,
                },
                content: [{ type: 'resource', resource: { uri, mimeType: 'application/pdf', blob: result.pdf.toString('base64') } }],
            };
        },
    },
];

/** What the model should do next, per v1 error code. */
export const nextSteps = {
    TEMPLATE_NOT_FOUND: 'No template with that id is reachable. Use list_templates to find template ids.',
    PDF_BUSY: `The PDF service is busy. Wait about ${PDF_RUNTIME.retryAfterSeconds} seconds, then call export_pdf again.`,
    PDF_TIMEOUT: 'Making the PDF took too long, often because of many or slow external images. Try once more later; if it fails again, tell the user.',
    PDF_INPUT_TOO_LARGE: 'The Document or its print style is too large for the PDF renderer. Tell the user; it cannot be exported as it is.',
    PDF_NOTHING_TO_RENDER: 'The Document is empty, so there is nothing to put in a PDF. Check the id, or add content first.',
    PDF_TOO_LARGE: `The PDF is larger than ${MCP_PDF_MAX_BYTES / (1024 * 1024)} MB, too large to return here. Tell the user to export it in Panino, or to fetch it with GET documents/{id}/pdf and an API key.`,
    PDF_FAILED: 'The PDF could not be made. Try once more; if it fails again, tell the user.',
};

/** @param {import('express').Router} router */
export function routes(router) {
    router.get('/templates', handler((req, res) => {
        res.json(listTemplates(context(req), { space: spaceParam(req) }));
    }));

    router.get('/templates/:id', handler((req, res) => {
        res.json(getTemplate(context(req), { id: req.params.id, space: spaceParam(req) }));
    }));

    router.post('/templates/:id/documents', handler((req, res) => {
        const input = body(req);
        res.status(201).json(createDocumentFromTemplate(context(req), {
            id: req.params.id,
            space: spaceParam(req),
            title: input.title,
            folderId: input.folderId,
            inputs: input.inputs,
        }));
    }));

    router.get('/variables', handler((req, res) => {
        res.json(listVariables(context(req), { space: spaceParam(req) }));
    }));

    router.get('/documents/:id/pdf', handler(async (req, res) => {
        let result;
        try {
            result = await exportPdf(context(req), {
                id: req.params.id,
                space: spaceParam(req),
                pageSize: first(req.query.pageSize),
            });
        } catch (error) {
            if (error?.code === 'PDF_BUSY' && error.details?.retryAfterSeconds) {
                res.setHeader('Retry-After', String(error.details.retryAfterSeconds));
            }
            throw error;
        }
        const { ascii, unicode } = result.filename;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(unicode)}`);
        res.setHeader('Content-Length', String(result.bytes));
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (result.pages) res.setHeader('X-Panino-Pdf-Pages', String(result.pages));
        res.end(result.pdf);
    }));
}

function encodeRfc5987(value) {
    return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

const templateSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        titlePattern: { type: 'string', description: 'Empty: the template name is the title' },
        defaultFolderId: { type: ['string', 'null'] },
        defaultFolderPath: { type: ['string', 'null'], description: 'Null when there is no default folder or it no longer exists' },
        inputs: { type: 'array', items: { type: 'string' }, description: 'The {{input:Label}} labels of the body and title pattern' },
        space: { type: ['string', 'null'] },
        updatedAt: { type: 'string', format: 'date-time' },
    },
};

const PDF_ERRORS = {
    413: { description: 'PDF_INPUT_TOO_LARGE', content: { 'application/json': { schema: errorSchema } } },
    422: { description: 'PDF_NOTHING_TO_RENDER (empty Document)', content: { 'application/json': { schema: errorSchema } } },
    500: { description: 'PDF_FAILED', content: { 'application/json': { schema: errorSchema } } },
    503: { description: 'PDF_BUSY; see Retry-After and details.retryAfterSeconds', content: { 'application/json': { schema: errorSchema } } },
    504: { description: 'PDF_TIMEOUT', content: { 'application/json': { schema: errorSchema } } },
};

export const paths = {
    '/templates': {
        get: {
            operationId: 'listTemplates',
            summary: 'Templates, most recently updated first (no bodies)',
            parameters: [{ ...spaceQuery, description: 'Space id, "personal", or "all" (default)' }],
            responses: {
                200: json({ type: 'object', properties: { templates: { type: 'array', items: { allOf: [templateSchema, { type: 'object', properties: { spaceName: { type: ['string', 'null'] } } }] } }, truncated: { type: 'boolean' } } }),
                ...errors,
            },
        },
    },
    '/templates/{id}': {
        get: {
            operationId: 'getTemplate',
            summary: 'One template with its Markdown body',
            parameters: [idPath, { ...spaceQuery, description: 'Space id or "personal". Omit to search every database.' }],
            responses: {
                200: json({ type: 'object', properties: { template: { allOf: [templateSchema, { type: 'object', properties: { content: { type: 'string' } } }] } } }),
                ...errors,
            },
        },
    },
    '/templates/{id}/documents': {
        post: {
            operationId: 'createDocumentFromTemplate',
            summary: 'Create a Document from a template, as the app\'s "New from template" does',
            parameters: [idPath, { ...spaceQuery, description: 'Space id or "personal" holding the template. Omit to search every database. The Document is created in the same database.' }],
            requestBody: jsonBody({
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Instead of the title pattern' },
                    folderId: { type: ['string', 'null'], description: 'Default: the template\'s default folder if it exists, else the top level; "root" for the top level' },
                    inputs: { type: 'object', additionalProperties: { type: 'string' }, description: 'Values of the template\'s {{input:Label}} labels; missing labels become empty' },
                },
            }, false),
            responses: {
                201: json({
                    type: 'object',
                    properties: {
                        document: fullDocument,
                        template: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
                        unfilledInputs: { type: 'array', items: { type: 'string' } },
                    },
                }, 'Created'),
                ...writeErrors,
            },
        },
    },
    '/variables': {
        get: {
            operationId: 'listVariables',
            summary: 'Global variables of one database; {{name}} in a Document shows the value',
            parameters: [{ ...spaceQuery, description: 'Space id or "personal" (default)' }],
            responses: {
                200: json({
                    type: 'object',
                    properties: {
                        space: { type: ['string', 'null'] },
                        variables: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    key: { type: 'string', description: 'Normalized name (lower case, single spaces)' },
                                    displayKey: { type: 'string' },
                                    value: { type: 'string' },
                                    updatedAt: { type: 'string' },
                                },
                            },
                        },
                        truncated: { type: 'boolean' },
                    },
                }),
                ...errors,
            },
        },
    },
    '/documents/{id}/pdf': {
        get: {
            operationId: 'exportDocumentPdf',
            summary: 'The Document as a PDF, rendered like the app\'s Export',
            parameters: [
                idPath,
                spaceQuery,
                { name: 'pageSize', in: 'query', schema: { type: 'string', enum: ['A4', 'Letter'] }, description: 'Default: the print style\'s paper size' },
            ],
            responses: {
                200: { description: 'The PDF (Content-Disposition inline, with a filename from the title)', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
                ...errors,
                ...PDF_ERRORS,
            },
        },
    },
};
