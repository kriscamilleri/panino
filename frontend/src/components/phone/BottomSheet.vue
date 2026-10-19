<template>
    <Transition name="ph-sheet">
        <div
            v-if="open"
            class="ph-sheet-root"
            :style="visibleStyle"
            :data-testid="testid"
        >
            <div
                class="ph-sheet-scrim"
                aria-hidden="true"
                @click="requestClose"
            ></div>
            <section
                ref="panelRef"
                class="ph-sheet-panel"
                role="dialog"
                aria-modal="true"
                :aria-label="label"
                :style="panelStyle"
                tabindex="-1"
                @keydown="handleKeydown"
            >
                <div
                    class="ph-sheet-grab"
                    @pointerdown="startDrag"
                >
                    <span aria-hidden="true"></span>
                </div>
                <header
                    v-if="$slots.header"
                    class="ph-sheet-header"
                    @pointerdown="startDrag"
                >
                    <slot name="header" />
                </header>
                <div class="ph-sheet-body">
                    <slot />
                </div>
                <footer
                    v-if="$slots.footer"
                    class="ph-sheet-footer"
                >
                    <slot name="footer" />
                </footer>
            </section>
        </div>
    </Transition>
</template>

<script setup>
import { computed, ref, onBeforeUnmount } from 'vue'
import { useViewport } from '@/composables/useViewport'
import { useDialogFocus } from '@/composables/useDialogFocus'

const props = defineProps({
    open: { type: Boolean, default: false },
    /** Accessible name of the dialog. */
    label: { type: String, required: true },
    /** Tallest the sheet may be, in px; it shrinks to fit the visible screen. */
    maxHeight: { type: Number, default: 760 },
    /** Fill the available height rather than fitting the content. */
    tall: { type: Boolean, default: false },
    testid: { type: String, default: undefined },
})

// `close` asks to close; the parent decides (a capture sheet checks for text first).
const emit = defineEmits(['close'])

// The sheet covers the visible screen only, so it always ends above the keyboard.
const { visibleStyle } = useViewport()
const panelRef = ref(null)
const dragOffset = ref(0)

const panelStyle = computed(() => {
    const available = 'calc(100% - 24px)'
    return {
        maxHeight: `min(${props.maxHeight}px, ${available})`,
        height: props.tall ? `min(${props.maxHeight}px, ${available})` : undefined,
        transform: dragOffset.value ? `translateY(${dragOffset.value}px)` : undefined,
    }
})

function requestClose() {
    emit('close')
}

const { handleKeydown } = useDialogFocus(panelRef, () => props.open, requestClose)

/* Swipe down on the handle or header to dismiss. */
let dragStartY = null

function startDrag(event) {
    if (event.target.closest('button, input, textarea, a')) return
    dragStartY = event.clientY
    window.addEventListener('pointermove', moveDrag)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
}

function moveDrag(event) {
    if (dragStartY === null) return
    dragOffset.value = Math.max(0, event.clientY - dragStartY)
}

function endDrag() {
    const shouldClose = dragOffset.value > 90
    dragStartY = null
    dragOffset.value = 0
    window.removeEventListener('pointermove', moveDrag)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
    if (shouldClose) requestClose()
}

onBeforeUnmount(endDrag)
</script>

<style scoped>
.ph-sheet-root {
    position: fixed;
    left: 0;
    right: 0;
    /* Below app dialogs (BaseModal, z-index 50): a dialog the Editor opens while a
       sheet is up, such as Save version or a conflict, must show above it. */
    z-index: 45;
}

.ph-sheet-scrim {
    position: absolute;
    inset: 0;
    background: var(--ph-scrim);
}

.ph-sheet-panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    background: var(--ph-surface);
    color: var(--ph-ink);
    border-radius: 20px 20px 0 0;
    box-shadow: var(--ph-shadow);
    padding-bottom: env(safe-area-inset-bottom);
    outline: none;
    transition: transform 0.12s ease-out;
}

/* The dialog takes focus on open so screen readers land in it; its first
   control shows the ring once someone tabs, the container never does. */
.ph-sheet-panel:focus-visible {
    outline: none;
}

.ph-sheet-grab {
    display: flex;
    justify-content: center;
    padding: 8px 0 4px;
    touch-action: none;
}

.ph-sheet-grab span {
    width: 40px;
    height: 5px;
    border-radius: 3px;
    background: var(--ph-line);
}

.ph-sheet-header {
    padding: 4px 12px 8px;
    touch-action: none;
}

.ph-sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.ph-sheet-footer {
    border-top: 1px solid var(--ph-line);
    padding: 12px 16px;
}

.ph-sheet-enter-active,
.ph-sheet-leave-active {
    transition: opacity 0.2s ease;
}

.ph-sheet-enter-active .ph-sheet-panel,
.ph-sheet-leave-active .ph-sheet-panel {
    transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.ph-sheet-enter-from,
.ph-sheet-leave-to {
    opacity: 0;
}

.ph-sheet-enter-from .ph-sheet-panel,
.ph-sheet-leave-to .ph-sheet-panel {
    transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
    .ph-sheet-enter-active .ph-sheet-panel,
    .ph-sheet-leave-active .ph-sheet-panel {
        transition: none;
    }
}
</style>
