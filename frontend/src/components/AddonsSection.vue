<template>
    <section
        class="mt-8 border-t border-gray-200 pt-6"
        data-testid="settings-addons"
    >
        <h2 class="pn-title-modal mb-1">Add-ons</h2>
        <p class="pn-body mb-4">
            Add-ons connect Panino to services outside it. They are off until you turn them on.
        </p>

        <div
            v-if="store.error"
            class="pn-alert pn-alert-error mb-4"
            role="alert"
            data-testid="addons-error"
        >
            {{ store.error }}
        </div>

        <p
            v-if="store.isLoading && !store.isLoaded"
            class="pn-body"
        >
            Loading…
        </p>
        <p
            v-else-if="store.addons.length === 0"
            class="pn-body"
            data-testid="addons-empty"
        >
            No add-ons are available on this server.
        </p>
        <ul
            v-else
            class="space-y-3"
        >
            <li
                v-for="addon in store.addons"
                :key="addon.id"
                class="pn-panel p-4"
                :data-testid="`addon-${addon.id}`"
            >
                <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                        <h3
                            :id="`addon-${addon.id}-name`"
                            class="pn-title-section"
                        >
                            {{ addon.name }}
                        </h3>
                        <p class="pn-help">{{ addon.description }}</p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        class="addon-switch"
                        :aria-checked="addon.enabled"
                        :aria-labelledby="`addon-${addon.id}-name`"
                        :disabled="store.isSwitching(addon.id)"
                        :data-testid="`addon-${addon.id}-switch`"
                        @click="toggle(addon)"
                    >
                        <span aria-hidden="true"></span>
                    </button>
                </div>

                <div
                    v-if="confirming === addon.id"
                    class="pn-alert pn-alert-warning mt-3 flex-col"
                    :data-testid="`addon-${addon.id}-confirm`"
                >
                    <p>
                        Turn off {{ addon.name }}? Your connection and what you sent are kept.
                        Syncs pause until you turn it back on.
                    </p>
                    <div class="mt-2 flex flex-wrap gap-2">
                        <BaseButton
                            variant="primary"
                            size="sm"
                            :data-testid="`addon-${addon.id}-turn-off`"
                            @click="turnOff(addon)"
                        >
                            Turn off
                        </BaseButton>
                        <BaseButton
                            variant="secondary"
                            size="sm"
                            @click="confirming = null"
                        >
                            Keep on
                        </BaseButton>
                    </div>
                </div>
                <div
                    v-else-if="addon.enabled"
                    class="mt-3"
                    :data-testid="`addon-${addon.id}-card`"
                >
                    <slot
                        :name="addon.id"
                        :addon="addon"
                    />
                </div>
            </li>
        </ul>
    </section>
</template>

<script setup>
/**
 * Settings → Add-ons (docs/specs/active/addons.md): the add-ons this server
 * offers, each with a switch. An add-on's own card goes in the slot named after
 * its id and renders only while the add-on is on.
 */
import { ref } from 'vue';
import BaseButton from '@/components/BaseButton.vue';
import { useAddonsStore } from '@/store/addonsStore';
import { useUiStore } from '@/store/uiStore';

const store = useAddonsStore();
const ui = useUiStore();
/** The add-on id whose "turn off" question is open. */
const confirming = ref(null);

function toggle(addon) {
    if (addon.enabled) {
        confirming.value = confirming.value === addon.id ? null : addon.id;
        return;
    }
    void turnOn(addon);
}

async function turnOn(addon) {
    if (await store.setEnabled(addon.id, true)) ui.addToast(`${addon.name} is on.`, 'success');
}

async function turnOff(addon) {
    confirming.value = null;
    if (await store.setEnabled(addon.id, false)) ui.addToast(`${addon.name} is off. Your connection is kept.`, 'info');
}
</script>

<style scoped>
.addon-switch {
    position: relative;
    flex-shrink: 0;
    width: 44px;
    height: 24px;
    border-radius: 9999px;
    background: #d1d5db;
    transition: background-color 150ms ease;
}

.addon-switch:focus-visible {
    outline: 2px solid #6b7280;
    outline-offset: 2px;
}

.addon-switch:disabled {
    opacity: 0.6;
}

.addon-switch[aria-checked='true'] {
    background: #1f2937;
}

.addon-switch span {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 9999px;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    transition: transform 150ms ease;
}

.addon-switch[aria-checked='true'] span {
    transform: translateX(20px);
}
</style>
