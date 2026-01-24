<template>
    <div
        v-if="show"
        class="fixed inset-0 flex items-center justify-center z-50"
        data-testid="variables-modal-container"
    >
        <div
            class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
            @click="$emit('close')"
        ></div>

        <div class="relative bg-white rounded-lg shadow-xl w-[640px] max-h-[80vh] flex flex-col">
            <div class="px-6 py-4 border-b">
                <div class="flex justify-between items-center">
                    <h3 class="text-xl font-semibold text-gray-800">Global Variables</h3>
                    <button
                        @click="$emit('close')"
                        class="text-gray-400 hover:text-gray-600 transition-colors"
                        data-testid="variables-modal-close-button"
                    >
                        <X class="w-5 h-5" />
                    </button>
                </div>
            </div>

            <div class="px-6 py-4 flex-1 overflow-y-auto">
                <p class="text-sm text-gray-600 mb-6">
                    Define variables available in all documents. Local front-matter variables override these values.
                </p>

                <div class="space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div class="md:col-span-1">
                            <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
                            <input
                                v-model="nameInput"
                                type="text"
                                placeholder="Company Name"
                                class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                data-testid="variables-modal-name-input"
                            />
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-sm font-medium text-gray-700 mb-1">Value</label>
                            <input
                                v-model="valueInput"
                                type="text"
                                placeholder="Acme Inc."
                                class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
                                data-testid="variables-modal-value-input"
                            />
                        </div>
                    </div>

                    <div class="flex items-center justify-between">
                        <div
                            v-if="error"
                            class="text-sm text-red-600"
                            data-testid="variables-modal-error"
                        >
                            {{ error }}
                        </div>
                        <div class="flex gap-2 ml-auto">
                            <button
                                v-if="isEditing"
                                @click="cancelEdit"
                                class="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                                data-testid="variables-modal-cancel-button"
                            >
                                Cancel
                            </button>
                            <button
                                @click="saveVariable"
                                class="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900"
                                data-testid="variables-modal-save-button"
                            >
                                <Plus class="w-4 h-4 mr-2" />
                                {{ isEditing ? 'Save' : 'Add' }}
                            </button>
                        </div>
                    </div>
                </div>

                <div class="mt-6">
                    <div class="flex items-center justify-between mb-3">
                        <h4 class="text-sm font-semibold text-gray-700">Existing Variables</h4>
                        <span class="text-xs text-gray-500">{{ globals.length }} total</span>
                    </div>

                    <div
                        v-if="!globals.length"
                        class="text-sm text-gray-500 border border-dashed border-gray-300 rounded-md p-4"
                        data-testid="variables-modal-empty"
                    >
                        No global variables yet.
                    </div>

                    <ul
                        v-else
                        class="space-y-2"
                        data-testid="variables-modal-list"
                    >
                        <li
                            v-for="item in globals"
                            :key="item.id"
                            class="flex items-center justify-between gap-3 px-3 py-2 border border-gray-200 rounded-md"
                        >
                            <div class="flex-1 min-w-0">
                                <p class="text-sm font-medium text-gray-900 truncate">{{ item.displayKey }}</p>
                                <p class="text-xs text-gray-500 truncate">{{ item.value }}</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <button
                                    @click="startEdit(item)"
                                    class="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
                                    data-testid="variables-modal-edit-button"
                                >
                                    <Pencil class="w-3.5 h-3.5 mr-1" />
                                    Edit
                                </button>
                                <button
                                    @click="removeVariable(item)"
                                    class="inline-flex items-center px-2 py-1 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100"
                                    data-testid="variables-modal-delete-button"
                                >
                                    <Trash2 class="w-3.5 h-3.5 mr-1" />
                                    Delete
                                </button>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>

            <div class="px-6 py-4 bg-gray-50 rounded-b-lg border-t">
                <div class="flex justify-end">
                    <button
                        @click="$emit('close')"
                        class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                        data-testid="variables-modal-done-button"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { X, Plus, Pencil, Trash2 } from 'lucide-vue-next';
import { useGlobalVariablesStore } from '@/store/globalVariablesStore';
import { useUiStore } from '@/store/uiStore';

defineProps({
    show: Boolean,
});

defineEmits(['close']);

const globalsStore = useGlobalVariablesStore();
const uiStore = useUiStore();

const nameInput = ref('');
const valueInput = ref('');
const error = ref('');
const editingKey = ref('');

const globals = computed(() => globalsStore.globals);
const isEditing = computed(() => Boolean(editingKey.value));

function resetForm() {
    nameInput.value = '';
    valueInput.value = '';
    error.value = '';
    editingKey.value = '';
}

function startEdit(item) {
    nameInput.value = item.displayKey || item.key;
    valueInput.value = item.value || '';
    editingKey.value = item.key;
    error.value = '';
}

function cancelEdit() {
    resetForm();
}

async function saveVariable() {
    error.value = '';
    const normalized = globalsStore.normalizeVariableName(nameInput.value);
    if (!normalized) {
        error.value = 'Name is required.';
        return;
    }
    const success = await globalsStore.saveGlobalVariable(nameInput.value, valueInput.value || '');
    if (success) {
        if (editingKey.value && editingKey.value !== normalized) {
            await globalsStore.deleteGlobalVariable(editingKey.value);
        }
        uiStore.addToast(isEditing.value ? 'Variable updated.' : 'Variable added.', 'success');
        resetForm();
    }
}

async function removeVariable(item) {
    const success = await globalsStore.deleteGlobalVariable(item.key);
    if (success) {
        uiStore.addToast('Variable deleted.', 'success');
        if (editingKey.value === item.key) {
            resetForm();
        }
    }
}
</script>
