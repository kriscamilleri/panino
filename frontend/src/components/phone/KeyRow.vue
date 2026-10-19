<template>
    <!--
        Keys act on pointerdown with the default prevented, so the text field
        keeps focus and the on-screen keyboard stays up while formatting.
    -->
    <div
        class="ph-keyrow"
        :class="{ 'ph-keyrow-docked': docked }"
        role="toolbar"
        :aria-label="label"
        :style="docked ? { bottom: `${keyboardInset}px` } : undefined"
        data-testid="phone-key-row"
    >
        <div class="ph-keyrow-scroll">
            <button
                v-for="key in keys"
                :key="key.id"
                type="button"
                class="ph-key"
                :class="{ 'ph-key-symbol': !key.icon }"
                :aria-label="key.name"
                :data-testid="`phone-key-${key.id}`"
                @pointerdown.prevent
                @click="$emit('press', key.id)"
            >
                <component
                    :is="key.icon"
                    v-if="key.icon"
                    class="h-5 w-5"
                    aria-hidden="true"
                />
                <span
                    v-else
                    aria-hidden="true"
                >{{ key.label }}</span>
            </button>
            <slot />
        </div>
        <button
            type="button"
            class="ph-key ph-key-hide"
            aria-label="Hide keyboard"
            data-testid="phone-key-hide-keyboard"
            @pointerdown.prevent
            @click="hideKeyboard"
        >
            <KeyboardOff
                class="h-5 w-5"
                aria-hidden="true"
            />
        </button>
    </div>
</template>

<script setup>
import { KeyboardOff } from 'lucide-vue-next'
import { useViewport } from '@/composables/useViewport'

defineProps({
    /** `[{ id, name, label? , icon? }]` */
    keys: { type: Array, required: true },
    label: { type: String, default: 'Formatting' },
    /** Fixed above the keyboard. Off inside a sheet, whose footer already is. */
    docked: { type: Boolean, default: true },
})

const emit = defineEmits(['press', 'hide'])
const { keyboardInset } = useViewport()

function hideKeyboard() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    emit('hide')
}
</script>

<style scoped>
.ph-keyrow {
    display: flex;
    align-items: stretch;
    background: var(--ph-surface);
    border-top: 1px solid var(--ph-line);
}

.ph-keyrow-docked {
    position: fixed;
    left: 0;
    right: 0;
    z-index: 40;
    padding-bottom: env(safe-area-inset-bottom);
}

.ph-keyrow-scroll {
    flex: 1;
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
}

.ph-keyrow-scroll::-webkit-scrollbar {
    display: none;
}

/* Extra keys passed through the slot get the same shape. */
.ph-key,
.ph-keyrow-scroll :slotted(button) {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 48px;
    padding: 0 10px;
    border: 0;
    background: transparent;
    color: var(--ph-ink-2);
}

.ph-keyrow-scroll :slotted(button:disabled) {
    opacity: 0.4;
}

.ph-key:active,
.ph-keyrow-scroll :slotted(button:active) {
    background: var(--ph-canvas);
}

.ph-key-symbol {
    font-family: var(--ph-mono);
    font-size: 17px;
    font-weight: 600;
}

.ph-key-hide {
    border-left: 1px solid var(--ph-line);
}
</style>
