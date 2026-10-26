<template>
    <BaseModal
        :show="show"
        title="Odoo"
        size="lg"
        close-testid="odoo-modal-close"
        @close="emit('close')"
    >
        <div class="space-y-5">
            <p class="pn-body">
                Connect Panino to your Odoo (version 19 or later). What you send appears in Odoo under your Odoo user's name.
            </p>

            <div
                v-if="store.error"
                class="pn-alert pn-alert-error"
                role="alert"
                data-testid="odoo-modal-error"
            >
                {{ store.error }}
            </div>

            <div
                v-if="store.isLoading && !store.status"
                class="pn-body"
            >
                Loading…
            </div>

            <section
                v-else-if="store.isConnected && !changing"
                class="pn-panel p-4 space-y-4"
                data-testid="odoo-connected"
            >
                <div class="flex flex-wrap items-start justify-between gap-4">
                    <div class="min-w-0">
                        <h4 class="pn-title-section">Connected</h4>
                        <p
                            class="mt-1 pn-body break-words"
                            data-testid="odoo-connected-summary"
                        >
                            {{ host }}<span v-if="store.status.databaseName"> · {{ store.status.databaseName }}</span>
                            as {{ store.status.odooUserName || 'your Odoo user' }}
                        </p>
                        <p class="pn-help">
                            Odoo {{ store.status.odooVersion }}
                            <span v-if="apps.length"> · {{ apps.join(', ') }}</span>
                        </p>
                    </div>
                </div>

                <div
                    v-if="store.status.lastError"
                    class="pn-alert pn-alert-error"
                    data-testid="odoo-last-error"
                >
                    {{ store.status.lastErrorMessage }}
                </div>
                <div
                    v-else-if="expiryMessage"
                    class="pn-alert pn-alert-warning"
                    data-testid="odoo-key-expiry"
                >
                    {{ expiryMessage }}
                </div>

                <div class="flex flex-wrap gap-3">
                    <BaseButton
                        variant="secondary"
                        size="md"
                        :disabled="busy"
                        data-testid="odoo-check"
                        @click="store.check()"
                    >
                        <RefreshCw class="h-4 w-4" />
                        <span>{{ store.isChecking ? 'Checking…' : 'Check connection' }}</span>
                    </BaseButton>
                    <BaseButton
                        variant="secondary"
                        size="md"
                        :disabled="busy"
                        data-testid="odoo-change"
                        @click="startChange"
                    >
                        <KeyRound class="h-4 w-4" />
                        <span>Change key or address</span>
                    </BaseButton>
                    <BaseButton
                        variant="secondary"
                        size="md"
                        :disabled="busy"
                        data-testid="odoo-disconnect"
                        @click="store.disconnect()"
                    >
                        <Unplug class="h-4 w-4" />
                        <span>{{ store.isDisconnecting ? 'Disconnecting…' : 'Disconnect' }}</span>
                    </BaseButton>
                </div>
            </section>

            <form
                v-else
                class="pn-panel p-4 space-y-4"
                data-testid="odoo-connect-form"
                @submit.prevent="submit"
            >
                <div>
                    <label
                        class="pn-label"
                        for="odoo-base-url"
                    >Odoo address</label>
                    <input
                        id="odoo-base-url"
                        v-model="form.baseUrl"
                        class="pn-input"
                        type="url"
                        inputmode="url"
                        placeholder="https://yourcompany.odoo.com"
                        autocomplete="url"
                        required
                        data-testid="odoo-base-url"
                    >
                </div>
                <div>
                    <label
                        class="pn-label"
                        for="odoo-database"
                    >Database <span class="pn-help">(optional)</span></label>
                    <input
                        id="odoo-database"
                        v-model="form.databaseName"
                        class="pn-input"
                        type="text"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck="false"
                        data-testid="odoo-database"
                    >
                    <p class="pn-help mt-1">Needed when your Odoo server holds more than one database.</p>
                </div>
                <div>
                    <label
                        class="pn-label"
                        for="odoo-api-key"
                    >API key</label>
                    <input
                        id="odoo-api-key"
                        v-model="form.apiKey"
                        class="pn-input"
                        type="password"
                        autocomplete="off"
                        autocapitalize="off"
                        spellcheck="false"
                        required
                        data-testid="odoo-api-key"
                    >
                    <p class="pn-help mt-1">
                        In Odoo, open your avatar → My Preferences → Account Security → New API Key. Panino keeps it encrypted on its server and never shows it again.
                    </p>
                </div>
                <div>
                    <label
                        class="pn-label"
                        for="odoo-key-expires"
                    >Key expires on</label>
                    <input
                        id="odoo-key-expires"
                        v-model="form.keyExpiresOn"
                        class="pn-input"
                        type="date"
                        data-testid="odoo-key-expires"
                    >
                    <p class="pn-help mt-1">Odoo keys last at most three months. Panino reminds you two weeks before.</p>
                </div>
                <p class="pn-help">On Odoo Online, the API is only available on the Custom plan.</p>
                <div class="flex flex-wrap gap-3">
                    <BaseButton
                        type="submit"
                        variant="primary"
                        size="md"
                        :disabled="store.isSaving || !form.baseUrl || !form.apiKey"
                        data-testid="odoo-connect"
                    >
                        <Plug class="h-4 w-4" />
                        <span>{{ store.isSaving ? 'Connecting…' : 'Connect' }}</span>
                    </BaseButton>
                    <BaseButton
                        v-if="changing"
                        type="button"
                        variant="secondary"
                        size="md"
                        :disabled="store.isSaving"
                        data-testid="odoo-change-cancel"
                        @click="changing = false"
                    >
                        Cancel
                    </BaseButton>
                </div>
            </form>
        </div>
    </BaseModal>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { KeyRound, Plug, RefreshCw, Unplug } from 'lucide-vue-next';
import BaseModal from '@/components/BaseModal.vue';
import BaseButton from '@/components/BaseButton.vue';
import { useOdooStore } from '@/store/odooStore';
import { appLabels, keyExpiryMessage, odooHost } from '@/utils/odooConnection';

const props = defineProps({
    show: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);

const store = useOdooStore();
const changing = ref(false);
const form = reactive({ baseUrl: '', databaseName: '', apiKey: '', keyExpiresOn: '' });

const host = computed(() => odooHost(store.status?.baseUrl));
const apps = computed(() => appLabels(store.status?.apps));
const expiryMessage = computed(() => keyExpiryMessage(store.status?.keyExpiresOn));
const busy = computed(() => store.isChecking || store.isDisconnecting || store.isSaving);

watch(() => props.show, (open) => {
    if (!open) {
        form.apiKey = '';
        return;
    }
    changing.value = false;
    void store.fetchStatus();
}, { immediate: true });

function startChange() {
    form.baseUrl = store.status?.baseUrl || '';
    form.databaseName = store.status?.databaseName || '';
    form.keyExpiresOn = '';
    form.apiKey = '';
    changing.value = true;
}

async function submit() {
    const ok = await store.connect({ ...form });
    // The key is never kept in the page longer than one attempt.
    form.apiKey = '';
    if (ok) changing.value = false;
}
</script>
