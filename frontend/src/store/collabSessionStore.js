import { computed, markRaw, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import * as Y from "yjs";
import { v4 as uuidv4 } from "uuid";
import { useSyncStore } from "./syncStore";
import { useDocStore } from "./docStore";
import { useUiStore } from "./uiStore";

const RECONNECT_TIMEOUT_MS = 30_000;
const SEND_BATCH_MS = 50;
// Well inside the server's limit for one update (collabLimits.js), so several
// buffered updates never merge into a message it would refuse.
const MAX_UPDATE_BYTES = 500 * 1024;
// Longer than the server's one-second rate window.
const RESEND_DELAY_MS = 1100;

function decode(value) {
  const binary = atob(value || "");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encode(value) {
  let binary = "";
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const useCollabSessionStore = defineStore("collabSessionStore", () => {
  const syncStore = useSyncStore();
  const status = ref("idle");
  const sessionId = ref(null);
  const dbKey = ref(null);
  const noteId = ref(null);
  const participants = ref([]);
  const lastError = ref(null);
  const conflictHunks = ref([]);
  const conflict = ref(null);
  const ydoc = shallowRef(null);
  const localOrigin = markRaw({ name: "panino-collab-local" });
  const pending = new Map();
  // This tab, for the server's sequence counting. A browser profile has one
  // site id for all its tabs; two tabs in one session shared a counter and
  // each lost the other's updates.
  const clientId = uuidv4();
  let openRequestId = null;
  const cancelledOpens = new Set();
  let resendTimer = null;
  let nextSeq = 1;
  let sendTimer = null;
  let reconnectTimer = null;
  let bufferedUpdates = [];
  let removeSocketListener = null;
  let observedDoc = null;
  let lastAwarenessAt = 0;

  const isActive = computed(() => ["opening", "live", "reconnecting", "committing", "dropped"].includes(status.value));
  const isEditable = computed(() => status.value === "live" || status.value === "reconnecting");
  const unackedCount = ref(0);

  function setPendingCount() {
    unackedCount.value = pending.size + (bufferedUpdates.length ? 1 : 0);
  }

  function send(type, payload) {
    return syncStore.sendWebSocketMessage(type, payload);
  }

  function flushUpdates() {
    clearTimeout(sendTimer);
    sendTimer = null;
    // While a refused update is waiting to be resent, later ones wait with it:
    // the server takes sequence numbers strictly in order.
    if (!bufferedUpdates.length || !sessionId.value || resendTimer) return;
    while (bufferedUpdates.length) {
      const group = [bufferedUpdates.shift()];
      let size = group[0].length;
      while (bufferedUpdates.length && size + bufferedUpdates[0].length <= MAX_UPDATE_BYTES) {
        size += bufferedUpdates[0].length;
        group.push(bufferedUpdates.shift());
      }
      const seq = nextSeq++;
      const encoded = encode(group.length === 1 ? group[0] : Y.mergeUpdates(group));
      pending.set(seq, encoded);
      send("collab:update", { sessionId: sessionId.value, seq, update: encoded });
    }
    setPendingCount();
  }

  /**
   * Send again everything the server has not acknowledged, as one update under
   * the lowest waiting sequence number. Updates are idempotent, so one merged
   * update is as good as the originals, and it is one message: replayed one by
   * one after a reconnect, a minute of typing exceeded the server's rate limit
   * on arrival and the session was dropped.
   */
  function resendPending() {
    if (!pending.size || !sessionId.value) return;
    const ordered = [...pending.entries()].sort((a, b) => a[0] - b[0]);
    const seq = ordered[0][0];
    const update = ordered.length === 1
      ? ordered[0][1]
      : encode(Y.mergeUpdates(ordered.map(([, encoded]) => decode(encoded))));
    pending.clear();
    pending.set(seq, update);
    nextSeq = seq + 1;
    setPendingCount();
    send("collab:update", { sessionId: sessionId.value, seq, update });
  }

  function scheduleResend() {
    if (resendTimer) return;
    resendTimer = setTimeout(() => {
      resendTimer = null;
      resendPending();
      flushUpdates();
    }, RESEND_DELAY_MS);
  }

  function observeLocalUpdates(doc) {
    if (observedDoc) observedDoc.off("update", onYUpdate);
    observedDoc = doc;
    doc.on("update", onYUpdate);
  }

  function onYUpdate(update, origin, doc, transaction) {
    // Everything this tab did, not only what it typed. Undo and redo run with
    // the undo manager as their origin; filtered on the typing origin alone
    // they were applied here and never sent, and every later update from this
    // tab then referred to text the server did not have.
    if (!transaction?.local) return;
    bufferedUpdates.push(update);
    setPendingCount();
    if (!sendTimer) sendTimer = setTimeout(flushUpdates, SEND_BATCH_MS);
  }

  function resetDocument() {
    clearTimeout(sendTimer);
    clearTimeout(reconnectTimer);
    clearTimeout(resendTimer);
    sendTimer = null;
    reconnectTimer = null;
    resendTimer = null;
    if (observedDoc) observedDoc.off("update", onYUpdate);
    observedDoc = null;
    ydoc.value?.destroy();
    ydoc.value = null;
    pending.clear();
    bufferedUpdates = [];
    unackedCount.value = 0;
    nextSeq = 1;
    lastAwarenessAt = 0;
  }

  function reset() {
    resetDocument();
    openRequestId = null;
    status.value = "idle";
    sessionId.value = null;
    dbKey.value = null;
    noteId.value = null;
    participants.value = [];
    lastError.value = null;
    conflictHunks.value = [];
    conflict.value = null;
  }

  function open(spaceId, documentId) {
    if (!syncStore.isOnline) {
      lastError.value = "Live sessions require an internet connection.";
      return false;
    }
    reset();
    status.value = "opening";
    dbKey.value = `space:${spaceId}`;
    noteId.value = documentId;
    openRequestId = send("collab:open", { space: spaceId, noteId: documentId, clientId });
    if (!openRequestId) {
      status.value = "dropped";
      lastError.value = "The live connection is unavailable.";
      return false;
    }
    return true;
  }

  function showConflict(payload) {
    conflictHunks.value = payload.conflicts || [];
    conflict.value = {
      id: payload.conflictId || null,
      baseContent: payload.baseContent || "",
      mineContent: payload.mineContent || "",
      theirsContent: payload.theirsContent || "",
      updatedAt: payload.at,
      mergeAttempts: 1,
    };
    lastError.value = "This version conflicts with an edit made outside the session.";
  }

  function installState(payload) {
    if (!payload?.sessionId || !payload?.update) return;
    if (sessionId.value && payload.sessionId !== sessionId.value) {
      // The session this tab was in has been saved and closed while it was
      // away, and this is a new one started from the saved Document. Updates
      // made against the old one mean nothing in it.
      if (pending.size || bufferedUpdates.length) {
        send("collab:leave", { sessionId: payload.sessionId });
        clearTimeout(reconnectTimer);
        status.value = "dropped";
        lastError.value = "The live session ended while this device was disconnected. What you typed since is still here to copy.";
        return;
      }
      resetDocument();
    }
    if (!ydoc.value) {
      ydoc.value = markRaw(new Y.Doc());
      observeLocalUpdates(ydoc.value);
    }
    Y.applyUpdate(ydoc.value, decode(payload.update), "server-state");
    sessionId.value = payload.sessionId;
    participants.value = payload.participants || [];
    status.value = "live";
    lastError.value = null;
    clearTimeout(reconnectTimer);
    const acknowledged = Number(payload.ack) || 0;
    for (const seq of [...pending.keys()]) if (seq <= acknowledged) pending.delete(seq);
    if (pending.size) resendPending();
    else nextSeq = acknowledged + 1;
    setPendingCount();
    if (payload.conflict) showConflict(payload.conflict);
  }

  function acknowledge(seq) {
    for (const key of [...pending.keys()]) if (key <= Number(seq)) pending.delete(key);
    setPendingCount();
  }

  async function finishSession(reason) {
    const targetDbKey = dbKey.value;
    reset();
    if (reason === "revoked") {
      useUiStore().addToast("Your access to this live session ended.", "warning");
      return;
    }
    if (targetDbKey) {
      await syncStore.sync(targetDbKey);
      await useDocStore().refreshData();
    }
  }

  function handleMessage(message) {
    if (message.type === "socket:close" && ["opening", "live", "committing"].includes(status.value)) {
      status.value = "reconnecting";
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        status.value = "dropped";
        lastError.value = "The live session could not reconnect. Your text remains available to copy.";
      }, RECONNECT_TIMEOUT_MS);
      return;
    }
    if (message.type === "socket:open" && status.value === "reconnecting" && dbKey.value && noteId.value) {
      const space = dbKey.value.slice("space:".length);
      openRequestId = send("collab:open", { space, noteId: noteId.value, clientId });
      return;
    }
    if (!message.type?.startsWith("collab:")) return;

    // The answer to a request to join. Only the answer to the request that is
    // still wanted may open a session: the user may have left, or selected
    // another Document, before it arrived, and the session then bound itself
    // to whatever was on screen.
    const answersOpen = message.type === "collab:state" || (message.type === "collab:open" && message.ok === false);
    if (answersOpen) {
      if (message.requestId && cancelledOpens.delete(message.requestId)) {
        if (message.ok !== false && message.payload?.sessionId) {
          send("collab:leave", { sessionId: message.payload.sessionId });
        }
        return;
      }
      if (!openRequestId || message.requestId !== openRequestId) return;
      openRequestId = null;
    }

    if (message.ok === false) {
      const code = message.error?.code;
      if (message.type === "collab:open") {
        lastError.value = message.error?.message || "The live session request failed.";
        status.value = "idle";
        return;
      }
      // Refusals that mean "not now": the update is kept and sent again.
      if (message.type === "collab:update" && (code === "RATE_LIMIT" || code === "SESSION_BUSY")) {
        scheduleResend();
        return;
      }
      if (message.type === "collab:commit") {
        if (status.value === "committing") status.value = "live";
        lastError.value = code === "SESSION_BUSY"
          ? "A save is already in progress."
          : "The version could not be saved. Your text is still in the session; try again.";
        return;
      }
      if (message.type === "collab:resolve") {
        if (code === "CONFLICT_RESOLVED") {
          conflict.value = null;
          conflictHunks.value = [];
          lastError.value = null;
        } else {
          lastError.value = message.error?.message || "The conflict could not be resolved.";
        }
        return;
      }
      lastError.value = message.error?.message || "The live session request failed.";
      status.value = "dropped";
      return;
    }
    const payload = message.payload || {};
    if (message.type === "collab:state") {
      installState(payload);
      return;
    }
    if (payload.sessionId && sessionId.value && payload.sessionId !== sessionId.value) return;
    switch (message.type) {
      case "collab:update":
        if (ydoc.value && payload.update) Y.applyUpdate(ydoc.value, decode(payload.update), "remote");
        break;
      case "collab:ack": acknowledge(payload.seq); break;
      case "collab:participants": participants.value = payload.participants || []; break;
      case "collab:awareness": {
        const member = participants.value.find((participant) => participant.id === payload.from);
        if (member) member.idle = Boolean(payload.idle);
        participants.value = [...participants.value];
        break;
      }
      case "collab:committing": status.value = "committing"; break;
      case "collab:commit-failed":
        // Someone's save did not go through; everyone was told it had started.
        if (status.value === "committing") status.value = "live";
        resendPending();
        break;
      case "collab:committed":
        status.value = "live";
        // Updates the server refused while it was saving go out again now.
        resendPending();
        if (payload.result === "conflict") {
          showConflict(payload);
        } else {
          conflictHunks.value = [];
          conflict.value = null;
          lastError.value = null;
          useUiStore().addToast(`${payload.by?.name || "A member"} saved a document version.`, "success");
        }
        break;
      case "collab:conflict-resolved":
        conflictHunks.value = [];
        conflict.value = null;
        lastError.value = null;
        useUiStore().addToast(`${payload.by?.name || "A member"} resolved the conflict. Save the version when ready.`, "success");
        break;
      case "collab:closed": void finishSession(payload.reason); break;
      default: break;
    }
  }

  function start() {
    if (!removeSocketListener) removeSocketListener = syncStore.addWebSocketListener(handleMessage);
    syncStore.setCollabRemoteGuard((candidateDbKey, candidateNoteId) => (
      isActive.value && candidateDbKey === dbKey.value && candidateNoteId === noteId.value
    ));
  }

  function saveVersion() {
    flushUpdates();
    if (!sessionId.value || pending.size) {
      lastError.value = "Waiting for your latest changes to be stored before saving a version.";
      return false;
    }
    status.value = "committing";
    send("collab:commit", { sessionId: sessionId.value });
    return true;
  }

  function leave() {
    if (sessionId.value) send("collab:leave", { sessionId: sessionId.value });
    // Not joined yet: there is no session to leave, but an answer is on its
    // way and must not be taken up when it arrives.
    else if (openRequestId) cancelledOpens.add(openRequestId);
    reset();
  }

  function sendAwareness({ cursor, selection, idle = false } = {}) {
    const now = Date.now();
    if (!sessionId.value || now - lastAwarenessAt < 100) return;
    lastAwarenessAt = now;
    send("collab:awareness", { sessionId: sessionId.value, cursor, selection, idle });
  }

  /**
   * Send this participant's answer to a save conflict. The server applies it,
   * once, for everyone, and the change comes back as an ordinary update. It
   * used to be applied here by replacing the whole text, which deleted what
   * others had typed since and doubled the Document when two answered at once.
   */
  function resolveConflict(content) {
    if (!sessionId.value || !conflict.value?.id || status.value === "dropped") return false;
    flushUpdates();
    return Boolean(send("collab:resolve", {
      sessionId: sessionId.value,
      conflictId: conflict.value.id,
      content: content ?? "",
    }));
  }

  function destroy() {
    leave();
    removeSocketListener?.();
    removeSocketListener = null;
    syncStore.setCollabRemoteGuard(null);
  }

  start();
  return {
    status, sessionId, dbKey, noteId, participants, lastError, conflictHunks, conflict,
    ydoc, localOrigin, isActive, isEditable, unackedCount,
    open, saveVersion, leave, destroy, handleMessage, resolveConflict, sendAwareness,
  };
});
