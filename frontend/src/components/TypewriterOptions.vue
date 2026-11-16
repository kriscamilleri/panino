<template>
    <!--
    Typewriter mode's options on desktop (docs/specs/active/typewriter-mode.md
    §9.4, §9.6): a small popover under the Editor menu's options button.
    Teleported to the body, because the menu bar scrolls sideways and would
    clip it. Focus moves in on open, Escape closes and returns focus.
    -->
    <Teleport to="body">
        <div
            v-if="open"
            ref="panel"
            class="tw-options pn-panel"
            role="dialog"
            aria-label="Typewriter options"
            tabindex="-1"
            :style="position"
            data-testid="typewriter-options"
            @keydown="handleKeydown"
        >
            <div class="tw-row">
                <div class="min-w-0">
                    <p
                        id="tw-options-mode"
                        class="pn-title-sub"
                    >{{ COPY.mode }}</p>
                    <p class="pn-help">{{ COPY.modeHelp }}</p>
                </div>
                <button
                    type="button"
                    role="switch"
                    class="tw-switch"
                    :aria-checked="settings.enabled"
                    aria-labelledby="tw-options-mode"
                    data-autofocus
                    data-testid="typewriter-options-enabled"
                    @click="update({ enabled: !settings.enabled })"
                ><span aria-hidden="true"></span></button>
            </div>

            <fieldset class="tw-field">
                <legend class="pn-label">{{ COPY.scrolling }}</legend>
                <div
                    class="tw-segmented"
                    role="group"
                    :aria-label="COPY.scrolling"
                >
                    <button
                        v-for="option in SCROLLING_OPTIONS"
                        :key="option.value"
                        type="button"
                        :aria-pressed="settings.scrolling === option.value"
                        :data-testid="`typewriter-options-scrolling-${option.value}`"
                        @click="update({ scrolling: option.value })"
                    >{{ option.label }}</button>
                </div>
            </fieldset>

            <fieldset
                v-if="visible.linePosition"
                class="tw-field"
                data-testid="typewriter-options-line-position"
            >
                <legend class="pn-label">{{ COPY.linePosition }}</legend>
                <div
                    class="tw-segmented"
                    role="group"
                    :aria-label="COPY.linePosition"
                >
                    <button
                        v-for="option in ANCHOR_PRESETS"
                        :key="option.value"
                        type="button"
                        :aria-pressed="anchorPreset === option.value"
                        :data-testid="`typewriter-options-anchor-${option.value}`"
                        @click="update({ anchorPercent: option.value })"
                    >{{ option.label }}</button>
                </div>
            </fieldset>

            <div
                v-if="visible.contextLines"
                class="tw-row"
                data-testid="typewriter-options-context-lines"
            >
                <p
                    id="tw-options-lines"
                    class="pn-label mb-0"
                >{{ COPY.contextLines }}</p>
                <div
                    class="tw-stepper"
                    role="group"
                    aria-labelledby="tw-options-lines"
                >
                    <button
                        type="button"
                        aria-label="Fewer lines"
                        :disabled="settings.contextLines <= CONTEXT_LINES_MIN"
                        data-testid="typewriter-options-lines-minus"
                        @click="update({ contextLines: settings.contextLines - 1 })"
                    >−</button>
                    <output
                        aria-live="polite"
                        data-testid="typewriter-options-lines-value"
                    >{{ settings.contextLines }}</output>
                    <button
                        type="button"
                        aria-label="More lines"
                        :disabled="settings.contextLines >= CONTEXT_LINES_MAX"
                        data-testid="typewriter-options-lines-plus"
                        @click="update({ contextLines: settings.contextLines + 1 })"
                    >+</button>
                </div>
            </div>

            <div class="tw-row">
                <p
                    id="tw-options-highlight"
                    class="pn-label mb-0"
                >{{ COPY.highlightLine }}</p>
                <button
                    type="button"
                    role="switch"
                    class="tw-switch"
                    :aria-checked="settings.highlightLine"
                    aria-labelledby="tw-options-highlight"
                    data-testid="typewriter-options-highlight"
                    @click="update({ highlightLine: !settings.highlightLine })"
                ><span aria-hidden="true"></span></button>
            </div>

            <fieldset class="tw-field">
                <legend class="pn-label">{{ COPY.dim }}</legend>
                <div
                    class="tw-segmented"
                    role="group"
                    :aria-label="COPY.dim"
                >
                    <button
                        v-for="option in DIM_OPTIONS"
                        :key="option.value"
                        type="button"
                        :aria-pressed="settings.dim === option.value"
                        :data-testid="`typewriter-options-dim-${option.value}`"
                        @click="update({ dim: option.value })"
                    >{{ option.label }}</button>
                </div>
            </fieldset>

            <fieldset
                v-if="visible.dimStrength"
                class="tw-field"
                data-testid="typewriter-options-dim-strength"
            >
                <legend class="pn-label">{{ COPY.dimStrength }}</legend>
                <div
                    class="tw-segmented"
                    role="group"
                    :aria-label="COPY.dimStrength"
                >
                    <button
                        v-for="option in DIM_STRENGTH_OPTIONS"
                        :key="option.value"
                        type="button"
                        :aria-pressed="settings.dimStrength === option.value"
                        :data-testid="`typewriter-options-strength-${option.value}`"
                        @click="update({ dimStrength: option.value })"
                    >{{ option.label }}</button>
                </div>
            </fieldset>
        </div>
    </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useTypewriterStore } from '@/store/typewriterStore'
