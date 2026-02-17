<template>
    <div
        v-if="show"
        class="fixed inset-0 flex items-center justify-center z-50"
        data-testid="image-library-modal-container"
    >
        <div
            class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
            @click="$emit('close')"
        ></div>

        <div class="relative bg-white rounded-lg shadow-xl w-[600px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden">
            <div class="px-6 py-4 border-b flex items-center justify-between">
                <h3 class="text-xl font-semibold text-gray-800">Image Library</h3>
                <button
                    @click="$emit('close')"
                    class="text-gray-400 hover:text-gray-600 transition-colors"
                    data-testid="image-library-modal-close"
                >
                    <X class="w-5 h-5" />
                </button>
            </div>

            <div class="px-6 py-4 flex-1 overflow-y-auto space-y-6">
                <div class="flex items-center justify-between gap-3">
                    <div class="text-sm text-gray-600">
                        <p>Images: {{ imageManager.stats.imageCount }}</p>
                        <p>Total storage: {{ formatBytes(imageManager.stats.totalImageBytes) }}</p>
                    </div>
                    <BaseButton
                        :disabled="selectedIds.length === 0 || imageManager.isLoading"
                        @click="insertSelected"
                        class="w-auto"
                        data-testid="image-library-insert-selected"
                    >
                        <Image class="w-4 h-4" />
                        <span>Insert Selected</span>
                    </BaseButton>
                </div>

                <div class="grid grid-cols-3 gap-3">
                    <input
                        v-model="search"
                        type="text"
                        placeholder="Search filename"
                        class="w-full rounded border px-3 py-2 text-sm"
                        @keyup.enter="applyFilters"
                        data-testid="image-library-search"
                    />
                    <select
                        v-model="sort"
                        class="w-full rounded border px-3 py-2 text-sm"
                        @change="applyFilters"
                        data-testid="image-library-sort"
                    >
                        <option value="created_desc">Newest</option>
                        <option value="created_asc">Oldest</option>
                        <option value="size_desc">Largest</option>
                        <option value="size_asc">Smallest</option>
                    </select>
                    <BaseButton
                        @click="applyFilters"
                        data-testid="image-library-refresh"
                    >
                        <RefreshCw class="w-4 h-4" />
                        <span>Refresh</span>
                    </BaseButton>
                </div>

                <div
                    v-if="imageManager.error"
                    class="text-sm text-red-600"
                >
                    {{ imageManager.error }}
                </div>

                <div class="overflow-x-auto border rounded">
                    <table class="min-w-full divide-y divide-gray-200 text-sm">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-3 py-2 text-left">
                                    <input
                                        type="checkbox"
                                        :checked="allSelected"
                                        @change="toggleAll"
                                        data-testid="image-library-select-all"
                                    />
                                </th>
                                <th class="px-3 py-2 text-left">Preview</th>
                                <th class="px-3 py-2 text-left">Filename</th>
                                <th class="px-3 py-2 text-left">MIME</th>
                                <th class="px-3 py-2 text-left">Size</th>
                                <th class="px-3 py-2 text-left">Created</th>
                                <th class="px-3 py-2 text-left">Usage</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100 bg-white">
                            <tr v-if="imageManager.isLoading">
                                <td
                                    colspan="7"
                                    class="px-3 py-4 text-center text-gray-500"
                                >
                                    Loading images...
                                </td>
                            </tr>
                            <tr v-else-if="imageManager.images.length === 0">
                                <td
                                    colspan="7"
                                    class="px-3 py-4 text-center text-gray-500"
                                >
                                    No images found.
                                </td>
                            </tr>
                            <tr
                                v-else
                                v-for="image in imageManager.images"
                                :key="image.id"
                            >
                                <td class="px-3 py-2 align-middle">
                                    <input
                                        type="checkbox"
                                        :checked="selectedSet.has(image.id)"
                                        @change="toggleSelected(image.id)"
                                        :data-testid="`image-library-select-${image.id}`"
                                    />
                                </td>
                                <td class="px-3 py-2 align-middle">
                                    <img
                                        :src="imagePreviewUrl(image.imageUrl)"
                                        :alt="image.filename"
                                        class="h-10 w-10 rounded object-cover border"
                                    />
                                </td>
                                <td class="px-3 py-2 align-middle break-all">{{ image.filename }}</td>
                                <td class="px-3 py-2 align-middle">{{ image.mimeType }}</td>
                                <td class="px-3 py-2 align-middle">{{ formatBytes(image.sizeBytes) }}</td>
                                <td class="px-3 py-2 align-middle">{{ formatDate(image.createdAt) }}</td>
                                <td class="px-3 py-2 align-middle">{{ image.usageCount }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="flex items-center justify-between gap-3">
                    <BaseButton
                        :disabled="cursorStack.length === 0 || imageManager.isLoading"
                        @click="goPrevious"
                        class="flex-none"
                        data-testid="image-library-prev"
                    >
                        <ChevronLeft class="w-4 h-4" />
                        <span>Previous</span>
                    </BaseButton>
                    <BaseButton
                        :disabled="!imageManager.nextCursor || imageManager.isLoading"
                        @click="goNext"
                        class="flex-none"
                        data-testid="image-library-next"
                    >
                        <span>Next</span>
                        <ChevronRight class="w-4 h-4" />
                    </BaseButton>
                </div>
            </div>

            <div class="px-6 py-4 bg-gray-50 border-t rounded-b-lg">
                <div class="flex justify-end gap-3">
                    <button
                        @click="$emit('close')"
                        class="w-auto px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                        data-testid="image-library-cancel"
                    >
                        Cancel
                    </button>
                    <button
                        @click="insertSelected"
                        :disabled="selectedIds.length === 0 || imageManager.isLoading"
                        class="w-auto px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        data-testid="image-library-insert-footer"
                    >
                        Insert Selected
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Image, RefreshCw, X } from 'lucide-vue-next';
import BaseButton from '@/components/BaseButton.vue';
import { useImageManagerStore } from '@/store/imageManagerStore';
import { useAuthStore } from '@/store/authStore';

