import { nextTick, watch } from 'vue';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog focus rules for sheets and the Drawer: focus moves in on open (to a
 * `[data-autofocus]` field when there is one), Tab stays inside, Escape asks
 * to close, and focus returns to the opener on close.
 *
 * @param {import('vue').Ref<HTMLElement|null>} panelRef
 * @param {() => boolean} isOpen
 * @param {() => void} requestClose
 * @returns {{ handleKeydown: (event: KeyboardEvent) => void }}
 */
export function useDialogFocus(panelRef, isOpen, requestClose) {
    let opener = null;

    watch(isOpen, async (open) => {
        if (open) {
            opener = document.activeElement;
            await nextTick();
            const preferred = panelRef.value?.querySelector('[data-autofocus]');
            (preferred || panelRef.value)?.focus();
        } else if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
            opener.focus();
            opener = null;
        }
    }, { immediate: true });

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            requestClose();
            return;
        }
        if (event.key !== 'Tab') return;
        const items = [...(panelRef.value?.querySelectorAll(FOCUSABLE) ?? [])]
            .filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.value)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    return { handleKeydown };
}
