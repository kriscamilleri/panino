<template>
    <AccountLayout title="Images">
        <div class="space-y-6">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="text-sm text-gray-600">
                    <p>Images: {{ imageManager.stats.imageCount }}</p>
                    <p>Total storage: {{ formatBytes(imageManager.stats.totalImageBytes) }}</p>
                </div>
                <BaseButton
                    :disabled="selectedIds.length === 0 || imageManager.isDeleting"
                    @click="handleBulkDelete"
                    data-testid="images-bulk-delete"
                >
                    <Trash2 class="w-4 h-4" />
                    <span>Delete Selected</span>
                </BaseButton>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                    v-model="search"
                    type="text"
                    placeholder="Search filename"
                    class="w-full rounded border px-3 py-2 text-sm"
                    @keyup.enter="applyFilters"
                    data-testid="images-search"
                />
                <select
                    v-model="sort"
                    class="w-full rounded border px-3 py-2 text-sm"
                    @change="applyFilters"
                    data-testid="images-sort"
                >
                    <option value="created_desc">Newest</option>
                    <option value="created_asc">Oldest</option>
                    <option value="size_desc">Largest</option>
                    <option value="size_asc">Smallest</option>
                </select>
                <BaseButton
                    @click="applyFilters"
                    data-testid="images-refresh"
                >
                    <RefreshCw class="w-4 h-4" />
                    <span>Refresh</span>
                </BaseButton>
            </div>

            <div v-if="imageManager.error" class="text-sm text-red-600">
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
                                    data-testid="images-select-all"
                                />
                            </th>
                            <th class="px-3 py-2 text-left">Preview</th>
                            <th class="px-3 py-2 text-left">Filename</th>
                            <th class="px-3 py-2 text-left">MIME</th>
                            <th class="px-3 py-2 text-left">Size</th>
                            <th class="px-3 py-2 text-left">Created</th>
                            <th class="px-3 py-2 text-left">Usage</th>
                            <th class="px-3 py-2 text-left">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100 bg-white">
                        <tr v-if="imageManager.isLoading">
                            <td colspan="8" class="px-3 py-4 text-center text-gray-500">Loading images...</td>
                        </tr>
                        <tr v-else-if="imageManager.images.length === 0">
                            <td colspan="8" class="px-3 py-4 text-center text-gray-500">No images found.</td>
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
                                    :data-testid="`images-select-${image.id}`"
                                />
                            </td>
                            <td class="px-3 py-2 align-middle">
                                <img
                                    :src="imagePreviewUrl(image.imageUrl)"
                                    :alt="image.filename"
                                    class="h-10 w-10 rounded object-cover border"
                                />
                            </td>
                            <td class="px-3 py-2 align-middle">{{ image.filename }}</td>
                            <td class="px-3 py-2 align-middle">{{ image.mimeType }}</td>
                            <td class="px-3 py-2 align-middle">{{ formatBytes(image.sizeBytes) }}</td>
                            <td class="px-3 py-2 align-middle">{{ formatDate(image.createdAt) }}</td>
                            <td class="px-3 py-2 align-middle">{{ image.usageCount }}</td>
                            <td class="px-3 py-2 align-middle">
                                <BaseButton
                                    :disabled="imageManager.isDeleting"
                                    @click="handleSingleDelete(image)"
                                    :data-testid="`images-delete-${image.id}`"
                                >
                                    <Trash2 class="w-4 h-4" />
                                    <span>Delete</span>
                                </BaseButton>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="flex items-center justify-between">
                <BaseButton
                    :disabled="cursorStack.length === 0 || imageManager.isLoading"
                    @click="goPrevious"
                    data-testid="images-prev"
                >
                    <ChevronLeft class="w-4 h-4" />
                    <span>Previous</span>
                </BaseButton>
                <BaseButton
                    :disabled="!imageManager.nextCursor || imageManager.isLoading"
                    @click="goNext"
                    data-testid="images-next"
                >
                    <span>Next</span>
                    <ChevronRight class="w-4 h-4" />
                </BaseButton>
            </div>
        </div>
    </AccountLayout>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ChevronLeft, ChevronRight, RefreshCw, Trash2 } from 'lucide-vue-next';
