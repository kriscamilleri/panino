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
  // "copy" or "move" while a new transfer is being made, so the dialog can
  // say which; null otherwise.
  const workingMode = ref(null);
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

  const VERBS = {
    copy: { ing: "copying", past: "copied" },
    move: { ing: "moving", past: "moved" },
  };

  /** Why the server's version cannot be used yet, in terms of what was asked for. */
  function notUploadedMessage(reason, mode) {
    const latest = "the server does not have this Document's latest text";
    const messages = {
      "sync-disabled": `Sync is turned off, so ${latest}. Turn sync on and try again.`,
      offline: `You are offline. ${latest[0].toUpperCase()}${latest.slice(1)}, so it cannot be ${VERBS[mode].past} now.`,
      "sync-failed": mode === "copy"
        ? `Sync is failing, so ${latest}. A copy made now would be missing your recent changes.`
        : `Sync is failing, so ${latest}. Moving it now would lose your recent changes.`,
      "still-uploading": "This device is still uploading changes. Try again in a moment.",
    };
    return messages[reason] || messages["sync-failed"];
  }

  /**
   * Copying and moving are both done by the server, on the server's version.
   * Anything that exists only on this device has to get there first: a copy
   * would be made without it, and a move would then delete it with the
   * original.
   */
  async function sourceIsOnServer({ sourceDbKey, sourceNoteId }, mode) {
    const editorStore = useEditorStore();
    if (editorStore.isHoldingChanges()) {
      throw new Error(`This Document has unsaved changes that are being held. Choose which version to keep before ${VERBS[mode].ing} it.`);
    }
    await editorStore.flushPendingSave();
    if (useConflictStore().hasConflict(sourceNoteId, sourceDbKey)) {
      throw new Error(`Resolve this Document's changes before ${VERBS[mode].ing} it.`);
    }
    const uploaded = await syncStore.ensureUploaded(sourceDbKey);
    if (!uploaded.ok) throw new Error(notUploadedMessage(uploaded.reason, mode));
  }

  /**
   * Carry out the pending transfer as a copy or as a move.
   *
   * "copy" leaves the original, with its revision history, where it is.
   * "move" deletes the original once the copy is verified, and its revision
   * history with it. There is no default: the caller must have asked.
   */
  async function confirm(mode) {
    if (mode !== "copy" && mode !== "move") throw new Error("Choose whether to copy or move the Document.");
    if (!pending.value || working.value) return null;
    working.value = true;
    workingMode.value = mode;
    error.value = "";
    try {
      await sourceIsOnServer(pending.value, mode);
      const data = await request("/space-transfers", {
        method: "POST",
        body: JSON.stringify({
          sourceDbKey: pending.value.sourceDbKey,
          destinationDbKey: pending.value.destinationDbKey,
          sourceNoteId: pending.value.sourceNoteId,
          destinationFolderId: pending.value.destinationFolderId,
          mode,
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
      workingMode.value = null;
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

  /** Give up a copy or move that has not copied the Document yet. */
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
    workingMode,
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