const PAGE_LIMIT = 25;

const props = defineProps({
    show: Boolean,
});

const emit = defineEmits(['close', 'insert-selected']);

const imageManager = useImageManagerStore();
const authStore = useAuthStore();

const search = ref('');
const sort = ref('created_desc');
const currentCursor = ref(null);
const cursorStack = ref([]);
const selectedSet = ref(new Set());

const selectedIds = computed(() => [...selectedSet.value]);
const selectedImages = computed(() => {
    const selectedIdSet = new Set(selectedIds.value);
    return imageManager.images.filter((image) => selectedIdSet.has(image.id));
});
const allSelected = computed(() => {
    if (imageManager.images.length === 0) return false;
    return imageManager.images.every((image) => selectedSet.value.has(image.id));
});

function formatDate(value) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, value)} B`;
    const units = ['KB', 'MB', 'GB'];
    let result = value;
    let index = -1;
    while (result >= 1024 && index < units.length - 1) {
        result /= 1024;
        index += 1;
    }
    return `${result.toFixed(result >= 10 ? 1 : 2)} ${units[index]}`;
}

function imagePreviewUrl(url) {
    if (!authStore.token) return url;
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.set('token', authStore.token);
    return import.meta.env.PROD ? `${parsed.pathname}${parsed.search}` : parsed.href;
}

async function loadPage(cursor = null) {
    await imageManager.fetchImages({
        limit: PAGE_LIMIT,
        cursor,
        search: search.value.trim(),
        sort: sort.value,
    });

    selectedSet.value = new Set(
        selectedIds.value.filter((id) => imageManager.images.some((image) => image.id === id))
    );
    currentCursor.value = cursor;
}

async function applyFilters() {
    cursorStack.value = [];
    currentCursor.value = null;
    await Promise.all([
        loadPage(null),
        imageManager.fetchStats(),
    ]);
}

async function goNext() {
    if (!imageManager.nextCursor) return;
    cursorStack.value.push(currentCursor.value);
    await loadPage(imageManager.nextCursor);
}

async function goPrevious() {
    if (cursorStack.value.length === 0) return;
    const previousCursor = cursorStack.value.pop();
    await loadPage(previousCursor || null);
}

function toggleSelected(imageId) {
    const next = new Set(selectedSet.value);
    if (next.has(imageId)) {
        next.delete(imageId);
    } else {
        next.add(imageId);
    }
    selectedSet.value = next;
}

function toggleAll() {
    if (allSelected.value) {
        selectedSet.value = new Set();
        return;
    }
    selectedSet.value = new Set(imageManager.images.map((image) => image.id));
}

function insertSelected() {
    if (selectedImages.value.length === 0) return;
    emit('insert-selected', selectedImages.value);
}

watch(
    () => props.show,
    async (show) => {
        if (!show) return;
        selectedSet.value = new Set();
        await applyFilters();
    }
);
</script>
