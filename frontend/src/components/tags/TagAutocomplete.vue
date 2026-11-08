<template>
    <ul
        v-if="open"
        class="pn-tag-suggest"
        role="listbox"
        aria-label="Tag suggestions"
        :style="{ top: `${position.top}px`, left: `${position.left}px` }"
        data-testid="tag-autocomplete"
    >
        <li
            v-for="(item, i) in items"
            :id="`tag-suggest-${i}`"
            :key="item.name"
            role="option"
            :aria-selected="i === active"
            class="pn-tag-suggest-item"
            :class="{ 'pn-tag-suggest-active': i === active }"
            :data-testid="`tag-autocomplete-${item.name}`"
            @pointerdown.prevent
            @mousedown.prevent
            @click="accept(i)"
        >
            <span
                class="pn-tag-suggest-swatch pn-tag-swatch"
                :style="tagColorStyle(item.colorKey)"
                aria-hidden="true"
            />
            <span class="truncate">{{ item.label }}</span>
        </li>
    </ul>
</template>

<script setup>
import { tagColorStyle } from '@/utils/tagPalette'
import { onBeforeUnmount, ref, watch } from 'vue'
import { caretPosition } from '@/utils/caretPosition'
import { applyTagCompletion, tagCompletionContext } from '@/utils/tagAutocomplete'
import { useDocumentIndexStore } from '@/store/documentIndexStore'
import { useEditorStore } from '@/store/editorStore'
import { useTagStore } from '@/store/tagStore'

/**
 * Suggestions while typing a `tags:` value in front matter
 * (tag-system.md §5.4): the current Document's database's styled tags first,
 * then tags found in its Documents. Up/Down choose, Enter or Tab accept, Esc
 * dismisses; a click or tap accepts. The edit goes through the editor's
 * `transformText`, so undo, drafts, saving and live sessions see it.
 */
const props = defineProps({
    /** The live editor's textarea, or null before it exists. */
    textarea: { type: Object, default: null },
    /** The open Document's database. */
    dbKey: { type: String, default: null },
})

const index = useDocumentIndexStore()
const tagStore = useTagStore()
const editorStore = useEditorStore()

const open = ref(false)
const items = ref([])
const active = ref(0)
const position = ref({ top: 0, left: 0 })
let context = null
let dismissedAt = null
let skipNext = false
let listeningOn = null

function close() {
    open.value = false
    items.value = []
    context = null
}

function prepare() {
    if (!props.dbKey) return
    index.ensure(props.dbKey).catch(() => {})
    void tagStore.loadStyles(props.dbKey)
}

function update() {
    const textarea = props.textarea
    if (!textarea || !props.dbKey || textarea.readOnly) return close()
    if (skipNext) {
        skipNext = false
        return close()
    }
    if (textarea.selectionStart !== textarea.selectionEnd) return close()
    const found = tagCompletionContext(textarea.value, textarea.selectionStart)
    if (!found) {
        dismissedAt = null
        return close()
    }
    if (dismissedAt === found.start) return close()
    prepare()
    const next = tagStore.suggestions(props.dbKey, found.prefix, { exclude: found.existing })
    if (!next.length) return close()
    context = found
    if (!open.value || items.value.length !== next.length) active.value = 0
    items.value = next
    active.value = Math.min(active.value, next.length - 1)
    const caret = caretPosition(textarea, found.start)
    position.value = {
        top: textarea.offsetTop + caret.top + caret.height,
        left: textarea.offsetLeft + Math.max(0, caret.left),
    }
    open.value = true
}

function accept(i) {
    const item = items.value[i]
    if (!item || !context) return
    const label = item.label
    skipNext = true
    const changed = editorStore.transformText(({ value, selectionStart }) => {
        const fresh = tagCompletionContext(value, selectionStart)
        if (!fresh) return null
        return applyTagCompletion(value, fresh, label)
    })
    if (!changed) skipNext = false
    close()
}

function onKeydown(event) {
    if (!open.value) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1
        active.value = (active.value + step + items.value.length) % items.value.length
    } else if (event.key === 'Enter' || event.key === 'Tab') {
        if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
        accept(active.value)
    } else if (event.key === 'Escape') {
        dismissedAt = context?.start ?? null
        close()
    } else {
        return
    }
    // Before OverType sees it: this listener runs in the capture phase on an
    // ancestor of the textarea.
    event.preventDefault()
    event.stopPropagation()
}

function onKeyup(event) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) update()
    else if (!open.value && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) update()
}

function onBlur() {
    close()
}

function detach() {
    if (!listeningOn) return
    const { textarea, host } = listeningOn
    textarea.removeEventListener('input', update)
    textarea.removeEventListener('click', update)
    textarea.removeEventListener('keyup', onKeyup)
    textarea.removeEventListener('blur', onBlur)
    textarea.removeEventListener('scroll', close)
    host.removeEventListener('keydown', onKeydown, true)
    listeningOn = null
}

watch(() => props.textarea, (textarea) => {
    detach()
    close()
    if (!textarea) return
    const host = textarea.parentElement || textarea
    textarea.addEventListener('input', update)
    textarea.addEventListener('click', update)
    textarea.addEventListener('keyup', onKeyup)
    textarea.addEventListener('blur', onBlur)
    textarea.addEventListener('scroll', close)
    host.addEventListener('keydown', onKeydown, true)
    listeningOn = { textarea, host }
}, { immediate: true })

watch(() => props.dbKey, () => {
    dismissedAt = null
    close()
})

onBeforeUnmount(detach)
</script>

<style scoped>
.pn-tag-suggest {
    position: absolute;
    z-index: 30;
    min-width: 10rem;
    max-width: 18rem;
    max-height: 14rem;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid #e5e7eb;
    border-radius: 0.5rem;
    background: #ffffff;
    box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
    font-size: 14px;
    color: #111827;
}

.pn-tag-suggest-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 0.375rem;
    cursor: pointer;
}

.pn-tag-suggest-item:hover,
.pn-tag-suggest-active {
    background: #f3f4f6;
}

.pn-tag-suggest-swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
}

:global(html[data-theme='dark']) .pn-tag-suggest {
    border-color: var(--pn-border, #343434);
    background: var(--pn-surface-elevated, #242424);
    color: #d4d4d4;
}

:global(html[data-theme='dark']) .pn-tag-suggest-item:hover,
:global(html[data-theme='dark']) .pn-tag-suggest-active {
    background: var(--pn-surface-inset, #2c2c2c);
}
</style>
