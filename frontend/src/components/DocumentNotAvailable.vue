<template>
    <section
        class="pn-doc-unavailable"
        role="status"
        data-testid="doc-not-available"
    >
        <FileQuestion
            class="pn-doc-unavailable-icon"
            aria-hidden="true"
        />
        <p class="pn-doc-unavailable-text">{{ UNAVAILABLE_MESSAGE }}</p>
        <BaseButton
            data-testid="doc-not-available-home"
            @click="router.replace({ name: 'home' })"
        >Go to Home</BaseButton>
    </section>
</template>

<script setup>
// The deep-link empty state (docs/specs/active/editor-toc-and-internal-links.md §6.8): the
// same text, whether the Document never existed, was deleted, or is not shared with this
// account. The device only knows its own databases, so it cannot tell, and does not ask.
import { useRouter } from 'vue-router'
import { FileQuestion } from 'lucide-vue-next'
import BaseButton from '@/components/BaseButton.vue'
import { UNAVAILABLE_MESSAGE } from '@/composables/useDocumentLinks'

const router = useRouter()
</script>

<style scoped>
.pn-doc-unavailable {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 3rem 1.5rem;
    text-align: center;
}

.pn-doc-unavailable-icon {
    width: 2.5rem;
    height: 2.5rem;
    color: #9ca3af;
}

.pn-doc-unavailable-text {
    max-width: 28rem;
    color: #4b5563;
    font-size: 1rem;
    line-height: 1.5;
}

:global(html[data-theme='dark']) .pn-doc-unavailable-text {
    color: #c6c6c6;
}
</style>
