import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createPinia, setActivePinia } from "pinia";
import {
  classifyEditorConflict,
  hasDocumentContentChanged,
} from "../../src/utils/documentPersistence.js";
import { useDraftStore } from "../../src/store/draftStore.js";

const editorSource = readFileSync(
  new URL("../../src/components/Editor.vue", import.meta.url),
  "utf8",
);

describe("classifyEditorConflict (COLLAB-01 §4.2)", () => {
  it("adopts a remote change when the editor is clean", () => {
    expect(
      classifyEditorConflict({ mine: "# base", base: "# base", theirs: "# remote" }),
    ).toBe("adopt");
  });

  it("ignores a remote change that equals the base (nothing changed remotely)", () => {
    expect(
      classifyEditorConflict({ mine: "# edited", base: "# base", theirs: "# base" }),
    ).toBe("ignore");
  });

  it("reports a conflict when both sides diverged from the base", () => {
    expect(
      classifyEditorConflict({ mine: "# edited", base: "# base", theirs: "# remote" }),
    ).toBe("conflict");
  });

  it("ignores a local save (mine === theirs === new base)", () => {
    expect(
      classifyEditorConflict({ mine: "# saved", base: "# saved", theirs: "# saved" }),
    ).toBe("ignore");
  });

  it("treats legacy null content as an empty string", () => {
    expect(
      classifyEditorConflict({ mine: null, base: null, theirs: "" }),
    ).toBe("ignore");
    expect(
      classifyEditorConflict({ mine: null, base: null, theirs: "changed" }),
    ).toBe("adopt");
  });

  it("treats undefined content as an empty string", () => {
    expect(
      classifyEditorConflict({ mine: undefined, base: undefined, theirs: "changed" }),
    ).toBe("adopt");
  });
});

describe("draftStore base tracking (COLLAB-01 §4.1)", () => {
  it("stores and retrieves a per-document base", () => {
    setActivePinia(createPinia());
    const store = useDraftStore();

    store.setBase("note-1", "# base");
    expect(store.getBase("note-1")).toBe("# base");
    expect(store.getBase("missing")).toBeUndefined();
  });

  it("clears a single base and all bases", () => {
    setActivePinia(createPinia());
    const store = useDraftStore();

    store.setBase("note-1", "# one");
    store.setBase("note-2", "# two");
    store.clearBase("note-1");
    expect(store.getBase("note-1")).toBeUndefined();
    expect(store.getBase("note-2")).toBe("# two");

    store.clearAll();
    expect(store.getBase("note-2")).toBeUndefined();
  });

  it("keeps bases independent from drafts", () => {
    setActivePinia(createPinia());
    const store = useDraftStore();

    store.setDraft("note-1", "# draft");
    store.setBase("note-1", "# base");
    expect(store.getDraft("note-1")).toBe("# draft");
    expect(store.getBase("note-1")).toBe("# base");

    store.clearDraft("note-1");
    expect(store.getDraft("note-1")).toBeUndefined();
    expect(store.getBase("note-1")).toBe("# base");
  });
});

