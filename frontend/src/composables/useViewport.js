import { computed, ref, readonly } from 'vue';

/** Below this width the phone layout applies. */
export const PHONE_MAX_WIDTH = 767.98;
/** A visible area this much shorter than the layout viewport means the on-screen keyboard is up. */
const KEYBOARD_RATIO = 0.8;

const isPhone = ref(false);
// The part of the screen the user can see: above the on-screen keyboard and
// below any browser chrome. Null where the browser has no visualViewport.
const visibleBox = ref(null);
const keyboardOpen = ref(false);
let initialized = false;
let settleTimers = [];

function measure() {
    const viewport = window.visualViewport;
    if (!viewport) {
        visibleBox.value = null;
        return;
    }
    const next = { top: Math.round(viewport.offsetTop), height: Math.round(viewport.height) };
    // Only compared, never used for sizing: the layout viewport keeps its height
    // while the keyboard is up, so a much shorter visible area means a keyboard.
    const layoutHeight = document.documentElement.clientHeight;
    keyboardOpen.value = layoutHeight > 0 && next.height < layoutHeight * KEYBOARD_RATIO;
    const current = visibleBox.value;
    if (!current || current.top !== next.top || current.height !== next.height) visibleBox.value = next;
}

/**
 * iOS does not always report the end of the keyboard animation or of a toolbar
 * collapse, so measure again once things have settled after focus moves.
 */
function measureSoon() {
    settleTimers.forEach(clearTimeout);
    requestAnimationFrame(measure);
    settleTimers = [100, 350, 700].map((delay) => setTimeout(measure, delay));
}

function initialize() {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;
    const query = window.matchMedia?.(`(max-width: ${PHONE_MAX_WIDTH}px)`);
    if (query) {
        isPhone.value = query.matches;
        query.addEventListener?.('change', (event) => { isPhone.value = event.matches; });
    } else {
        isPhone.value = window.innerWidth <= PHONE_MAX_WIDTH;
    }
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', measure);
        window.visualViewport.addEventListener('scroll', measure);
        window.addEventListener('focusin', measureSoon);
        window.addEventListener('focusout', measureSoon);
        window.addEventListener('orientationchange', measureSoon);
    }
    measure();
}

/**
 * Shared, app-wide viewport state: whether the phone layout applies, a style
 * that pins a fixed element to the visible part of the screen, and whether the
 * on-screen keyboard is up (iOS keeps reporting the home-indicator inset then,
 * so bottom padding must drop it).
 *
 * Only the visual viewport is used. Mixing it with `innerHeight` or `100dvh`
 * breaks on iOS, which updates the three at different moments while the
 * keyboard opens: a measurement taken in between collapsed the editor.
 *
 * @returns {{ isPhone: import('vue').Ref<boolean>, visibleStyle: import('vue').ComputedRef<object>, keyboardOpen: import('vue').Ref<boolean> }}
 */
export function useViewport() {
    initialize();
    const visibleStyle = computed(() => (visibleBox.value
        ? { top: `${visibleBox.value.top}px`, height: `${visibleBox.value.height}px` }
        : { top: '0px', height: '100dvh' }));
    return { isPhone: readonly(isPhone), visibleStyle, keyboardOpen: readonly(keyboardOpen) };
}
