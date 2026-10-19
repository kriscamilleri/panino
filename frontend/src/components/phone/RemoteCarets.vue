<template>
    <div
        class="ph-carets"
        aria-hidden="true"
        data-testid="phone-remote-carets"
    >
        <!-- Decorative: presence is announced through the avatar stack's label. -->
        <div
            v-for="caret in carets"
            :key="caret.id"
            class="ph-caret"
            :style="{
                top: `${caret.top}px`,
                left: `${caret.left}px`,
                height: `${caret.height}px`,
                '--caret-color': caret.color,
            }"
            :data-testid="`phone-remote-caret-${caret.id}`"
        >
            <span class="ph-caret-flag">{{ caret.name }}</span>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { caretPosition } from '@/utils/caretPosition'
import { identityColorFor } from '@/utils/identityColor'

const props = defineProps({
    /** The live editor's textarea, or null before it exists. */
    textarea: { type: Object, default: null },
    /** Other participants: `{ id, name, cursor }`. */
    participants: { type: Array, default: () => [] },
})

// Bumped when text or size changes, so positions are measured again.
const layoutTick = ref(0)
let resizeObserver = null

function bump() {
    layoutTick.value += 1
}

watch(() => props.textarea, (textarea, previous) => {
    previous?.removeEventListener('input', bump)
    resizeObserver?.disconnect()
    if (!textarea) return
    textarea.addEventListener('input', bump)
    if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(bump)
        resizeObserver.observe(textarea)
    }
}, { immediate: true })

onBeforeUnmount(() => {
    props.textarea?.removeEventListener('input', bump)
    resizeObserver?.disconnect()
})

const carets = computed(() => {
    void layoutTick.value
    const textarea = props.textarea
    if (!textarea) return []
    return props.participants
        .filter((participant) => Number.isSafeInteger(participant.cursor))
        .map((participant) => {
            const position = caretPosition(textarea, participant.cursor)
            return {
                id: participant.id,
                name: participant.name || 'Someone',
                color: identityColorFor(String(participant.id)),
                top: textarea.offsetTop + position.top,
                left: textarea.offsetLeft + position.left,
                height: position.height,
            }
        })
})
</script>

<style scoped>
/* Above OverType's textarea (z-index 1); taps still pass through to it. */
.ph-carets {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    overflow: hidden;
}

.ph-caret {
    position: absolute;
    width: 2px;
    background: var(--caret-color);
}

.ph-caret-flag {
    position: absolute;
    bottom: 100%;
    left: -1px;
    padding: 1px 6px;
    border-radius: 4px 4px 4px 0;
    background: var(--caret-color);
    color: #fff;
    font-family: system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
}
</style>
