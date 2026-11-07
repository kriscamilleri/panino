<template>
    <div
        class="mx-auto max-w-xl"
        data-testid="ai-authorize"
    >
        <div
            v-if="state === 'error'"
            class="space-y-4"
            data-testid="ai-authorize-error"
        >
            <h2 class="pn-title-modal">Can't connect this app</h2>
            <p class="pn-body">{{ errorMessage }}</p>
            <p class="pn-help">Start again from the app you were connecting. Nothing was shared.</p>
        </div>

        <p
            v-else-if="state === 'loading'"
            class="pn-body"
            data-testid="ai-authorize-loading"
        >Loading…</p>

        <div
            v-else-if="state === 'leaving'"
            class="space-y-2"
            data-testid="ai-authorize-leaving"
        >
            <p class="pn-body">{{ leavingMessage }}</p>
        </div>

        <form
            v-else-if="request"
            class="space-y-5"
            data-testid="ai-authorize-form"
            @submit.prevent="decide(true)"
        >
            <div>
                <h2
                    class="pn-title-modal break-words"
                    data-testid="ai-authorize-title"
                >Connect {{ request.client.name }} to Panino?</h2>
                <p
                    v-if="request.client.host"
                    class="pn-help mt-1"
                    data-testid="ai-authorize-identity"
                >Identified by {{ request.client.host }}.</p>
                <p
                    v-else
                    class="pn-alert pn-alert-warning mt-2"
                    data-testid="ai-authorize-identity"
                >This app registered itself, so Panino cannot confirm who made it. Continue only if you just started this from an app you trust.</p>
            </div>

            <div class="pn-panel space-y-1 p-3">
                <p class="pn-body">It will be able to {{ form.access === 'write' ? 'read, create and change' : 'read' }} your Documents{{ form.spaceAccess === 'all' ? ', including your shared spaces' : ' in your personal space' }}.</p>
                <p class="pn-help">What it reads leaves Panino. Its edits are kept in revision history as “{{ request.client.name }}”. It cannot delete anything: removing moves a Document to Trash.</p>
                <p
                    class="pn-help"
                    data-testid="ai-authorize-redirect"
                >After you choose, you go back to <strong>{{ request.redirectHost }}</strong>{{ request.redirectIsLoopback ? ', an app on this computer' : '' }}.</p>
            </div>

            <fieldset>
                <legend class="pn-label">Access</legend>
                <div class="mt-1 flex flex-wrap gap-4">
                    <label
                        v-for="option in ACCESS_OPTIONS"
                        :key="option.value"
                        class="pn-body flex items-center gap-2"
                    >
                        <input
                            v-model="form.access"
                            type="radio"
                            name="ai-authorize-access"
                            :value="option.value"
                            :data-testid="`ai-authorize-access-${option.value}`"
                        >
                        <span>{{ option.label }}</span>
                    </label>
                </div>
            </fieldset>

            <fieldset>
                <legend class="pn-label">Documents</legend>
                <div class="mt-1 flex flex-wrap gap-4">
                    <label
                        v-for="option in SPACE_OPTIONS"
                        :key="option.value"
                        class="pn-body flex items-center gap-2"
                    >
                        <input
                            v-model="form.spaceAccess"
                            type="radio"
                            name="ai-authorize-spaces"
                            :value="option.value"
                            :data-testid="`ai-authorize-spaces-${option.value}`"
                        >
                        <span>{{ option.label }}</span>
                    </label>
                </div>
            </fieldset>

            <div
                v-if="actionError"
                class="pn-alert pn-alert-error"
                role="alert"
                data-testid="ai-authorize-action-error"
            >{{ actionError }}</div>

            <div class="flex flex-wrap gap-2">
                <BaseButton
                    type="submit"
                    variant="primary"
                    size="md"
                    :disabled="busy"
                    data-testid="ai-authorize-approve"
                >Connect</BaseButton>
                <BaseButton
                    type="button"
                    variant="secondary"
                    size="md"
                    :disabled="busy"
                    data-testid="ai-authorize-deny"
                    @click="decide(false)"
                >Cancel</BaseButton>
            </div>
        </form>
    </div>
</template>

<script setup>
/**
 * The OAuth consent page (docs/specs/active/ai-integration.md §6.4), at
 * #/addons/ai/authorize?request=<id>. An app's sign-in lands here; the user
 * picks the access and Documents, then the browser goes back to the app.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import BaseButton from '@/components/BaseButton.vue';
import { useAiAddonStore } from '../store';
import { ACCESS_OPTIONS, SPACE_OPTIONS } from '../utils/apiKeys';

const props = defineProps({
    query: { type: Object, default: () => ({}) },
});

const ERROR_MESSAGES = {
    invalid_client: 'Panino could not identify the app that sent you here.',
    invalid_redirect_uri: 'The app asked to send you back to an address it has not registered.',
    REQUEST_NOT_FOUND: 'This sign-in request has expired or was already used.',
};

const store = useAiAddonStore();
const request = ref(null);
const state = ref('loading');
const errorMessage = ref('');
const actionError = ref('');
const busy = ref(false);
const approved = ref(false);
const form = reactive({ access: 'read', spaceAccess: 'all' });

const requestId = computed(() => (typeof props.query.request === 'string' ? props.query.request : ''));
const leavingMessage = computed(() => (approved.value
    ? `Connected. Returning to ${request.value?.redirectHost || 'the app'}…`
    : `Cancelled. Returning to ${request.value?.redirectHost || 'the app'}…`));

function fail(code, fallback) {
    errorMessage.value = ERROR_MESSAGES[code] || fallback || 'This sign-in request is not valid.';
    state.value = 'error';
}

async function decide(approve) {
    busy.value = true;
    actionError.value = '';
    try {
        const redirectTo = await store.decideAuthorization(requestId.value, { approve, access: form.access, spaceAccess: form.spaceAccess });
        approved.value = approve;
        state.value = 'leaving';
        window.location.assign(redirectTo);
    } catch (error) {
        if (error.code === 'REQUEST_NOT_FOUND') fail(error.code);
        else actionError.value = error.message;
    } finally {
        busy.value = false;
    }
}

onMounted(async () => {
    if (typeof props.query.error === 'string') return fail(props.query.error);
    if (!requestId.value) return fail('missing');
    try {
        request.value = await store.loadAuthorization(requestId.value);
        form.access = request.value.requestedAccess === 'write' ? 'write' : 'read';
        state.value = 'ready';
    } catch (error) {
        fail(error.code, error.message);
    }
    return undefined;
});
</script>
