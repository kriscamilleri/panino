<template>
    <div
        class="ph-swipe"
        :data-testid="testid"
    >
        <!--
        Swipe left to reveal the actions. The ⋯ button reveals the same
        actions, so they never depend on a gesture.
        -->
        <div
            class="ph-swipe-actions"
            :aria-hidden="!revealed"
        >
            <slot
                name="actions"
                :close="close"
                :tabindex="revealed ? 0 : -1"
            />
        </div>
        <div
            class="ph-swipe-front"
            :style="{ transform: `translateX(${offset}px)` }"
            @touchstart.passive="start"
            @touchmove="move"
            @touchend="end"
        >
            <slot />
            <button
                type="button"
                class="ph-icon-btn"
                :aria-label="revealed ? 'Hide actions' : actionsLabel"
                :aria-expanded="revealed"
                @click="revealed ? close() : open()"
            >
                <MoreHorizontal
                    class="h-5 w-5"
                    aria-hidden="true"
                />
            </button>
        </div>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'

const props = defineProps({
    /** Width of the revealed action area, in px. */
    actionsWidth: { type: Number, default: 168 },
    actionsLabel: { type: String, default: 'Actions' },
    testid: { type: String, default: undefined },
})

const offset = ref(0)
const revealed = computed(() => offset.value <= -props.actionsWidth / 2)
let startX = null
let startY = null
let baseOffset = 0
let horizontal = null

function open() {
    offset.value = -props.actionsWidth
}

function close() {
    offset.value = 0
}

function start(event) {
    startX = event.touches[0].clientX
    startY = event.touches[0].clientY
    baseOffset = offset.value
    horizontal = null
}

function move(event) {
    if (startX === null) return
    const dx = event.touches[0].clientX - startX
    const dy = event.touches[0].clientY - startY
    if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) horizontal = Math.abs(dx) > Math.abs(dy)
    if (!horizontal) return
    event.preventDefault()
    offset.value = Math.max(-props.actionsWidth, Math.min(0, baseOffset + dx))
}

function end() {
    if (startX !== null && horizontal) {
        if (offset.value < -props.actionsWidth / 3) open()
        else close()
    }
    startX = null
}

defineExpose({ close })
</script>

<style scoped>
.ph-swipe {
    position: relative;
    overflow: hidden;
    border-bottom: 1px solid var(--ph-line);
}

.ph-swipe-actions {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
}

.ph-swipe-front {
    position: relative;
    display: flex;
    align-items: center;
    padding-right: 8px;
    background: var(--ph-surface);
    transition: transform 0.18s ease-out;
    touch-action: pan-y;
}
</style>
