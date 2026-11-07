// The MCP tool definitions stay portable: every function-calling model must
// accept them (docs/specs/active/ai-integration.md §5.3).
import { describe, expect, it } from 'vitest';
import { listTools, PORTABLE_SCHEMA_KEYS, SERVER_INSTRUCTIONS } from '../../mcpTools.js';

// Per area, in the order api/index.js lists them.
const AREA_TOOLS = {
    documents: {
        read: ['get_account', 'list_spaces', 'search_documents', 'list_documents', 'list_folders', 'get_document'],
        write: ['create_document', 'update_document', 'append_to_document'],
    },
    folders: {
        read: ['get_folder', 'list_trash'],
        write: ['move_document_to_trash', 'create_folder', 'rename_folder', 'move_folder', 'move_folder_to_trash', 'restore_from_trash'],
    },
    revisions: {
        read: ['list_revisions', 'get_revision', 'compare_revisions'],
        write: ['save_revision', 'restore_revision'],
    },
    images: {
        read: ['list_images', 'get_image', 'get_image_usage'],
        write: ['upload_image', 'delete_image'],
    },
    library: {
        read: ['list_templates', 'get_template', 'list_variables', 'export_pdf'],
        write: ['create_document_from_template'],
    },
};
const READ_TOOLS = Object.values(AREA_TOOLS).flatMap((area) => area.read);
const WRITE_TOOLS = Object.values(AREA_TOOLS).flatMap((area) => area.write);
const DESTRUCTIVE_TOOLS = ['update_document', 'restore_revision', 'delete_image'];

describe('MCP tool definitions', () => {
    const tools = listTools('write');

    it('offers the v1 operations under stable names', () => {
        expect(new Set(tools.map((tool) => tool.name))).toEqual(new Set([...READ_TOOLS, ...WRITE_TOOLS]));
        expect(tools).toHaveLength(READ_TOOLS.length + WRITE_TOOLS.length);
    });

    it('lists only read tools for read-only access', () => {
        const names = listTools('read').map((tool) => tool.name);
        expect(names).toEqual(tools.filter((tool) => READ_TOOLS.includes(tool.name)).map((tool) => tool.name));
        expect(names).toHaveLength(READ_TOOLS.length);
        for (const name of WRITE_TOOLS) expect(names).not.toContain(name);
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
        for (const tool of tools) {
            expect(tool.annotations.openWorldHint).toBe(false);
            expect(tool.annotations.readOnlyHint).toBe(!WRITE_TOOLS.includes(tool.name));
            expect(tool.annotations.destructiveHint).toBe(DESTRUCTIVE_TOOLS.includes(tool.name));
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
