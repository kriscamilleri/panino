<template>
    <div
        class="fixed inset-0 flex items-center justify-center z-50"
        data-testid="template-variable-dialog-container"
    >
        <div
            class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
            @click="$emit('cancel')"
        ></div>

        <div class="relative bg-white rounded-lg shadow-xl w-[560px] max-h-[80vh] flex flex-col">
            <!-- Header -->
            <div class="px-6 py-4 border-b">
                <div class="flex justify-between items-center">
                    <h3 class="text-xl font-semibold text-gray-800">
                        Fill in Template Variables
                    </h3>
                    <button
                        @click="$emit('cancel')"
                        class="text-gray-400 hover:text-gray-600 transition-colors"
                        data-testid="template-variable-close"
                    >
                        <X class="w-5 h-5" />
                    </button>
                </div>
                <p
                    v-if="templateName"
                    class="text-sm text-gray-500 mt-1"
                >
                    Template: {{ templateName }}
                </p>
            </div>

            <!-- Form area -->
            <div class="px-6 py-4 flex-1 overflow-y-auto max-h-[70vh]">
                <div class="space-y-4">
                    <div
                        v-for="(label, index) in labels"
                        :key="label"
                    >
                        <label class="block text-sm font-medium text-gray-700 mb-1">
                            {{ label }}
                        </label>
                        <input
                            v-model="values[label]"
                            type="text"
                            :placeholder="'Enter value...'"
                            :data-testid="`template-variable-input-${index}`"
                            class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                            @keyup.enter="handleSubmit"
                        />
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 bg-gray-50 rounded-b-lg border-t">
                <div class="flex justify-end gap-3">
                    <button
                        @click="$emit('cancel')"
                        class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                        data-testid="template-variable-cancel"
                    >
                        Cancel
                    </button>
                    <button
                        @click="handleSubmit"
                        class="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900 transition-colors"
                        data-testid="template-variable-submit"
                    >
                        Create Note
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { X } from 'lucide-vue-next';

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
