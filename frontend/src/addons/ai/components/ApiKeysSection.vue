<template>
    <section
        id="api-keys"
        ref="sectionEl"
        data-testid="settings-api-keys"
    >
        <div class="mb-1 flex flex-wrap items-center justify-between gap-3">
            <h3 class="pn-label">API keys</h3>
            <BaseButton
                v-if="!showForm"
                variant="secondary"
                size="sm"
                :disabled="atLimit"
                data-testid="api-keys-new"
                @click="openForm"
            >
                <KeyRound class="h-4 w-4" />
                <span>Create key</span>
            </BaseButton>
        </div>
        <p class="pn-help mb-3">
            For scripts and agents that take a key: the REST API and the MCP server.
            A key works only there, never to sign in.
        </p>

        <div
            v-if="store.error"
            class="pn-alert pn-alert-error mb-4"
            role="alert"
            data-testid="api-keys-error"
        >
            {{ store.error }}
        </div>

        <div
            v-if="store.createdSecret"
            class="pn-alert pn-alert-success mb-4 flex-col items-stretch"
            data-testid="api-keys-created"
        >
            <p class="font-medium">“{{ store.createdSecret.key.name }}” is ready. Copy the key now: this is the only time it is shown.</p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
                <code
                    class="min-w-0 flex-1 break-all rounded-md bg-white px-2 py-1.5 font-mono text-xs text-gray-900 ring-1 ring-gray-200"
                    data-testid="api-keys-secret"
                >{{ store.createdSecret.secret }}</code>
                <BaseButton
                    variant="primary"
                    size="sm"
                    data-testid="api-keys-copy"
                    @click="copy(store.createdSecret.secret, 'Key copied')"
                >
                    <Copy class="h-4 w-4" />
                    <span>Copy key</span>
                </BaseButton>
            </div>
            <p class="pn-help mt-3">Try it:</p>
            <div class="mt-1 flex flex-wrap items-center gap-2">
                <code
                    class="min-w-0 flex-1 break-all rounded-md bg-white px-2 py-1.5 font-mono text-xs text-gray-700 ring-1 ring-gray-200"
                    data-testid="api-keys-curl"
                >{{ curl }}</code>
                <BaseButton
                    variant="secondary"
                    size="sm"
                    @click="copy(curl, 'Command copied')"
                >
                    <Copy class="h-4 w-4" />
                    <span>Copy</span>
                </BaseButton>
            </div>
            <template v-if="claudeCommand">
                <p class="pn-help mt-3">Or add Panino to Claude Code with this key:</p>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                    <code
                        class="min-w-0 flex-1 break-all rounded-md bg-white px-2 py-1.5 font-mono text-xs text-gray-700 ring-1 ring-gray-200"
                        data-testid="api-keys-claude-code"
                    >{{ claudeCommand }}</code>
                    <BaseButton
                        variant="secondary"
                        size="sm"
                        @click="copy(claudeCommand, 'Command copied')"
                    >
                        <Copy class="h-4 w-4" />
                        <span>Copy</span>
                    </BaseButton>
                </div>
            </template>
            <p class="pn-help mt-2">
                The API describes itself at <code class="font-mono">{{ baseUrl }}/openapi.json</code>.
            </p>
            <div class="mt-3">
                <BaseButton
                    variant="secondary"
                    size="sm"
                    data-testid="api-keys-done"
                    @click="store.dismissSecret()"
                >
                    Done
                </BaseButton>
            </div>
        </div>

        <form
            v-if="showForm"
            class="pn-panel mb-4 space-y-4 p-4"
            data-testid="api-keys-form"
            @submit.prevent="submit"
        >
            <div>
                <label
                    for="api-key-name"
                    class="pn-label"
                >Name</label>
                <input
                    id="api-key-name"
                    ref="nameInput"
                    v-model="form.name"
                    class="pn-input mt-1"
                    maxlength="60"
                    placeholder="e.g. Claude Code"
                    required
                    data-testid="api-keys-name"
                />
            </div>
            <fieldset>
                <legend class="pn-label">Access</legend>
                <div class="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                    <label
                        v-for="option in ACCESS_OPTIONS"
                        :key="option.value"
                        class="flex items-center gap-2 text-sm"
                    >
                        <input
                            v-model="form.scope"
                            type="radio"
                            class="pn-radio"
                            name="api-key-scope"
                            :value="option.value"
                            :data-testid="`api-keys-scope-${option.value}`"
                        />
                        {{ option.label }}
                    </label>
                </div>
            </fieldset>
            <fieldset>
                <legend class="pn-label">Documents</legend>
                <div class="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                    <label
                        v-for="option in SPACE_OPTIONS"
                        :key="option.value"
                        class="flex items-center gap-2 text-sm"
                    >
                        <input
                            v-model="form.spaceAccess"
                            type="radio"
                            class="pn-radio"
                            name="api-key-spaces"
                            :value="option.value"
                            :data-testid="`api-keys-spaces-${option.value}`"
                        />
                        {{ option.label }}
                    </label>
                </div>
            </fieldset>
            <div>
                <label
                    for="api-key-expiry"
                    class="pn-label"
                >Expires after</label>
                <select
                    id="api-key-expiry"
                    v-model="form.expiresInDays"
                    class="pn-select mt-1"
                    data-testid="api-keys-expiry"
                >
                    <option
                        v-for="option in EXPIRY_OPTIONS"
                        :key="String(option.value)"
                        :value="option.value"
                    >
                        {{ option.label }}
                    </option>
                </select>
            </div>
            <p
                v-if="form.scope === 'write'"
                class="pn-help"
            >
                A read &amp; write key can create, edit and move Documents. Deleting moves a
                Document to a Trash folder, and every change is kept in revision history.
            </p>
            <div class="flex flex-wrap gap-2">
                <BaseButton
                    variant="primary"
                    size="md"
                    type="submit"
                    :disabled="store.isSaving || !form.name.trim()"
                    data-testid="api-keys-create"
                >
                    Create key
                </BaseButton>
                <BaseButton
                    variant="secondary"
                    size="md"
                    type="button"
                    @click="showForm = false"
                >
                    Cancel
                </BaseButton>
            </div>
        </form>

        <p
            v-if="store.isLoading && !store.isLoaded"
            class="pn-body"
        >
            Loading…
        </p>
        <p
            v-else-if="store.isLoaded && store.keys.length === 0 && !showForm"
            class="pn-help"
            data-testid="api-keys-empty"
        >
            You have no API keys.
        </p>
        <ul
            v-else-if="store.keys.length"
            class="space-y-2"
            data-testid="api-keys-list"
        >
            <li
                v-for="key in store.keys"
                :key="key.id"
                class="pn-panel p-3"
                :data-testid="`api-key-${key.id}`"
            >
                <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                        <p class="pn-title-section truncate">{{ key.name }}</p>
                        <p class="pn-meta">
                            <code class="font-mono">{{ key.prefix }}…</code>
                            · {{ accessLabel(key.scope) }} · {{ spacesLabel(key.spaceAccess) }}
                        </p>
                        <p class="pn-meta">
                            Created {{ formatKeyDate(key.createdAt, '—') }}
                            · Last used {{ formatKeyDate(key.lastUsedAt, 'never') }}
                            · <span :class="key.expired ? 'font-medium text-red-700' : ''">Expires {{ expiryLabel(key) }}</span>
                        </p>
                    </div>
                    <BaseButton
                        v-if="confirming !== key.id"
                        variant="ghost"
                        size="sm"
                        :data-testid="`api-key-${key.id}-revoke`"
                        @click="confirming = key.id"
                    >
                        <Trash2 class="h-4 w-4" />
                        <span>Revoke</span>
                    </BaseButton>
                </div>
                <div
                    v-if="confirming === key.id"
                    class="pn-alert pn-alert-warning mt-2 flex-col items-stretch"
                    :data-testid="`api-key-${key.id}-confirm`"
                >
                    <p>Revoke “{{ key.name }}”? Anything using it stops working immediately.</p>
                    <div class="mt-2 flex flex-wrap gap-2">
                        <BaseButton
                            variant="danger"
                            size="sm"
                            :disabled="store.isSaving"
                            :data-testid="`api-key-${key.id}-revoke-confirm`"
                            @click="revoke(key)"
                        >
                            Revoke
                        </BaseButton>
                        <BaseButton
                            variant="secondary"
                            size="sm"
                            @click="confirming = null"
                        >
                            Keep
                        </BaseButton>
                    </div>
                </div>
            </li>
        </ul>
        <p
            v-if="atLimit"
            class="pn-help mt-2"
        >
            You have {{ store.limit }} keys, the most allowed. Revoke one to create another.
        </p>
    </section>
