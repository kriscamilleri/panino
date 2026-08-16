<template>
    <!--
        Single-field name prompt shared by the create-file, create-folder and
        rename flows. Replaces three hand-rolled dialogs that each had their own
        button colours and spacing.
    -->
    <BaseModal
        :show="show"
        :title="title"
        size="sm"
        :close-testid="closeTestid"
        @close="$emit('cancel')"
    >
        <label
            class="pn-label"
            :for="inputId"
        >{{ label }}</label>
        <input
            :id="inputId"
            ref="inputRef"
            :value="modelValue"
            type="text"
            class="pn-input"
            :placeholder="placeholder"
            :data-testid="inputTestid"
            @input="$emit('update:modelValue', $event.target.value)"
            @keyup.enter="$emit('confirm')"
        />

        <template #footer>
            <BaseButton
                variant="secondary"
                size="md"
                :data-testid="cancelTestid"
                @click="$emit('cancel')"
            >
                Cancel
            </BaseButton>
            <BaseButton
                variant="primary"
                size="md"
                :data-testid="confirmTestid"
                @click="$emit('confirm')"
            >
                {{ confirmLabel }}
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import BaseButton from './BaseButton.vue';

const props = defineProps({
    show: { type: Boolean, default: true },
    title: { type: String, required: true },
    label: { type: String, default: 'Name' },
    placeholder: { type: String, default: '' },
    confirmLabel: { type: String, default: 'Create' },
    modelValue: { type: String, default: '' },
    inputId: { type: String, default: undefined },
    inputTestid: { type: String, default: undefined },
    cancelTestid: { type: String, default: undefined },
    confirmTestid: { type: String, default: undefined },
    closeTestid: { type: String, default: undefined },
});

defineEmits(['update:modelValue', 'confirm', 'cancel']);

const inputRef = ref(null);

watch(
    () => props.show,
    async (visible) => {
        if (!visible) return;
        await nextTick();
        inputRef.value?.focus();
    },
    { immediate: true },
);
</script>
