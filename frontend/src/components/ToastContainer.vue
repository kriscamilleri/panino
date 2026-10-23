<template>
    <!-- Root container (bottom-right) -->
    <!-- Phones: above the new-note buttons and key row. -->
    <div class="fixed bottom-40 left-4 right-4 md:bottom-4 md:left-auto flex flex-col items-end space-y-2 z-[70]"> <!-- Animated list of toasts -->
        <TransitionGroup
            name="toast"
            tag="div"
        >
            <div
                v-for="toast in ui.toasts"
                :key="toast.id"
                :class="getToastClass(toast.type)"
                class="min-w-[200px] max-w-sm px-4 py-3 rounded-lg shadow-lg flex items-start justify-between"
                role="alert"
            >
                <div class="flex-1 pr-2">{{ toast.message }}</div>
                <button
                    v-if="toast.action"
                    type="button"
                    class="mr-2 font-semibold underline underline-offset-2 focus:outline-none"
                    data-testid="toast-action"
                    @click="runAction(toast)"
                >{{ toast.action.label }}</button>
                <button
                    @click="ui.removeToast(toast.id)"
                    class="text-lg leading-none focus:outline-none"
                    :class="getButtonClass(toast.type)"
                > &times; </button>
            </div>
        </TransitionGroup>
    </div>
</template>
<script setup>
import { onMounted } from 'vue';
import { useUiStore } from '@/store/uiStore';
import { takeDeferredToasts } from '@/utils/deferredToasts';

const ui = useUiStore()

// Show messages queued by a flow that reloaded the page (see deferredToasts.js).
onMounted(() => {
    for (const toast of takeDeferredToasts(window.sessionStorage)) {
        ui.addToast(toast.message, toast.type, toast.duration);
    }
});

function runAction(toast) {
    ui.removeToast(toast.id);
    toast.action.onSelect();
}

function getToastClass(type) {
    switch (type) {
        case 'success':
            return 'bg-green-600 text-white';
        case 'warning':
            return 'bg-yellow-500 text-gray-900';
        case 'info':
            return 'bg-blue-600 text-white';
        case 'error':
        default:
            return 'bg-red-600 text-white';
    }
}

function getButtonClass(type) {
    return type === 'warning' ? 'text-gray-900' : 'text-white';
}
</script>
<style scoped>
/* Spring-in (translate + scale) and fade-out for toasts */
.toast-enter-from {
    opacity: 0;
    transform: translateY(16px) scale(0.95);
}

.toast-enter-active {
    transition: all 300ms cubic-bezier(0.22, 0.61, 0.36, 1);
    /* spring-like */
}

.toast-enter-to {
    opacity: 1;
    transform: translateY(0) scale(1);
}

.toast-leave-from {
    opacity: 1;
}

.toast-leave-active {
    transition: opacity 150ms ease-out;
}

.toast-leave-to {
    opacity: 0;
}
</style>
