<template>
    <form
        class="property-picker"
        :class="layout === 'phone' ? 'property-picker-phone' : 'property-picker-desktop'"
        data-testid="property-picker"
        @submit.prevent="add"
    >
        <label
            class="property-picker-label"
            for="property-picker-key"
        >Property</label>
        <select
            id="property-picker-key"
            v-model="key"
            class="property-picker-field"
            :class="fieldClass"
            data-autofocus
            data-testid="property-picker-key"
            :aria-busy="loading"
        >
            <option
                value=""
                disabled
            >{{ loading ? 'Loading properties…' : 'Choose a property' }}</option>
            <optgroup
                v-if="frontMatterKeys.length"
                label="In your Documents"
            >
                <option
                    v-for="entry in frontMatterKeys"
                    :key="entry.key"
                    :value="entry.key"
                >{{ entry.key }} ({{ entry.count }})</option>
            </optgroup>
            <optgroup label="Built in">
                <option
                    v-for="entry in builtInKeys"
                    :key="entry.key"
                    :value="entry.key"
                >{{ entry.label }}</option>
            </optgroup>
        </select>

        <label
            class="property-picker-label"
            for="property-picker-condition"
        >Condition</label>
        <select
            id="property-picker-condition"
            v-model="condition"
            class="property-picker-field"
            :class="fieldClass"
            data-testid="property-picker-condition"
        >
            <option
                v-for="entry in PICKER_CONDITIONS"
                :key="entry.id"
                :value="entry.id"
            >{{ entry.label }}</option>
        </select>

        <template v-if="needsValue">
            <label
                class="property-picker-label"
                for="property-picker-value"
            >Value</label>
            <input
                id="property-picker-value"
                v-model="value"
                class="property-picker-field"
                :class="fieldClass"
                :type="dateField ? 'date' : isNumber ? 'number' : 'text'"
                :list="dateField ? undefined : 'property-picker-values'"
                autocomplete="off"
                maxlength="200"
                data-testid="property-picker-value"
            >
            <datalist id="property-picker-values">
                <option
                    v-for="entry in suggestions"
                    :key="entry.value"
                    :value="entry.value"
                />
            </datalist>
        </template>

        <p
            v-if="error"
            class="property-picker-error"
            role="alert"
            data-testid="property-picker-error"
        >{{ error }}</p>
        <p
            v-else-if="preview"
            class="property-picker-preview"
            data-testid="property-picker-preview"
        >Adds <code>{{ preview }}</code></p>

        <div class="property-picker-actions">
            <button
                type="button"
                :class="layout === 'phone' ? 'ph-chip' : 'rounded-md border border-gray-300 bg-white px-3 py-1 text-sm hover:bg-gray-100'"
                data-testid="property-picker-cancel"
                @click="emit('close')"
            >Cancel</button>
            <button
                type="submit"
                :class="layout === 'phone' ? 'ph-chip property-picker-add-phone' : 'rounded-md border border-blue-600 bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700'"
                data-testid="property-picker-add"
            >Add</button>
        </div>
    </form>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import {
    buildPropertyPart,
    conditionNeedsValue,
    isDateKey,
    PICKER_CONDITIONS,
} from '@/utils/propertyPicker'

/**
 * The property picker's form (advanced-search.md §5.4): a property, a condition in words and
 * a value, written into the query as a `prop:` part the parser has checked. The phone page
 * shows it in a bottom sheet, the desktop panel in a popover under its chip.
 */
const props = defineProps({
    layout: { type: String, default: 'desktop', validator: (value) => ['desktop', 'phone'].includes(value) },
    keys: { type: Array, required: true },
    loading: { type: Boolean, default: false },
    /** @type {(key: string, options?: { limit?: number }) => Array<{ value: string, count: number }>} */
    valuesFor: { type: Function, required: true },
})
const emit = defineEmits(['add', 'close'])

const key = ref('')
const condition = ref('is')
const value = ref('')
const error = ref('')

const frontMatterKeys = computed(() => props.keys.filter((entry) => !entry.builtIn))
const builtInKeys = computed(() => props.keys.filter((entry) => entry.builtIn))
const needsValue = computed(() => conditionNeedsValue(condition.value))
const suggestions = computed(() => (key.value ? props.valuesFor(key.value).slice(0, 20) : []))
// Date-ness from every value seen for the key, not only the suggestions.
const dateField = computed(() => Boolean(key.value) && isDateKey(key.value, props.valuesFor(key.value, { limit: Infinity })))
const isNumber = computed(() => key.value === 'word_count')
const fieldClass = computed(() => (props.layout === 'phone'
    ? 'ph-input'
    : 'w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none'))
const preview = computed(() => {
    const built = buildPropertyPart({ key: key.value, condition: condition.value, value: value.value })
    return built.ok ? built.part : ''
})

watch([key, condition, value], () => { error.value = '' })
// A date field cannot hold a value typed for another key.
watch(dateField, () => { value.value = '' })

function add() {
    const built = buildPropertyPart({ key: key.value, condition: condition.value, value: value.value })
    if (!built.ok) {
        error.value = built.error
        return
    }
    emit('add', built.part)
}
</script>

<style scoped>
.property-picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.property-picker-desktop {
    font-size: 12px;
}

.property-picker-phone {
    gap: 8px;
    padding: 0 20px 16px;
    font-size: 15px;
}

.property-picker-label {
    font-weight: 600;
}

.property-picker-error {
    color: #b91c1c;
}

.property-picker-preview code {
    font-family: ui-monospace, monospace;
}

.property-picker-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
}
</style>
