// The MCP tool definitions stay portable: every function-calling model must
// accept them (docs/specs/active/ai-integration.md §5.3).
import { describe, expect, it } from 'vitest';
import { listTools, PORTABLE_SCHEMA_KEYS, SERVER_INSTRUCTIONS } from '../../mcpTools.js';

const WRITE_TOOLS = ['create_document', 'update_document', 'append_to_document', 'move_document_to_trash', 'create_folder'];
const IMAGE_READ_TOOLS = ['list_images', 'get_image', 'get_image_usage'];
const IMAGE_WRITE_TOOLS = ['upload_image', 'delete_image'];
const ALL_WRITE_TOOLS = [...WRITE_TOOLS, ...IMAGE_WRITE_TOOLS];
const DESTRUCTIVE_TOOLS = ['update_document', 'delete_image'];
const KNOWN_TOOLS = [
    'get_account', 'list_spaces', 'search_documents', 'list_documents', 'list_folders', 'get_document',
    ...WRITE_TOOLS, ...IMAGE_READ_TOOLS, ...IMAGE_WRITE_TOOLS,
];

describe('MCP tool definitions', () => {
    const tools = listTools('write');

    it('offers the v1 operations under stable names', () => {
        expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(KNOWN_TOOLS));
    });

    it('lists only read tools for read-only access', () => {
        const names = listTools('read').map((tool) => tool.name);
        expect(names).toHaveLength(tools.filter((tool) => tool.annotations.readOnlyHint).length);
        for (const name of ALL_WRITE_TOOLS) expect(names).not.toContain(name);
        for (const name of IMAGE_READ_TOOLS) expect(names).toContain(name);
    });

    it.each(tools.map((tool) => [tool.name, tool]))('%s uses a name and schema every client accepts', (name, tool) => {
        expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
        expect(tool.title).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(20);

        const schema = tool.inputSchema;
        expect(Object.keys(schema).sort()).toEqual([...PORTABLE_SCHEMA_KEYS.root].sort());
        expect(schema.type).toBe('object');
        expect(Array.isArray(schema.required)).toBe(true);
        for (const required of schema.required) expect(schema.properties).toHaveProperty(required);
        for (const [property, definition] of Object.entries(schema.properties)) {
            expect(property, `${name}.${property}`).toMatch(/^[a-z][a-z0-9_]*$/);
            for (const key of Object.keys(definition)) {
                expect(PORTABLE_SCHEMA_KEYS.property, `${name}.${property} uses ${key}`).toContain(key);
            }
            expect(PORTABLE_SCHEMA_KEYS.types, `${name}.${property}`).toContain(definition.type);
            expect(definition.description, `${name}.${property}`).toBeTruthy();
        }
    });

    it('marks reads read-only and only replacing or removing writes as destructive', () => {
        for (const tool of tools.filter((candidate) => KNOWN_TOOLS.includes(candidate.name))) {
            expect(tool.annotations.openWorldHint).toBe(false);
            expect(tool.annotations.readOnlyHint, tool.name).toBe(!ALL_WRITE_TOOLS.includes(tool.name));
            expect(tool.annotations.destructiveHint, tool.name).toBe(DESTRUCTIVE_TOOLS.includes(tool.name));
        }
    });

    it('says image deletion is permanent and only on request', () => {
        const remove = tools.find((tool) => tool.name === 'delete_image');
        expect(remove.description).toMatch(/Permanently/);
        expect(remove.description).toMatch(/only when the user asks/);
        expect(SERVER_INSTRUCTIONS).toMatch(/delete_image is permanent/);
    });

    it('tells the model that Document text is data', () => {
        expect(SERVER_INSTRUCTIONS).toMatch(/not instructions/);
    });
});