</template>

<script setup>
/**
 * API keys, in the AI agents add-on's settings card (docs/specs/active/llm-api.md
 * §5.4, ai-integration.md §9): create, list and revoke personal API keys for the
 * REST API and the MCP server. A new key's secret is shown once.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Copy, KeyRound, Trash2 } from 'lucide-vue-next';
import BaseButton from '@/components/BaseButton.vue';
import { useUiStore } from '@/store/uiStore';
import { useAiAddonStore } from '../store';
import { mcpSnippet } from '../utils/mcpSetup';
import {
    ACCESS_OPTIONS,
    EXPIRY_OPTIONS,
    SPACE_OPTIONS,
    accessLabel,
    apiV1BaseUrl,
    curlExample,
    expiryLabel,
    formatKeyDate,
    spacesLabel,
} from '../utils/apiKeys';

const store = useAiAddonStore();
const ui = useUiStore();
const route = useRoute();

const sectionEl = ref(null);
const nameInput = ref(null);
const showForm = ref(false);
const confirming = ref(null);
const form = reactive({ name: '', scope: 'read', spaceAccess: 'all', expiresInDays: 90 });

const fallbackBaseUrl = apiV1BaseUrl({
    isProd: import.meta.env.PROD,
    origin: window.location.origin,
    apiServiceUrl: import.meta.env.VITE_API_SERVICE_URL,
});
const baseUrl = computed(() => store.setup?.apiBaseUrl || fallbackBaseUrl);
const curl = computed(() => (store.createdSecret ? curlExample(baseUrl.value, store.createdSecret.secret) : ''));
const claudeCommand = computed(() => (store.createdSecret && store.setup?.mcpUrl
    ? mcpSnippet('claude-code', store.setup.mcpUrl, { key: store.createdSecret.secret })
    : ''));
const atLimit = computed(() => store.keys.length >= store.limit);

async function openForm() {
    Object.assign(form, { name: '', scope: 'read', spaceAccess: 'all', expiresInDays: 90 });
    store.dismissSecret();
    showForm.value = true;
    await nextTick();
    nameInput.value?.focus();
}

async function submit() {
    try {
        await store.createKey({ ...form, name: form.name.trim() });
        showForm.value = false;
    } catch {
        // The store shows the message.
    }
}

async function revoke(key) {
    try {
        await store.revokeKey(key.id);
        confirming.value = null;
        ui.addToast(`Revoked “${key.name}”`, 'success');
    } catch {
        // The store shows the message.
    }
}

async function copy(text, message) {
    try {
        await navigator.clipboard.writeText(text);
        ui.addToast(message, 'success');
    } catch {
        ui.addToast('Could not copy. Select the text and copy it yourself.', 'error');
    }
}

// Shown once means once: leaving Settings forgets the secret.
onBeforeUnmount(() => store.dismissSecret());

onMounted(async () => {
    await store.fetchKeys();
    if (route.hash === '#api-keys') {
        await nextTick();
        sectionEl.value?.scrollIntoView({ block: 'start' });
    }
});
</script>
