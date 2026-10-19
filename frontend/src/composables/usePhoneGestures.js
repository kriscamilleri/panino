import { ref } from 'vue';

/** How far a pull has to travel, in px after damping, to sync. */
export const PULL_THRESHOLD = 56;
const PULL_MAX = 80;
const EDGE_WIDTH = 24;
const EDGE_TRAVEL = 60;

/**
 * Pull down at the top of a scroller to sync now.
 *
 * @param {import('vue').Ref<HTMLElement|null>} scrollRef
 * @param {() => void} onSync
 */
export function usePullToSync(scrollRef, onSync) {
    const distance = ref(0);
    let startY = null;

    function start(event) {
        startY = (scrollRef.value?.scrollTop ?? 0) <= 0 ? event.touches[0].clientY : null;
    }

    function move(event) {
        if (startY === null) return;
        const travel = event.touches[0].clientY - startY;
        distance.value = travel > 0 ? Math.min(PULL_MAX, travel * 0.5) : 0;
    }

    function end() {
        if (distance.value >= PULL_THRESHOLD) onSync();
        distance.value = 0;
        startY = null;
    }

    return { distance, start, move, end };
}

/**
 * A swipe in from the left edge of the screen.
 *
 * @param {() => void} onOpen
 */
export function useEdgeSwipe(onOpen) {
    let origin = null;

    function start(event) {
        const touch = event.touches[0];
        origin = touch.clientX <= EDGE_WIDTH ? { x: touch.clientX, y: touch.clientY } : null;
    }

    function move(event) {
        if (!origin) return;
        const touch = event.touches[0];
        if (Math.abs(touch.clientY - origin.y) > 40) {
            origin = null;
        } else if (touch.clientX - origin.x > EDGE_TRAVEL) {
            origin = null;
            onOpen();
        }
    }

    function end() {
        origin = null;
    }

    return { start, move, end };
}
