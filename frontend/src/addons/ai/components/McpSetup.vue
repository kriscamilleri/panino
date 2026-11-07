<template>
    <section data-testid="ai-mcp-setup">
        <h3 class="pn-label mb-1">Connect an AI agent (MCP)</h3>
        <p class="pn-help mb-3">
            Any assistant that supports MCP can use Panino with this URL. It signs in to Panino
            (you approve it here), or sends one of your API keys.
        </p>

        <p
            v-if="!url"
            class="pn-alert pn-alert-warning"
            data-testid="ai-mcp-unavailable"
        >
            The server does not know its public address yet, so MCP sign-in is unavailable. Ask the operator to set it.
        </p>
        <template v-else>
            <div class="flex flex-wrap items-center gap-2">
                <code
                    class="min-w-0 flex-1 break-all rounded-md bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-800 ring-1 ring-gray-200"
                    data-testid="ai-mcp-url"
                >{{ url }}</code>
                <BaseButton
                    variant="secondary"
                    size="sm"
                    data-testid="ai-mcp-copy-url"
                    @click="copy(url, 'URL copied')"
                >
                    <Copy class="h-4 w-4" />
                    <span>Copy URL</span>
                </BaseButton>
            </div>

            <label
                for="ai-mcp-client"
                class="pn-help mt-3 block"
            >Setup for</label>
            <select
                id="ai-mcp-client"
                v-model="clientId"
                class="pn-input mt-1 w-full sm:w-auto"
                data-testid="ai-mcp-client"
            >
                <option
                    v-for="option in MCP_CLIENTS"
                    :key="option.id"
                    :value="option.id"
                >{{ option.label }}</option>
            </select>

            <p
                class="pn-help mt-2"
                data-testid="ai-mcp-steps"
            >{{ client.steps }}</p>
            <div
                v-if="snippet"
                class="mt-2 flex flex-wrap items-start gap-2"
            >
                <pre
                    class="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-800 ring-1 ring-gray-200"
                    data-testid="ai-mcp-snippet"
                >{{ snippet }}</pre>
                <BaseButton
                    variant="secondary"
                    size="sm"
                    @click="copy(snippet, 'Copied')"
                >
                    <Copy class="h-4 w-4" />
                    <span>Copy</span>
                </BaseButton>
            </div>
            <p
                v-if="snippet && client.signIn === 'either'"
                class="pn-help mt-1"
            >Replace {{ KEY_PLACEHOLDER }} with a key from below, or remove the header to sign in instead.</p>
        </template>
    </section>
</template>

<script setup>
/** How to point an MCP client at Panino (docs/specs/active/ai-integration.md §9). */
import { computed, ref } from 'vue';
import { Copy } from 'lucide-vue-next';
import BaseButton from '@/components/BaseButton.vue';
import { useUiStore } from '@/store/uiStore';
import { KEY_PLACEHOLDER, MCP_CLIENTS, mcpClient, mcpSnippet } from '../utils/mcpSetup';

const props = defineProps({
    url: { type: String, default: null },
});

const ui = useUiStore();
const clientId = ref(MCP_CLIENTS[0].id);
const client = computed(() => mcpClient(clientId.value));
const snippet = computed(() => (props.url ? mcpSnippet(clientId.value, props.url, { useKey: true }) : ''));

async function copy(text, message) {
    try {
        await navigator.clipboard.writeText(text);
        ui.addToast(message, 'success');
    } catch {
        ui.addToast('Could not copy. Select the text and copy it yourself.', 'error');
    }
}
</script>