import { useDialogFocus } from '@/composables/useDialogFocus'
import {
    ANCHOR_PRESETS,
    CONTEXT_LINES_MAX,
    CONTEXT_LINES_MIN,
    DIM_OPTIONS,
    DIM_STRENGTH_OPTIONS,
    SCROLLING_OPTIONS,
    TYPEWRITER_COPY as COPY,
    nearestAnchorPreset,
    visibleTypewriterControls,
} from '@/utils/typewriterSettings'

const props = defineProps({
    open: { type: Boolean, default: false },
    /** The button that opened the popover: it is placed under it. */
    anchor: { type: Object, default: null },
})
const emit = defineEmits(['close'])

const store = useTypewriterStore()
const panel = ref(null)
const position = ref({})

const settings = computed(() => store.current)
const visible = computed(() => visibleTypewriterControls(settings.value))
const anchorPreset = computed(() => nearestAnchorPreset(settings.value.anchorPercent))

const { handleKeydown } = useDialogFocus(panel, () => props.open, () => emit('close'))

function update(patch) {
    store.update(patch)
}

const PANEL_WIDTH = 320

function place() {
    const rect = props.anchor?.getBoundingClientRect?.()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8))
    position.value = { top: `${Math.round(rect.bottom + 6)}px`, left: `${Math.round(left)}px` }
}

function onPointerDown(event) {
    if (panel.value?.contains(event.target) || props.anchor?.contains?.(event.target)) return
    emit('close')
}

watch(() => props.open, (open) => {
    if (open) {
        place()
        document.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('resize', place)
        // The menu bar scrolls sideways and the page can scroll: follow the button.
        window.addEventListener('scroll', place, { capture: true, passive: true })
    } else {
        document.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('resize', place)
        window.removeEventListener('scroll', place, { capture: true })
    }
}, { immediate: true })

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('resize', place)
    window.removeEventListener('scroll', place, { capture: true })
})
</script>

<style scoped>
.tw-options {
    position: fixed;
    z-index: 60;
    width: 320px;
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
}

.tw-options:focus {
    outline: none;
}

.tw-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

.tw-field {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
}

.tw-segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #f9fafb;
}

.tw-segmented button {
    flex: 1;
    min-height: 30px;
    padding: 0 6px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    color: #4b5563;
}

.tw-segmented button[aria-pressed='true'] {
    background: #fff;
    color: #111827;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
}

.tw-segmented button:focus-visible,
.tw-stepper button:focus-visible,
.tw-switch:focus-visible {
    outline: 2px solid #6b7280;
    outline-offset: 2px;
}

.tw-stepper {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
}

.tw-stepper button {
    width: 30px;
    height: 30px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #fff;
    font-size: 16px;
    color: #374151;
}

.tw-stepper button:disabled {
    opacity: 0.4;
}

.tw-stepper output {
    min-width: 1.5rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-size: 14px;
}

.tw-switch {
    position: relative;
    flex-shrink: 0;
    width: 44px;
    height: 24px;
    border-radius: 9999px;
    background: #d1d5db;
    transition: background-color 150ms ease;
}

.tw-switch[aria-checked='true'] {
    background: #1f2937;
}

.tw-switch span {
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

.tw-switch[aria-checked='true'] span {
    transform: translateX(20px);
}

:global(html[data-theme='dark']) .tw-segmented {
    border-color: var(--pn-border);
    background: var(--pn-surface);
}

:global(html[data-theme='dark']) .tw-segmented button {
    color: var(--pn-text-muted);
}

:global(html[data-theme='dark']) .tw-segmented button[aria-pressed='true'] {
    background: var(--pn-surface-inset);
    color: var(--pn-text);
}

:global(html[data-theme='dark']) .tw-stepper button {
    border-color: var(--pn-border);
    background: var(--pn-surface-inset);
    color: var(--pn-text);
}

:global(html[data-theme='dark']) .tw-switch {
    background: var(--pn-border);
}

:global(html[data-theme='dark']) .tw-switch[aria-checked='true'] {
    background: var(--pn-primary);
}

@media (prefers-reduced-motion: reduce) {
    .tw-switch,
    .tw-switch span {
        transition: none;
    }
}
</style>