describe("Editor.vue conflict wiring (COLLAB-01)", () => {
  it("renders the conflict banner with the required test ids", () => {
    expect(editorSource).toContain('data-testid="editor-conflict-banner"');
    expect(editorSource).toContain('data-testid="editor-conflict-keep-mine"');
    expect(editorSource).toContain('data-testid="editor-conflict-use-theirs"');
    expect(editorSource).toContain('data-testid="editor-conflict-compare"');
  });

  it("renders a save-status surface", () => {
    expect(editorSource).toContain('data-testid="editor-save-status"');
  });

  it("suppresses the debounced DB write while the editor's own conflict is being decided", () => {
    expect(editorSource).toMatch(
      /if\s*\(conflict\.value\)\s*\{\s*debouncedSyncToDB\.cancel\(\);\s*return;\s*\}/s,
    );
  });

  it("does not hold writes for a stored conflict record", () => {
    // Holding them made everything typed after the banner appeared unsaveable,
    // with no indication, and the resolver then discarded it.
    expect(editorSource).not.toMatch(/if\s*\(conflict\.value\s*\|\|\s*persistedConflict\.value\)/);
  });

  it("saves what was pending when the user leaves a document, instead of dropping it", () => {
    const switchBody = editorSource.slice(
      editorSource.indexOf("function handleDocumentSwitch("),
      editorSource.indexOf("watch(", editorSource.indexOf("function handleDocumentSwitch(")),
    );
    expect(switchBody).toContain("debouncedSyncToDB.flush()");
    expect(switchBody).not.toContain("debouncedSyncToDB.cancel()");
    expect(editorSource).toMatch(/onUnmounted\(\(\) => \{[^}]*debouncedSyncToDB\.flush\(\)/s);
  });

  it("saves to the document and database the save was scheduled for", () => {
    expect(editorSource).toContain("pendingSave = { id, text, dbKey: file.value?.dbKey }");
    expect(editorSource).toContain("docStore.updateFileContent(save.id, save.text, save.dbKey)");
  });

  it("does not take keyboard focus when a remote change is adopted", () => {
    expect(editorSource).toContain("const hadFocus = document.activeElement === getTextareaElement();");
    expect(editorSource).toContain("if (hadFocus) ta.focus();");
  });

  it("makes the Document read-only while a stored conflict is unresolved", () => {
    // The record can hold one body that exists nowhere else. Editing on would
    // create a third version, so the pause is what keeps resolving lossless.
    expect(editorSource).toMatch(
      /const editingPaused = computed\(\(\) => Boolean\(\s*file\.value\?\.id && conflictStore\.hasConflict\(file\.value\.id, file\.value\.dbKey\),\s*\)\);/s,
    );
    expect(editorSource).toContain("if (textarea) textarea.readOnly = editingPaused.value;");
    expect(editorSource).toContain("watch(editingPaused, applyEditingPaused);");
    // A re-created editor (theme change, reopened Document) starts paused too.
    const initBody = editorSource.slice(editorSource.indexOf("function initEditor()"), editorSource.indexOf("function getEditorTheme("));
    expect(initBody).toContain("applyEditingPaused();");
    expect(editorSource).toContain('data-testid="editor-conflict-paused"');
  });

  it("blocks edits that do not come from the keyboard while paused", () => {
    const guarded = (name, endMarker) => editorSource.slice(
      editorSource.indexOf(`function ${name}(`),
      editorSource.indexOf(endMarker, editorSource.indexOf(`function ${name}(`)),
    );
    expect(guarded("insertAtCursor", "const start")).toContain("editingBlocked()");
    expect(guarded("insertFormat", "const start")).toContain("editingBlocked()");
    expect(guarded("replaceNext", "textarea.value = newText")).toContain("editingBlocked()");
    expect(guarded("replaceAll", "textarea.value = newText")).toContain("editingBlocked()");
    expect(guarded("performUndo", "historyStore.undo")).toContain("editingBlocked()");
    expect(guarded("performRedo", "historyStore.redo")).toContain("editingBlocked()");
    expect(guarded("uploadImage", "isUploading.value = true")).toContain("editingBlocked()");
    expect(guarded("wrapWithRecord", "historyStore.record")).toContain("editingBlocked()");
  });

  it("puts text typed before the pause into the conflict instead of leaving it out", () => {
    const settle = editorSource.slice(
      editorSource.indexOf("async function settleUnsavedText("),
      editorSource.indexOf("async function openResolution("),
    );
    // Held against a remote change: it is this device's side of the conflict.
    expect(settle).toMatch(/if \(conflict\.value\) \{\s*await conflictStore\.holdUnsavedText\(noteId, dbKey, contentDraft\.value\);/s);
    // Otherwise it is saved, and the record follows the save.
    expect(settle).toContain("await debouncedSyncToDB.flush();");
    expect(settle).toContain("await reloadPersistedConflict(noteId);");

    const open = editorSource.slice(
      editorSource.indexOf("async function openResolution("),
      editorSource.indexOf("function bindLiveEditor("),
    );
    expect(open.indexOf("await settleUnsavedText(id)")).toBeGreaterThan(-1);
    expect(open.indexOf("await settleUnsavedText(id)")).toBeLessThan(open.indexOf("showResolution.value = true"));
    expect(editorSource).toContain('@click="openResolution"');
  });

  it("saves, rather than drops, anything still pending when a resolution is applied", () => {
    const applyBody = editorSource.slice(
      editorSource.indexOf("async function applyPersistedResolution("),
      editorSource.indexOf("ui.addToast('Document changes resolved.'"),
    );
    expect(applyBody).not.toContain("debouncedSyncToDB.cancel()");
    expect(applyBody.indexOf("await debouncedSyncToDB.flush()"))
      .toBeLessThan(applyBody.indexOf("await conflictStore.resolveConflict("));
  });

  it("ends the in-editor conflict when a stored conflict is resolved", () => {
    const applyBody = editorSource.slice(
      editorSource.indexOf("async function applyPersistedResolution("),
      editorSource.indexOf("ui.addToast('Document changes resolved.'"),
    );
    expect(applyBody).toContain("clearConflict();");
  });

  it("watches both document id and content, not id alone", () => {
    expect(editorSource).toMatch(
      /\(\)\s*=>\s*\[file\.value\?\.id,\s*file\.value\?\.content\]/,
    );
  });

  it("preserves the cursor on programmatic adoption", () => {
    expect(editorSource).toMatch(/setSelectionRange\(start,\s*end\)/);
    expect(editorSource).toMatch(/Math\.min\(selStart,\s*length\)/);
  });

  it("uses the shared conflict classifier", () => {
    expect(editorSource).toMatch(
      /classifyEditorConflict\(\{\s*mine,\s*base,\s*theirs\s*\}\)/,
    );
  });

  it("wires persisted conflict resolution through the shared banner", () => {
    expect(editorSource).toContain('data-testid="editor-conflict-resolve"');
    expect(editorSource).toContain('<ConflictResolutionModal');
    expect(editorSource).toContain('@apply="applyPersistedResolution"');
    expect(editorSource).toContain('conflictStore.resolveConflict(activeConflict, content)');
  });

  it("adopts a persisted resolution only after the transaction succeeds", () => {
    const applyStart = editorSource.indexOf('async function applyPersistedResolution');
    const applyEnd = editorSource.indexOf('/* ───── paste-images', applyStart);
    const applySource = editorSource.slice(applyStart, applyEnd);
    expect(applySource.indexOf('await conflictStore.resolveConflict')).toBeLessThan(
      applySource.indexOf('setEditorValue(content'),
    );
    expect(applySource).toContain('draftStore.setBase(id, content)');
  });
});

describe("hasDocumentContentChanged remains a comparison primitive", () => {
  it("still normalizes null to empty string", () => {
    expect(hasDocumentContentChanged(null, "")).toBe(false);
    expect(hasDocumentContentChanged("# a", "# a")).toBe(false);
    expect(hasDocumentContentChanged("# a", "# b")).toBe(true);
  });
});
