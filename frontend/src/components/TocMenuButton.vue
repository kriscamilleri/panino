<template>
    <button
        ref="buttonRef"
        type="button"
        class="pn-toolbar-button pn-toc-button"
        :disabled="!tocStore.canEdit"
        :title="buttonTitle"
        :aria-label="buttonTitle"
        aria-haspopup="menu"
        :aria-expanded="open"
        data-testid="submenu-editor-toc"
        @click="toggle"
    >
        <span class="pn-toc-icon">
            <ListTree class="w-4 h-4" />
            <span
                v-if="tocStore.isStale"
                class="pn-toc-dot"
                data-testid="submenu-editor-toc-stale"
                aria-hidden="true"
            ></span>
        </span>
        <span
            v-if="!ui.editorMenuCollapsed"
            class="button-text"
        >Contents</span>
    </button>
    <Teleport to="body">
        <div
            v-if="open"
            ref="menuRef"
            class="pn-toc-menu"
            role="menu"
            :style="menuStyle"
            data-testid="submenu-editor-toc-menu"
            @keydown="onMenuKeydown"
        >
            <button
                v-if="!tocStore.hasToc"
                type="button"
                role="menuitem"
                class="pn-toc-menu-item"
                data-testid="submenu-editor-toc-insert"
                @click="run(() => tocStore.insert())"
            >Insert table of contents</button>
            <button
                v-else
                type="button"
                role="menuitem"
                class="pn-toc-menu-item"
                data-testid="submenu-editor-toc-refresh"
                @click="run(() => tocStore.refresh())"
            >{{ tocStore.isStale ? 'Refresh (out of date)' : 'Refresh' }}</button>
            <button
                type="button"
                role="menuitem"
                class="pn-toc-menu-item"
                data-testid="submenu-editor-toc-options"
                @click="run(() => picker.openTocOptions(0))"
            >Options…</button>
            <button
                v-if="tocStore.hasToc"
                type="button"
                role="menuitem"
                class="pn-toc-menu-item"
                data-testid="submenu-editor-toc-remove"
                @click="run(() => tocStore.remove(0))"
            >Remove</button>
        </div>
    </Teleport>
</template>

<script setup>
// The desktop "Table of contents" toolbar menu (docs/specs/active/editor-toc-and-internal-links.md
// §4.5): Insert or Refresh, Options… and Remove, with a dot while a table is out of date.
// No default shortcut; the menu is reachable from the keyboard like the rest of the toolbar.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ListTree } from 'lucide-vue-next'
import { useTableOfContentsStore } from '@/store/tableOfContentsStore'
import { useLinkPickerStore } from '@/store/linkPickerStore'
import { useUiStore } from '@/store/uiStore'

const ui = useUiStore()
const tocStore = useTableOfContentsStore()
const picker = useLinkPickerStore()

const open = ref(false)
const buttonRef = ref(null)
const menuRef = ref(null)
const menuStyle = ref({})

const buttonTitle = computed(() => (tocStore.isStale ? 'Table of contents (out of date)' : 'Table of contents'))

function place() {
    const rect = buttonRef.value?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 240))
    menuStyle.value = { top: `${rect.bottom + 4}px`, left: `${left}px` }
}

function toggle() {
    if (open.value) {
        open.value = false
        return
    }
    tocStore.recompute()
    place()
    open.value = true
    nextTick(() => menuRef.value?.querySelector('button')?.focus())
}

async function run(action) {
    open.value = false
    await action()
}

function onMenuKeydown(event) {
    const items = [...(menuRef.value?.querySelectorAll('button') ?? [])]
    const index = items.indexOf(document.activeElement)
    if (event.key === 'Escape') {
        event.preventDefault()
        open.value = false
        buttonRef.value?.focus()
    } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        items[(index + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        items[(index - 1 + items.length) % items.length]?.focus()
    }
}

function onPointerDown(event) {
    if (menuRef.value?.contains(event.target) || buttonRef.value?.contains(event.target)) return
    open.value = false
}

watch(open, (isOpen) => {
    if (isOpen) document.addEventListener('mousedown', onPointerDown, true)
    else document.removeEventListener('mousedown', onPointerDown, true)
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onPointerDown, true))
</script>

<style scoped>
.pn-toc-icon {
    position: relative;
    display: inline-flex;
}

.pn-toc-dot {
    position: absolute;
    top: -2px;
    right: -3px;
    width: 7px;
    height: 7px;
    border-radius: 9999px;
    background: #f59e0b;
}

.pn-toc-menu {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    min-width: 13rem;
    padding: 0.25rem 0;
    border: 1px solid #d1d5db;
    border-radius: 0.5rem;
    background: #fff;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}

.pn-toc-menu-item {
    padding: 0.45rem 0.85rem;
    border: 0;
    background: transparent;
    color: #111827;
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;
}

.pn-toc-menu-item:hover,
.pn-toc-menu-item:focus {
    background: #f3f4f6;
    outline: none;
}

:global(html[data-theme='dark']) .pn-toc-menu {
    border-color: #343434;
    background: #2c2c2c;
}

:global(html[data-theme='dark']) .pn-toc-menu-item {
    color: #d4d4d4;
}

:global(html[data-theme='dark']) .pn-toc-menu-item:hover,
:global(html[data-theme='dark']) .pn-toc-menu-item:focus {
    background: #343434;
}
</style>
