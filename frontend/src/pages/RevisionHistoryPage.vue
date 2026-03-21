<template>
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <AccountNav title="Revision History">
      <template #actions>
        <template v-if="docStore.selectedFileId">
          <BaseButton
            :isActive="panel?.showCompare"
            @click="panel && (panel.showCompare = !panel.showCompare)"
            data-testid="revision-panel-compare"
          >
            <Columns2 class="w-4 h-4" />
            <span>Compare</span>
          </BaseButton>
          <BaseButton
            :disabled="!panel?.revisionStore?.selectedRevisionDetail || panel?.revisionStore?.isActionLoading"
            @click="panel?.restoreSelected()"
            data-testid="revision-panel-restore"
          >
            <RotateCcw class="w-4 h-4" />
            <span>Restore</span>
          </BaseButton>
          <BaseButton
            :disabled="panel?.revisionStore?.isActionLoading"
            @click="panel?.saveVersion()"
            data-testid="revision-panel-save"
          >
            <Save class="w-4 h-4" />
            <span>Save version</span>
          </BaseButton>
        </template>
        <BaseButton @click="goBack">
          <ArrowLeft class="w-4 h-4" />
          <span>Back</span>
        </BaseButton>
      </template>
    </AccountNav>

    <div v-if="!docStore.selectedFileId" class="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500">
      <p class="text-sm">Select a document in the editor, then open Revision History from Tools.</p>
      <BaseButton @click="goBack">
        <ArrowLeft class="w-4 h-4" />
        <span>Back to Editor</span>
      </BaseButton>
    </div>

    <div v-else class="overflow-hidden" :style="{ height: 'calc(100vh - 57px)' }">
      <RevisionPanel ref="panel" standalone />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, Columns2, RotateCcw, Save } from 'lucide-vue-next';
import AccountNav from '@/components/AccountNav.vue';
import BaseButton from '@/components/BaseButton.vue';
import RevisionPanel from '@/components/RevisionPanel.vue';
import { useDocStore } from '@/store/docStore';

const router = useRouter();
const docStore = useDocStore();
const panel = ref(null);

function goBack() {
  if (docStore.selectedFileId) {
    router.push({ name: 'doc', params: { fileId: docStore.selectedFileId } });
    return;
  }
  router.push('/');
}
</script>