import AccountLayout from '@/components/AccountLayout.vue';
import BaseButton from '@/components/BaseButton.vue';
import { useImageManagerStore } from '@/store/imageManagerStore';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';

const PAGE_LIMIT = 25;

const imageManager = useImageManagerStore();
const authStore = useAuthStore();
const uiStore = useUiStore();

const search = ref('');
const sort = ref('created_desc');
const currentCursor = ref(null);
const cursorStack = ref([]);
const selectedSet = ref(new Set());

const selectedIds = computed(() => [...selectedSet.value]);
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

function summarizeUsage(usageMap) {
    const referenced = Object.values(usageMap).filter((usage) => usage.count > 0);
    if (referenced.length === 0) {
        return 'No notes reference the selected images. This is a safe delete.';
    }

    const totalReferences = referenced.reduce((acc, usage) => acc + usage.count, 0);
    const notes = [];
    referenced.forEach((usage) => {
        usage.notes.forEach((note) => {
            if (notes.length < 5 && !notes.some((existing) => existing.id === note.id)) {
                notes.push(note);
            }
        });
    });

    const noteList = notes.map((note) => `- ${note.title}`).join('\n');
    return `Warning: ${totalReferences} note reference(s) found. Markdown links will break if deleted.\n\nAffected notes (up to 5):\n${noteList}`;
}

async function collectUsage(imageIds) {
    const usageMap = {};
    for (const imageId of imageIds) {
        usageMap[imageId] = await imageManager.fetchImageUsage(imageId);
    }
    return usageMap;
}

async function refreshAfterDelete(deletedIds) {
    if (deletedIds.length > 0) {
        selectedSet.value = new Set(selectedIds.value.filter((id) => !deletedIds.includes(id)));
    }

    await Promise.all([
        loadPage(currentCursor.value),
        imageManager.fetchStats(),
    ]);
}

async function handleSingleDelete(image) {
    const usage = await imageManager.fetchImageUsage(image.id);
    const warning = summarizeUsage({ [image.id]: usage });
    const confirmed = window.confirm(`Delete image "${image.filename}"?\n\n${warning}`);
    if (!confirmed) return;

    try {
        await imageManager.deleteImage(image.id, usage.count > 0);
        uiStore.addToast('Image deleted.', 'success');
        await refreshAfterDelete([image.id]);
    } catch (err) {
        uiStore.addToast(err.message || 'Failed to delete image.', 'error');
    }
}

async function handleBulkDelete() {
    const ids = selectedIds.value;
    if (ids.length === 0) return;

    const usageMap = await collectUsage(ids);
    const warning = summarizeUsage(usageMap);
    const confirmed = window.confirm(`Delete ${ids.length} selected image(s)?\n\n${warning}`);
    if (!confirmed) return;

    try {
        const force = Object.values(usageMap).some((usage) => usage.count > 0);
        const response = await imageManager.bulkDelete(ids, force);
        const results = response?.results || [];
        const deletedIds = results.filter((result) => result.deleted).map((result) => result.id);
        const failed = results.filter((result) => !result.deleted).length;

        if (deletedIds.length > 0) {
            uiStore.addToast(`Deleted ${deletedIds.length} image(s).`, 'success');
        }
        if (failed > 0) {
            uiStore.addToast(`${failed} image(s) were not deleted.`, 'warning');
        }

        await refreshAfterDelete(deletedIds);
    } catch (err) {
        uiStore.addToast(err.message || 'Bulk delete failed.', 'error');
    }
}

onMounted(async () => {
    await applyFilters();
});
</script>
