<template>
  <section
    v-if="store.recoverable.length"
    class="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
    data-testid="document-transfer-recovery"
  >
    <p class="font-medium">Document transfer needs attention</p>
    <p class="mt-1 text-xs">
      Nothing has been deleted. Revision history is never copied: it stays with the original,
      and is deleted with it when a move finishes.
    </p>
    <div
      v-for="transfer in store.recoverable"
      :key="transfer.id"
      class="mt-3 border-t border-amber-200 pt-3"
      :data-testid="`document-transfer-${transfer.id}`"
    >
      <p>{{ transfer.lastError || `The ${noun(transfer)} can be resumed safely.` }}</p>
      <ul v-if="transfer.warnings?.length" class="mt-1 list-disc pl-5 text-xs">
        <li v-for="warning in transfer.warnings" :key="`${transfer.id}:${warning.imageId}`">
          {{ warning.message }}
        </li>
      </ul>
      <div class="mt-2 flex flex-wrap gap-2">
        <BaseButton
          variant="primary"
          :disabled="store.working"
          data-testid="document-transfer-retry"
          @click="run(transfer, 'retry')"
        >{{ isCopy(transfer) ? 'Finish copy' : 'Retry' }}</BaseButton>
        <!-- A copy keeps its original by definition: finishing it is keeping
             both, and deleting the source is not on offer. -->
        <template v-if="canResolveDuplicate(transfer) && !isCopy(transfer)">
          <BaseButton
            variant="secondary"
            :disabled="store.working"
            data-testid="document-transfer-keep-both"
            @click="run(transfer, 'keepBoth')"
          >Keep both</BaseButton>
          <BaseButton
            variant="danger"
            :disabled="store.working"
            data-testid="document-transfer-delete-source"
            @click="run(transfer, 'deleteSource')"
          >Delete source</BaseButton>
        </template>
        <BaseButton
          v-if="!canResolveDuplicate(transfer)"
          variant="secondary"
          :disabled="store.working"
          data-testid="document-transfer-cancel"
          @click="run(transfer, 'abandon')"
        >Cancel {{ noun(transfer) }}</BaseButton>
      </div>
    </div>
  </section>

  <BaseModal
    :show="Boolean(store.pending)"
    title="Copy or move?"
    subtitle="Either way, this changes who can read it."
    :dismissible="!store.working"
    :close-on-backdrop="!store.working"
    data-testid="document-transfer-confirmation"
    @close="store.cancel"
  >
    <div class="space-y-3 text-sm text-gray-700">
      <p>
        <strong>{{ store.pending?.documentName || 'This Document' }}</strong> is in
        <strong>{{ store.pending?.sourceName }}</strong>. Put it in
        <strong>{{ store.pending?.destinationName }}</strong> as a copy, or move it there?
      </p>
      <dl class="space-y-2">
        <div class="rounded-md bg-gray-50 px-3 py-2" data-testid="document-transfer-copy-explanation">
          <dt class="font-medium text-gray-900">Copy</dt>
          <dd>
            The original stays in {{ store.pending?.sourceName }} with its revision history.
            {{ store.pending?.destinationName }} gets a copy that starts a new history.
          </dd>
        </div>
        <div class="rounded-md bg-amber-50 px-3 py-2 text-amber-900" data-testid="document-transfer-move-explanation">
          <dt class="font-medium">Move</dt>
          <dd>
            The original is deleted from {{ store.pending?.sourceName }} once the copy is checked.
            Its revision history is deleted with it and cannot be recovered.
          </dd>
        </div>
      </dl>
      <p>
        Images are copied and checked first. An image that is missing, or that belongs to a
        different database, keeps its link and is listed as a warning.
      </p>
      <p v-if="store.error" class="text-red-600" role="alert">{{ store.error }}</p>
    </div>
    <template #footer>
      <BaseButton variant="secondary" :disabled="store.working" @click="store.cancel">
        Cancel
      </BaseButton>
      <BaseButton
        variant="danger"
        :disabled="store.working"
        data-testid="document-transfer-move"
        @click="confirmTransfer('move')"
      >
        {{ store.workingMode === 'move' ? 'Moving…' : 'Move' }}
      </BaseButton>
      <BaseButton
        variant="primary"
        :disabled="store.working"
        data-testid="document-transfer-copy"
        @click="confirmTransfer('copy')"
      >
        {{ store.workingMode === 'copy' ? 'Copying…' : 'Copy' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>

<script setup>
import { watch } from "vue";
import BaseButton from "./BaseButton.vue";
import BaseModal from "./BaseModal.vue";
import { useSpaceTransferStore } from "@/store/spaceTransferStore";
import { useStructureStore } from "@/store/structureStore";
import { useSyncStore } from "@/store/syncStore";
import { useUiStore } from "@/store/uiStore";

const store = useSpaceTransferStore();
const structureStore = useStructureStore();
const syncStore = useSyncStore();
const ui = useUiStore();

// Interrupted transfers are loaded once the server is known to offer shared
// spaces. Discovery finishes after first paint, so this cannot be a one-off
// check at mount; and without shared spaces there is nothing to ask for.
watch(
  () => syncStore.sharedSpacesAvailable,
  (available) => { if (available) store.loadRecoverable(); },
  { immediate: true },
);

async function refreshTree() {
  await structureStore.loadRootItems();
}

function isCopy(transfer) {
  return transfer?.mode === "copy";
}

function noun(transfer) {
  return isCopy(transfer) ? "copy" : "move";
}

async function confirmTransfer(mode) {
  try {
    const transfer = await store.confirm(mode);
    if (!transfer) return;
    await refreshTree();
    const warnings = transfer.warnings?.length || 0;
    const done = mode === "copy" ? "Document copied" : "Document moved";
    const tail = mode === "copy" ? " The original is unchanged." : "";
    ui.addToast(
      warnings ? `${done} with ${warnings} image warning${warnings === 1 ? '' : 's'}.${tail}` : `${done}.${tail}`,
      warnings ? "warning" : "success",
    );
  } catch (error) {
    ui.addToast(error?.message || "Transfer interrupted; retry is safe.", "warning");
  }
}

async function run(transfer, action) {
  try {
    await store[action](transfer.id);
    await refreshTree();
    const done = {
      keepBoth: "Both Documents were kept.",
      abandon: isCopy(transfer)
        ? "The copy was cancelled. Nothing was changed."
        : "The move was cancelled. The Document is where it was.",
      retry: isCopy(transfer) ? "Document copied. The original is unchanged." : null,
    };
    ui.addToast(done[action] || "Document transfer recovered.", "success");
  } catch (error) {
    ui.addToast(error?.message || "Transfer recovery did not finish.", "warning");
  }
}

function canResolveDuplicate(transfer) {
  return ["destination_confirmed", "recoverable_duplicate"].includes(transfer.status);
}
</script>
