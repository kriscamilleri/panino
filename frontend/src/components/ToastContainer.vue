<template>
    <!-- Root container (bottom-right) -->
    <div class="fixed bottom-4 right-4 flex flex-col space-y-2 z-50"> <!-- Animated list of toasts -->
        <TransitionGroup name="toast" tag="div">
            <div v-for="toast in ui.toasts" :key="toast.id"
                class="min-w-[200px] max-w-sm bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-start justify-between"
                role="alert"> <!-- HTML is already sanitized before it reaches here -->
                <div class="flex-1 pr-2" v-html="toast.message" /> <button @click="ui.removeToast(toast.id)"
                    class="text-white text-lg leading-none focus:outline-none"> &times; </button>
            </div>
        </TransitionGroup>
    </div>
</template>
<script setup>import { useUiStore } from '@/store/uiStore';
const ui = useUiStore()
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
