<template>
    <div
        class="space-y-6"
        :class="layout === 'phone' ? 'px-4 py-3' : ''"
        data-testid="ai-settings-card"
    >
        <McpSetup :url="store.setup?.mcpUrl || null" />
        <ConnectedApps />
        <ApiKeysSection />
    </div>
</template>

<script setup>
/**
 * Under the AI agents switch in Settings, desktop and phone
 * (docs/specs/active/ai-integration.md §9).
 */
import { onMounted } from 'vue';
import { useAiAddonStore } from '../store';
import ApiKeysSection from './ApiKeysSection.vue';
import ConnectedApps from './ConnectedApps.vue';
import McpSetup from './McpSetup.vue';

defineProps({
    layout: { type: String, default: 'desktop' },
});

const store = useAiAddonStore();
onMounted(() => store.fetchSetup());
</script>
