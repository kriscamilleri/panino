<template>
    <BaseModal
        title="Fill in Template Variables"
        :subtitle="templateName ? `Template: ${templateName}` : ''"
        size="sm"
        close-testid="template-variable-close"
        @close="$emit('cancel')"
    >
        <div class="space-y-4">
            <div
                v-for="(label, index) in labels"
                :key="label"
            >
                <label
                    class="pn-label"
                    :for="`template-variable-${index}`"
                >{{ label }}</label>
                <input
                    :id="`template-variable-${index}`"
                    v-model="values[label]"
                    type="text"
                    placeholder="Enter value..."
                    class="pn-input"
                    :data-testid="`template-variable-input-${index}`"
                    @keyup.enter="handleSubmit"
                />
            </div>
        </div>

        <template #footer>
            <BaseButton
                variant="secondary"
                size="md"
                data-testid="template-variable-cancel"
                @click="$emit('cancel')"
            >
                Cancel
            </BaseButton>
            <BaseButton
                variant="primary"
                size="md"
                data-testid="template-variable-submit"
                @click="handleSubmit"
            >
                Create Note
            </BaseButton>
        </template>
    </BaseModal>
</template>

<script setup>
import { reactive } from 'vue';
import BaseModal from '@/components/BaseModal.vue';
import BaseButton from '@/components/BaseButton.vue';

const props = defineProps({
    labels: {
        type: Array,
        required: true,
    },
    templateName: {
        type: String,
        default: '',
    },
});

const emit = defineEmits(['submit', 'cancel']);

const values = reactive(
    Object.fromEntries(props.labels.map((label) => [label, '']))
);

function handleSubmit() {
    emit('submit', { ...values });
}
</script>
