// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";

const harness = vi.hoisted(() => ({ store: null, addToast: null, loadRootItems: null }));

vi.mock("@/store/spaceTransferStore", () => ({ useSpaceTransferStore: () => harness.store }));
vi.mock("@/store/structureStore", () => ({
  useStructureStore: () => ({ loadRootItems: harness.loadRootItems }),
}));
vi.mock("@/store/syncStore", () => ({ useSyncStore: () => ({ sharedSpacesAvailable: true }) }));
vi.mock("@/store/uiStore", () => ({ useUiStore: () => ({ addToast: harness.addToast }) }));

const DocumentTransferPanel = (await import("@/components/DocumentTransferPanel.vue")).default;

const global = {
  stubs: {
    BaseButton: {
      emits: ["click"],
      template: "<button v-bind='$attrs' @click=\"$emit('click', $event)\"><slot /></button>",
    },
    BaseModal: {
      props: ["show", "title", "subtitle"],
      template: "<div v-if='show' data-testid='modal'><h2>{{ title }}</h2><slot /><slot name='footer' /></div>",
    },
  },
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const pendingMove = {
  documentName: "Plan",
  sourceName: "My Documents",
  destinationName: "Writers",
  sourceNoteId: "note",
};

beforeEach(() => {
  harness.addToast = vi.fn();
  harness.loadRootItems = vi.fn(async () => {});
  harness.store = reactive({
    pending: null,
    recoverable: [],
    working: false,
    workingMode: null,
    error: "",
    loadRecoverable: vi.fn(async () => []),
    cancel: vi.fn(),
    confirm: vi.fn(async (mode) => ({ id: "t", mode, warnings: [] })),
    retry: vi.fn(async () => ({})),
    keepBoth: vi.fn(async () => ({})),
    deleteSource: vi.fn(async () => ({})),
    abandon: vi.fn(async () => ({})),
  });
});

describe("DocumentTransferPanel: copy or move", () => {
  it("asks which, and says what each does to the original and its revision history", () => {
    harness.store.pending = { ...pendingMove };
    const wrapper = mount(DocumentTransferPanel, { global });

    expect(wrapper.text()).toContain("Copy or move?");
    const copy = wrapper.get("[data-testid='document-transfer-copy-explanation']").text();
    expect(copy).toContain("The original stays in My Documents with its revision history");
    expect(copy).toContain("Writers gets a copy that starts a new history");
    const move = wrapper.get("[data-testid='document-transfer-move-explanation']").text();
    expect(move).toContain("The original is deleted from My Documents");
    expect(move).toContain("revision history is deleted with it and cannot be recovered");
    // Nothing is chosen for the user.
    expect(harness.store.confirm).not.toHaveBeenCalled();
  });

  it("copies when Copy is chosen and says the original is unchanged", async () => {
    harness.store.pending = { ...pendingMove };
    const wrapper = mount(DocumentTransferPanel, { global });

    await wrapper.get("[data-testid='document-transfer-copy']").trigger("click");
    await settle();

    expect(harness.store.confirm).toHaveBeenCalledTimes(1);
    expect(harness.store.confirm).toHaveBeenCalledWith("copy");
    expect(harness.loadRootItems).toHaveBeenCalled();
    expect(harness.addToast).toHaveBeenCalledWith("Document copied. The original is unchanged.", "success");
  });

  it("moves when Move is chosen", async () => {
    harness.store.pending = { ...pendingMove };
    const wrapper = mount(DocumentTransferPanel, { global });

    await wrapper.get("[data-testid='document-transfer-move']").trigger("click");
    await settle();

    expect(harness.store.confirm).toHaveBeenCalledWith("move");
    expect(harness.addToast).toHaveBeenCalledWith("Document moved.", "success");
  });

  it("reports image warnings for either choice", async () => {
    harness.store.pending = { ...pendingMove };
    harness.store.confirm = vi.fn(async (mode) => ({ id: "t", mode, warnings: [{ imageId: "a" }, { imageId: "b" }] }));
    const wrapper = mount(DocumentTransferPanel, { global });

    await wrapper.get("[data-testid='document-transfer-copy']").trigger("click");
    await settle();
    expect(harness.addToast).toHaveBeenLastCalledWith(
      "Document copied with 2 image warnings. The original is unchanged.",
      "warning",
    );

    await wrapper.get("[data-testid='document-transfer-move']").trigger("click");
    await settle();
    expect(harness.addToast).toHaveBeenLastCalledWith("Document moved with 2 image warnings.", "warning");
  });

  it("shows which action is running and keeps the other from being started", async () => {
    harness.store.pending = { ...pendingMove };
    const wrapper = mount(DocumentTransferPanel, { global });
    harness.store.working = true;
    harness.store.workingMode = "copy";
    await settle();

    expect(wrapper.get("[data-testid='document-transfer-copy']").text()).toBe("Copying…");
    expect(wrapper.get("[data-testid='document-transfer-move']").text()).toBe("Move");
    expect(wrapper.get("[data-testid='document-transfer-move']").attributes("disabled")).toBeDefined();
    expect(wrapper.get("[data-testid='document-transfer-copy']").attributes("disabled")).toBeDefined();
  });

  it("says why nothing happened and claims no success when the request fails", async () => {
    harness.store.pending = { ...pendingMove };
    harness.store.confirm = vi.fn(async () => { throw new Error("You are offline."); });
    const wrapper = mount(DocumentTransferPanel, { global });

    await wrapper.get("[data-testid='document-transfer-copy']").trigger("click");
    await settle();

    expect(harness.addToast).toHaveBeenCalledTimes(1);
    expect(harness.addToast).toHaveBeenCalledWith("You are offline.", "warning");
  });
});

describe("DocumentTransferPanel: an interrupted transfer", () => {
  it("offers to finish or cancel an interrupted copy, and never to delete its original", async () => {
    harness.store.recoverable = [
      { id: "early", mode: "copy", status: "copying_images", warnings: [] },
      { id: "late", mode: "copy", status: "recoverable_duplicate", warnings: [] },
    ];
    const wrapper = mount(DocumentTransferPanel, { global });

    const early = wrapper.get("[data-testid='document-transfer-early']");
    expect(early.text()).toContain("The copy can be resumed safely.");
    expect(early.get("[data-testid='document-transfer-retry']").text()).toBe("Finish copy");
    expect(early.get("[data-testid='document-transfer-cancel']").text()).toBe("Cancel copy");

    const late = wrapper.get("[data-testid='document-transfer-late']");
    expect(late.get("[data-testid='document-transfer-retry']").text()).toBe("Finish copy");
    expect(late.find("[data-testid='document-transfer-delete-source']").exists()).toBe(false);
    expect(late.find("[data-testid='document-transfer-keep-both']").exists()).toBe(false);
    expect(late.find("[data-testid='document-transfer-cancel']").exists()).toBe(false);

    await late.get("[data-testid='document-transfer-retry']").trigger("click");
    await settle();
    expect(harness.store.retry).toHaveBeenCalledWith("late");
    expect(harness.addToast).toHaveBeenCalledWith("Document copied. The original is unchanged.", "success");

    await early.get("[data-testid='document-transfer-cancel']").trigger("click");
    await settle();
    expect(harness.store.abandon).toHaveBeenCalledWith("early");
    expect(harness.addToast).toHaveBeenLastCalledWith("The copy was cancelled. Nothing was changed.", "success");
  });

  it("keeps every recovery action for an interrupted move", async () => {
    harness.store.recoverable = [
      { id: "early", mode: "move", status: "checkpointed", warnings: [] },
      { id: "late", mode: "move", status: "recoverable_duplicate", warnings: [] },
      // Written by a server from before the choice existed: a move.
      { id: "old", status: "destination_confirmed", warnings: [] },
    ];
    const wrapper = mount(DocumentTransferPanel, { global });

    const early = wrapper.get("[data-testid='document-transfer-early']");
    expect(early.get("[data-testid='document-transfer-retry']").text()).toBe("Retry");
    expect(early.get("[data-testid='document-transfer-cancel']").text()).toBe("Cancel move");

    for (const id of ["late", "old"]) {
      const row = wrapper.get(`[data-testid='document-transfer-${id}']`);
      expect(row.find("[data-testid='document-transfer-keep-both']").exists()).toBe(true);
      expect(row.find("[data-testid='document-transfer-delete-source']").exists()).toBe(true);
    }

    await wrapper.get("[data-testid='document-transfer-late'] [data-testid='document-transfer-delete-source']")
      .trigger("click");
    await settle();
    expect(harness.store.deleteSource).toHaveBeenCalledWith("late");
  });
});
