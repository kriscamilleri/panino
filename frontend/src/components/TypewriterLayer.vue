<template>
    <!--
    Typewriter mode's overlay (docs/specs/active/typewriter-mode.md §4.3).
    Teleported into OverType's wrapper after its highlight layer, so it paints
    over the text but under the textarea's caret and selection. It holds only
    numbers: no Document text ever reaches it.
    -->
    <div
        class="pn-typewriter-layer"
        aria-hidden="true"
        data-testid="typewriter-layer"
    >
        <div
            ref="bandEl"
            class="pn-typewriter-band"
            data-testid="typewriter-band"
        ></div>
        <div
            v-for="slot in SCRIM_SLOTS"
            :key="slot"
            :ref="(element) => { scrimEls[slot] = element }"
            class="pn-typewriter-scrim"
            data-testid="typewriter-scrim"
        ></div>
    </div>
</template>

<script setup>
import { ref } from 'vue'

/** The scrim never needs more than four rectangles (focusGeometry.scrimRects). */
const SCRIM_SLOTS = [0, 1, 2, 3]

const bandEl = ref(null)
const scrimEls = []

function place(element, rect) {
    if (!element) return
    if (!rect) {
        element.style.display = 'none'
        return
    }
    element.style.display = 'block'
    element.style.transform = `translate(${rect.x}px, ${rect.y}px)`
    element.style.width = `${rect.w}px`
    element.style.height = `${rect.h}px`
}

/**
 * Draw one frame. Writes styles directly: this runs once per animation frame
 * while typing, and a fixed set of five elements needs no re-render.
 *
 * @param {{ band: { x: number, y: number, w: number, h: number } | null,
 *   scrims: Array<{ x: number, y: number, w: number, h: number }>, scrimColor: string } | null} geometry
 */
function render(geometry) {
    place(bandEl.value, geometry?.band ?? null)
    SCRIM_SLOTS.forEach((slot) => {
        const element = scrimEls[slot]
        const rect = geometry?.scrims?.[slot] ?? null
        place(element, rect)
        if (element && rect && geometry.scrimColor) element.style.backgroundColor = geometry.scrimColor
    })
}

defineExpose({ render })
</script>
