import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { useAuthStore } from "./authStore";
import { useConflictStore } from "./conflictStore";
import { useEditorStore } from "./editorStore";
import { useSyncStore } from "./syncStore";

const API_URL = import.meta.env.PROD
  ? "/api"
  : (import.meta.env.VITE_API_SERVICE_URL || "http://localhost:8000");

export const useSpaceTransferStore = defineStore("spaceTransferStore", () => {
  const authStore = useAuthStore();
  const syncStore = useSyncStore();
  const pending = ref(null);
  const transfers = ref([]);
  const working = ref(false);
  const error = ref("");

  const recoverable = computed(() => transfers.value.filter(
    (transfer) => !["complete", "kept_both"].includes(transfer.status),
  ));

  async function request(path, options = {}, allowRetry = true) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${authStore.token || ""}`,
        ...(options.headers || {}),
      },
    });
    if (response.status === 401 && allowRetry && await authStore.refreshToken()) {
      return request(path, options, false);
    }
    if (response.status === 204) return {};
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = new Error(data?.error || "Transfer interrupted; retry is safe.");
      failure.code = data?.code || "TRANSFER_FAILED";
      throw failure;
    }
    return data;
  }

  function begin(details) {
    error.value = "";
    pending.value = { ...details };
  }

  function cancel() {
    if (!working.value) pending.value = null;
  }

  async function refreshLocalDatabases() {
    await syncStore.sync();
  }

  async function loadRecoverable() {
    // Transfers exist only between a personal database and a shared space.
    // When the server offers no shared spaces there is nothing to recover, and
    // asking would cost every user one request on every load.
    if (!syncStore.sharedSpacesAvailable) {
      transfers.value = [];
      return recoverable.value;
    }
    try {
      transfers.value = (await request("/space-transfers")).transfers || [];
    } catch (failure) {
      error.value = failure.message;
    }
    return recoverable.value;
  }

  const NOT_UPLOADED = {
    "sync-disabled": "Sync is turned off, so the server does not have this Document's latest text. Turn sync on and try again.",
    offline: "You are offline. The server does not have this Document's latest text, so it cannot be moved now.",
    "sync-failed": "Sync is failing, so the server does not have this Document's latest text. Moving it now would lose your recent changes.",
    "still-uploading": "This device is still uploading changes. Try again in a moment.",
  };

  /**
   * The move is done by the server, on the server's copy, and ends by deleting
   * the source. Anything that exists only on this device has to get there
   * first, or it is left out of the copy and then deleted with the original.
   */
  async function sourceIsOnServer({ sourceDbKey, sourceNoteId }) {
    const editorStore = useEditorStore();
    if (editorStore.isHoldingChanges()) {
      throw new Error("This Document has unsaved changes that are being held. Choose which version to keep before moving it.");
    }
    await editorStore.flushPendingSave();
    if (useConflictStore().hasConflict(sourceNoteId, sourceDbKey)) {
      throw new Error("Resolve this Document's changes before moving it.");
    }
    const uploaded = await syncStore.ensureUploaded(sourceDbKey);
    if (!uploaded.ok) throw new Error(NOT_UPLOADED[uploaded.reason] || NOT_UPLOADED["sync-failed"]);
  }

  async function confirm() {
    if (!pending.value || working.value) return null;
    working.value = true;
    error.value = "";
    try {
      await sourceIsOnServer(pending.value);
      const data = await request("/space-transfers", {
        method: "POST",
        body: JSON.stringify({
          sourceDbKey: pending.value.sourceDbKey,
          destinationDbKey: pending.value.destinationDbKey,
          sourceNoteId: pending.value.sourceNoteId,
          destinationFolderId: pending.value.destinationFolderId,
        }),
      });
      pending.value = null;
      await refreshLocalDatabases();
      await loadRecoverable();
      return data.transfer;
    } catch (failure) {
      error.value = failure.message;
      await loadRecoverable();
      throw failure;
    } finally {
      working.value = false;
    }
  }

  async function act(transferId, action) {
    working.value = true;
    error.value = "";
    try {
      const data = await request(
        `/space-transfers/${encodeURIComponent(transferId)}/${action}`,
        { method: "POST" },
      );
      await refreshLocalDatabases();
      await loadRecoverable();
      return data.transfer;
    } catch (failure) {
      error.value = failure.message;
      await loadRecoverable();
      throw failure;
    } finally {
      working.value = false;
    }
  }

  /** Give up a move that has not copied the Document yet. */
  async function abandon(transferId) {
    working.value = true;
    error.value = "";
    try {
      await request(`/space-transfers/${encodeURIComponent(transferId)}`, { method: "DELETE" });
      await loadRecoverable();
    } catch (failure) {
      error.value = failure.message;
      await loadRecoverable();
      throw failure;
    } finally {
      working.value = false;
    }
  }

  return {
    pending,
    transfers,
    recoverable,
    working,
    error,
    begin,
    cancel,
    confirm,
    loadRecoverable,
    retry: (id) => act(id, "retry"),
    keepBoth: (id) => act(id, "keep-both"),
    deleteSource: (id) => act(id, "delete-source"),
    abandon,
  };
});
