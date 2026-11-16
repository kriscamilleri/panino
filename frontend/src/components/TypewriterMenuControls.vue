<template>
    <!-- The Editor menu's typewriter controls (docs/specs/active/typewriter-mode.md §9.4). -->
    <div
        class="flex items-center gap-1"
        :class="{ 'tw-collapsed': ui.editorMenuCollapsed }"
    >
        <BaseButton
            :isActive="store.enabled"
            :aria-pressed="store.enabled"
            :title="`Typewriter mode (${shortcut})`"
            data-testid="submenu-editor-typewriter"
            class="text-sm"
            @click="store.toggle()"
        >
            <Focus class="w-4 h-4" />
            <span class="tw-text">Typewriter</span>
        </BaseButton>
        <span
            ref="optionsAnchor"
            class="inline-flex"
        ><BaseButton
            icon-only
            :isActive="optionsOpen"
            :aria-expanded="optionsOpen"
            aria-haspopup="dialog"
            aria-label="Typewriter options"
            title="Typewriter options"
            data-testid="submenu-editor-typewriter-options"
            @click="optionsOpen = !optionsOpen"
        >
            <SlidersHorizontal class="w-4 h-4" />
        </BaseButton></span>
        <TypewriterOptions
            :open="optionsOpen"
            :anchor="optionsAnchor"
            @close="optionsOpen = false"
        />
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { Focus, SlidersHorizontal } from 'lucide-vue-next'
import BaseButton from '@/components/BaseButton.vue'
import TypewriterOptions from '@/components/TypewriterOptions.vue'
import { useTypewriterStore } from '@/store/typewriterStore'
import { useUiStore } from '@/store/uiStore'

const store = useTypewriterStore()
const ui = useUiStore()
const optionsOpen = ref(false)
// The popover is placed under this element.
const optionsAnchor = ref(null)

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
const shortcut = isMac ? '⌘⇧↩' : 'Ctrl+Shift+Enter'
</script>

<style scoped>
/* The Editor menu's Collapse shows icons only. */
.tw-collapsed .tw-text {
    display: none;
}
</style>
