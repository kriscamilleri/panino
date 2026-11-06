<template>
    <section data-testid="ai-connected-apps">
        <h3 class="pn-label mb-1">Connected apps</h3>
        <p class="pn-help mb-3">Apps you approved when they asked to sign in to Panino. Disconnecting stops them at once.</p>

        <div
            v-if="store.connectionsError"
            class="pn-alert pn-alert-error mb-3"
            role="alert"
            data-testid="ai-connected-apps-error"
        >{{ store.connectionsError }}</div>

        <p
            v-if="store.connections.length === 0"
            class="pn-help"
            data-testid="ai-connected-apps-empty"
        >No apps are connected.</p>
        <ul
            v-else
            class="space-y-2"
            data-testid="ai-connected-apps-list"
        >
            <li
                v-for="app in store.connections"
                :key="app.id"
                class="pn-panel flex flex-wrap items-start justify-between gap-3 p-3"
                :data-testid="`ai-connected-app-${app.id}`"
            >
                <div class="min-w-0">
                    <p class="pn-body break-words font-medium">{{ app.name }}</p>
                    <p class="pn-help break-words">
                        {{ app.host ? `From ${app.host}` : `Returns to ${app.redirectHost}` }}
                        · {{ app.scope === 'write' ? 'Read & write' : 'Read only' }}
                        · {{ app.spaceAccess === 'personal' ? 'Personal only' : 'All spaces' }}
                    </p>
                    <p class="pn-help">
                        Connected {{ formatKeyDate(app.createdAt, '—') }} · Last used {{ formatKeyDate(app.lastUsedAt, 'never') }}
                    </p>
                </div>
                <div
                    v-if="confirming === app.id"
                    class="flex flex-wrap items-center gap-2"
                >
                    <span class="pn-help">Disconnect {{ app.name }}?</span>
                    <BaseButton
                        variant="danger"
                        size="sm"
                        :data-testid="`ai-connected-app-confirm-${app.id}`"
                        @click="disconnect(app)"
                    >Disconnect</BaseButton>
                    <BaseButton
                        variant="secondary"
                        size="sm"
                        @click="confirming = null"
                    >Keep</BaseButton>
                </div>
                <BaseButton
                    v-else
                    variant="secondary"
                    size="sm"
                    :data-testid="`ai-connected-app-disconnect-${app.id}`"
                    @click="confirming = app.id"
                >
                    <Unplug class="h-4 w-4" />
                    <span>Disconnect</span>
                </BaseButton>
            </li>
        </ul>
    </section>
</template>

<script setup>
/** Apps connected through OAuth (docs/specs/active/ai-integration.md §6.6). */
import { onMounted, ref } from 'vue';
import { Unplug } from 'lucide-vue-next';
import BaseButton from '@/components/BaseButton.vue';
import { useUiStore } from '@/store/uiStore';
import { useAiAddonStore } from '../store';
import { formatKeyDate } from '../utils/apiKeys';

const store = useAiAddonStore();
const ui = useUiStore();
const confirming = ref(null);

async function disconnect(app) {
    try {
        await store.disconnect(app.id);
        confirming.value = null;
        ui.addToast(`Disconnected “${app.name}”`, 'success');
    } catch {
        // The store shows the message.
    }
}

onMounted(() => store.fetchConnections());
</script>
