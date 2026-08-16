<template>
    <!--
        The single dialog chrome for the app: overlay, panel, header, scrolling
        body and a sticky footer. Callers supply content only — never their own
        overlay, padding or close affordance — so every dialog lines up.
    -->
    <div
        v-if="show"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
    >
        <div
            class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
            @click="handleBackdrop"
        ></div>

        <div :class="panelClasses">
            <header class="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
                <div class="min-w-0">
                    <h3 class="pn-title-modal truncate">{{ title }}</h3>
                    <p
                        v-if="subtitle"
                        class="mt-1 pn-body"
                    >{{ subtitle }}</p>
                </div>
                <button
                    v-if="dismissible"
                    type="button"
                    class="-m-1.5 shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
                    aria-label="Close dialog"
                    :data-testid="closeTestid"
                    @click="$emit('close')"
                >
                    <X class="h-5 w-5" />
                </button>
            </header>

            <div class="flex-1 overflow-y-auto px-6 py-5">
                <slot />
            </div>

            <footer
                v-if="$slots.footer"
                class="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4"
            >
                <slot name="footer" />
            </footer>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue';
import { X } from 'lucide-vue-next';

const props = defineProps({
    /** Set false to unmount. Callers that already guard with v-if can leave it true. */
    show: { type: Boolean, default: true },
    title: { type: String, required: true },
    /** Optional second line under the title (context, not instructions). */
    subtitle: { type: String, default: '' },
    /** sm 480px · md 600px · lg 720px — pick by content, not by importance. */
    size: {
        type: String,
        default: 'md',
        validator: (v) => ['sm', 'md', 'lg'].includes(v),
    },
    /** Hides the close affordance and disables backdrop dismissal. */
    dismissible: { type: Boolean, default: true },
    /** Set false when a click outside would lose work in progress. */
    closeOnBackdrop: { type: Boolean, default: true },
    closeTestid: { type: String, default: undefined },
});

const emit = defineEmits(['close']);

const SIZES = {
    sm: 'w-[480px]',
    md: 'w-[600px]',
    lg: 'w-[720px]',
};

// `max-w-full` (not `w-full`) so the size class owns the width but the panel
// still shrinks inside the root's padding on narrow viewports.
const panelClasses = computed(() => [
    'relative flex max-h-[85vh] max-w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl',
    SIZES[props.size] || SIZES.md,
].join(' '));

function handleBackdrop() {
    if (props.dismissible && props.closeOnBackdrop) emit('close');
}
</script>
