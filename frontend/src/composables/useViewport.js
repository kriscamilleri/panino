import { ref, readonly } from 'vue';

/** Below this width the phone layout applies. */
export const PHONE_MAX_WIDTH = 767.98;

const isPhone = ref(false);
const keyboardInset = ref(0);
let initialized = false;

function measureKeyboard() {
    const viewport = window.visualViewport;
    if (!viewport) {
        keyboardInset.value = 0;
        return;
    }
    // The part of the layout viewport the on-screen keyboard covers.
    const covered = window.innerHeight - viewport.height - viewport.offsetTop;
    keyboardInset.value = covered > 1 ? Math.round(covered) : 0;
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
        window.visualViewport.addEventListener('resize', measureKeyboard);
        window.visualViewport.addEventListener('scroll', measureKeyboard);
    }
    measureKeyboard();
}

/**
 * Shared, app-wide viewport state: whether the phone layout applies and how
 * much of the screen the on-screen keyboard covers.
 *
 * @returns {{ isPhone: import('vue').Ref<boolean>, keyboardInset: import('vue').Ref<number> }}
 */
export function useViewport() {
    initialize();
    return { isPhone: readonly(isPhone), keyboardInset: readonly(keyboardInset) };
}
