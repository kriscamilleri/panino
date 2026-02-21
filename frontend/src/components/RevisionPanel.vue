<template>
  <section
    :class="[
      'bg-white h-full flex flex-col',
      standalone ? 'w-full border border-gray-200 rounded-lg overflow-hidden' : 'w-[420px] border-l border-gray-200'
    ]"
    data-testid="revision-panel"
  >
    <div class="flex h-full min-h-0">
      <div class="w-[30rem] max-w-[30rem] shrink-0 border-r border-gray-200 min-h-0 flex flex-col overflow-y-auto">
        <div v-if="revisionStore.isListLoading && revisionStore.revisions.length === 0" class="p-3 space-y-2">
          <div v-for="idx in 6" :key="idx" class="h-10 bg-gray-100 rounded animate-pulse"></div>
        </div>

        <div v-else-if="revisionStore.listError" class="p-3 text-sm text-red-600">
          <p>{{ revisionStore.listError }}</p>
          <button class="mt-2 text-xs text-blue-600 hover:underline" @click="refreshList">Retry</button>
        </div>

        <div v-else class="overflow-y-auto min-h-0">
          <button
            v-for="item in revisionStore.revisions"
            :key="item.id"
            class="w-full text-left px-3 py-2 border-b border-gray-100 hover:bg-gray-50"
            :class="item.id === revisionStore.selectedRevisionId ? 'bg-gray-100' : ''"
            @click="selectRevision(item.id)"
            :data-testid="`revision-item-${item.id}`"
          >
            <div class="text-xs text-gray-500">{{ formatTimestamp(item.createdAt) }}</div>
            <div class="text-sm font-medium text-gray-700 truncate">{{ item.title || '(Untitled)' }}</div>
            <div class="text-[11px] uppercase tracking-wide text-gray-400">{{ item.type }}</div>
          </button>

          <button
            v-if="revisionStore.hasMore"
            class="w-full px-3 py-2 text-xs text-blue-600 hover:bg-gray-50 border-t border-gray-100"
            @click="loadMore"
            :disabled="revisionStore.isListLoading"
          >
            {{ revisionStore.isListLoading ? 'Loading…' : 'Load older versions' }}
          </button>
        </div>
      </div>

      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div v-if="revisionStore.isDetailLoading" class="p-3 space-y-2">
          <div class="h-5 bg-gray-100 rounded animate-pulse"></div>
          <div class="h-40 bg-gray-100 rounded animate-pulse"></div>
        </div>

        <div v-else-if="revisionStore.detailError" class="p-3 text-sm text-red-600">
          <p>{{ revisionStore.detailError }}</p>
          <button
            v-if="revisionStore.selectedRevisionId"
            class="mt-2 text-xs text-blue-600 hover:underline"
            @click="selectRevision(revisionStore.selectedRevisionId)"
          >
            Retry
          </button>
        </div>

        <template v-else-if="revisionStore.selectedRevisionDetail">
          <div v-if="showCompare" class="overflow-y-auto h-full min-h-0 font-mono text-xs leading-5">
            <div
              v-for="(line, i) in diffLineItems"
              :key="i"
              :class="{
                'bg-red-50 text-red-700': line.type === 'removed',
                'bg-green-50 text-green-700': line.type === 'added',
                'text-gray-600': line.type === 'unchanged',
              }"
              class="flex px-2 whitespace-pre-wrap break-all"
            >
              <span class="select-none w-4 shrink-0 mr-2 text-gray-400">{{ line.prefix }}</span><span>{{ line.text }}</span>
            </div>
            <div v-if="diffLineItems.length === 0" class="p-3 text-gray-400 text-xs">No differences.</div>
          </div>

          <div v-else class="p-2 h-full">
            <textarea readonly class="w-full h-full text-xs border rounded p-2 resize-none bg-white">{{ revisionStore.selectedRevisionDetail.content }}</textarea>
          </div>
        </template>

        <div v-else class="p-3 text-sm text-gray-500">
          Select a revision to view details.
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { diffLines } from 'diff';
import { Save, RotateCcw } from 'lucide-vue-next';
import BaseButton from '@/components/BaseButton.vue';
import { useRevisionStore } from '@/store/revisionStore';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';

defineProps({
  standalone: {
    type: Boolean,
    default: false,
  },
});

const revisionStore = useRevisionStore();
const docStore = useDocStore();
const ui = useUiStore();
const showCompare = ref(true);

const selectedFileId = computed(() => docStore.selectedFileId);
const currentContent = computed(() => docStore.selectedFile?.content || '');

const diffLineItems = computed(() => {
  const oldText = revisionStore.selectedRevisionDetail?.content || '';
  const newText = currentContent.value;
  const hunks = diffLines(oldText, newText);
  const result = [];
  for (const hunk of hunks) {
    const lines = hunk.value.replace(/\n$/, '').split('\n');
    for (const line of lines) {
      if (hunk.added) {
        result.push({ type: 'added', prefix: '+', text: line });
      } else if (hunk.removed) {
        result.push({ type: 'removed', prefix: '-', text: line });
      } else {
        result.push({ type: 'unchanged', prefix: ' ', text: line });
      }
    }
  }
  return result;
});

watch(
  () => selectedFileId.value,
  async (noteId) => {
    revisionStore.resetState();
    showCompare.value = true;
    if (!noteId) return;
    try {
      await revisionStore.fetchRevisions(noteId, { reset: true, limit: 50 });
    } catch {
      // error is surfaced via store state and inline UI
    }
  },
  { immediate: true }
);

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function refreshList() {
  if (!selectedFileId.value) return;
  try {
    await revisionStore.fetchRevisions(selectedFileId.value, { reset: true, limit: 50 });
  } catch {
    // error is surfaced via store state and inline UI
  }
}

async function selectRevision(revisionId) {
  if (!selectedFileId.value || !revisionId) return;
  try {
    await revisionStore.fetchRevisionDetail(selectedFileId.value, revisionId);
  } catch {
    // error is surfaced via store state and inline UI
  }
}

async function loadMore() {
  if (!selectedFileId.value) return;
  try {
    await revisionStore.loadMore(selectedFileId.value, 50);
  } catch {
    // error is surfaced via store state and inline UI
  }
}

async function saveVersion() {
  if (!selectedFileId.value) return;
  try {
    const result = await revisionStore.saveManualRevision(selectedFileId.value);
    if (result?.created === false && result?.reason === 'duplicate-latest') {
      ui.addToast('Latest version is identical; nothing new was saved.', 'info');
      return;
    }
    ui.addToast('Version saved.', 'success');
  } catch (error) {
    ui.addToast(error?.message || 'Failed to save version.', 'error');
  }
}

async function restoreSelected() {
  if (!selectedFileId.value || !revisionStore.selectedRevisionId) return;

  try {
    const result = await revisionStore.restoreRevision(
      selectedFileId.value,
      revisionStore.selectedRevisionId
    );

    if (result?.note && docStore.selectedFile?.id === result.note.id) {
      docStore.selectedFile.title = result.note.title;
      docStore.selectedFile.content = result.note.content;
      docStore.selectedFile.updated_at = result.note.updatedAt;
    }

    await docStore.loadRootItems();
    ui.addToast('Revision restored.', 'success');
  } catch (error) {
    ui.addToast(error?.message || 'Failed to restore revision.', 'error');
  }
}

defineExpose({ showCompare, saveVersion, restoreSelected, revisionStore, selectedFileId });
</script>
