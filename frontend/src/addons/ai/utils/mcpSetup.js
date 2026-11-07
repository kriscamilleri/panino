// Pure helpers: how to connect common MCP clients to Panino
// (docs/specs/active/ai-integration.md §9). Every client needs only the MCP URL,
// plus either OAuth sign-in (URL only) or an API key header.

export const KEY_PLACEHOLDER = 'pnk_…';

/**
 * @typedef {{ id: string, label: string, signIn: 'oauth' | 'key' | 'either',
 *   steps: string, snippet?: (url: string, key: string|null) => string }} McpClient
 */

/** @type {readonly McpClient[]} */
export const MCP_CLIENTS = Object.freeze([
    {
        id: 'claude-code',
        label: 'Claude Code',
        signIn: 'either',
        steps: 'Run this in a terminal. Without the header, Claude Code asks you to sign in to Panino the first time you use it (/mcp).',
        snippet: (url, key) => `claude mcp add --transport http panino ${url}${key ? ` --header "Authorization: Bearer ${key}"` : ''}`,
    },
    {
        id: 'claude-apps',
        label: 'claude.ai and Claude Desktop',
        signIn: 'oauth',
        steps: 'Add a custom connector and paste the URL. Claude opens Panino so you can approve the connection.',
    },
    {
        id: 'chatgpt',
        label: 'ChatGPT',
        signIn: 'oauth',
        steps: 'Create a custom connector (MCP server) with the URL and OAuth sign-in. ChatGPT opens Panino so you can approve the connection.',
    },
    {
        id: 'gemini-cli',
        label: 'Gemini CLI',
        signIn: 'either',
        steps: 'Add this to ~/.gemini/settings.json. Leave out "headers" to sign in to Panino instead (/mcp auth panino).',
        snippet: (url, key) => JSON.stringify({ mcpServers: { panino: { httpUrl: url, ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}) } } }, null, 2),
    },
    {
        id: 'json',
        label: 'Cursor, VS Code, LM Studio and others',
        signIn: 'either',
        steps: 'Most clients read a JSON list of servers like this one (VS Code calls the list "servers"). Leave out "headers" if the client signs in with OAuth.',
        snippet: (url, key) => JSON.stringify({ mcpServers: { panino: { url, ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}) } } }, null, 2),
    },
    {
        id: 'other',
        label: 'Other MCP clients',
        signIn: 'either',
        steps: 'Use the URL (Streamable HTTP). Sign in with OAuth, or send an API key in the Authorization header.',
        snippet: (url, key) => `URL:    ${url}\nHeader: Authorization: Bearer ${key || KEY_PLACEHOLDER}`,
    },
]);

/** @returns {McpClient|null} */
export function mcpClient(id) {
    return MCP_CLIENTS.find((client) => client.id === id) || null;
}

/**
 * The text to show or copy for a client. `key` is a real key only right after
 * it was created; otherwise a placeholder stands in when the client needs one.
 * @param {string} id
 * @param {string} url
 * @param {{ key?: string|null, useKey?: boolean }} [options]
 */
export function mcpSnippet(id, url, { key = null, useKey = false } = {}) {
    const client = mcpClient(id);
    if (!client?.snippet) return '';
    const header = key || (useKey ? KEY_PLACEHOLDER : null);
    return client.snippet(url, header);
}
