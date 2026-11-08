<template>
    <div
        v-if="tocStore.isStale"
        class="pn-toc-stale"
        role="status"
        :data-testid="`${testid}-stale`"
    >
        <span>The table of contents is out of date</span>
        <button
            type="button"
            class="pn-toc-stale-button"
            :data-testid="`${testid}-refresh`"
            @click="tocStore.refresh()"
        >Refresh</button>
    </div>
</template>

<script setup>
// The out-of-date notice for a table of contents (docs/specs/active/editor-toc-and-internal-links.md
// §4.5): above the Preview, and on the PDF export screens, where it does not block export.
// Outside the rendered Document, so it needs no DOM injection.
import { useTableOfContentsStore } from '@/store/tableOfContentsStore'

defineProps({
    // `preview-toc` gives `preview-toc-stale` and `preview-toc-refresh`.
    testid: { type: String, default: 'preview-toc' },
})

const tocStore = useTableOfContentsStore()
</script>

<style scoped>
.pn-toc-stale {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin: 0 0 0.75rem;
    padding: 0.4rem 0.75rem;
    border: 1px solid #fcd34d;
    border-radius: 0.375rem;
    background: #fffbeb;
    color: #92400e;
    font-size: 0.85rem;
    line-height: 1.3;
}

.pn-toc-stale-button {
    flex-shrink: 0;
    padding: 0.2rem 0.65rem;
    border: 1px solid currentColor;
    border-radius: 0.375rem;
    background: transparent;
    color: inherit;
    font-weight: 600;
    cursor: pointer;
}

.pn-toc-stale-button:hover {
    background: #fef3c7;
}

:global(html[data-theme='dark']) .pn-toc-stale {
    border-color: #92400e;
    background: #2a2111;
    color: #fcd34d;
}

:global(html[data-theme='dark']) .pn-toc-stale-button:hover {
    background: #3a2e14;
}
</style>
