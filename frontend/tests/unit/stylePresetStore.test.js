import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";

/**
 * A tiny in-memory stand-in for the two style tables, enough to check what
 * the store writes and that it reads back what it wrote.
 */
function createFakeDb() {
  const presets = new Map();
  const assignments = new Map();
  const statements = [];

  async function exec(sql, params = []) {
    statements.push({ sql, params });
    if (sql.startsWith("INSERT INTO style_presets")) {
      const [id, kind, name, styles, createdAt, updatedAt] = params;
      presets.set(id, { id, kind, name, styles, created_at: createdAt, updated_at: updatedAt });
    } else if (sql.startsWith("UPDATE style_presets SET styles")) {
      const [styles, updatedAt, id] = params;
      Object.assign(presets.get(id), { styles, updated_at: updatedAt });
    } else if (sql.startsWith("UPDATE style_presets SET name")) {
      const [name, updatedAt, id] = params;
      Object.assign(presets.get(id), { name, updated_at: updatedAt });
    } else if (sql.startsWith("DELETE FROM style_presets")) {
      presets.delete(params[0]);
    } else if (sql.startsWith("UPDATE style_assignments SET preset_id = NULL")) {
      for (const row of assignments.values()) if (row.preset_id === params[1]) row.preset_id = null;
    } else if (sql.trim().startsWith("INSERT INTO style_assignments")) {
      const [id, targetType, targetId, kind, presetId] = params;
      assignments.set(id, { id, target_type: targetType, target_id: targetId, kind, preset_id: presetId });
    } else {
      throw new Error(`Unexpected statement: ${sql}`);
    }
  }

  async function execute(sql) {
    if (sql.includes("FROM style_presets")) {
      return [...presets.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sql.includes("FROM style_assignments")) return [...assignments.values()];
    throw new Error(`Unexpected query: ${sql}`);
  }

  const repo = {
    exec,
    execute,
    async transaction(work) {
      return work({ exec, execute });
    },
  };
  return { repo, presets, assignments, statements };
}

const harness = vi.hoisted(() => ({
  db: null,
  addToast: () => {},
  structure: null,
  markdown: null,
}));

vi.mock("@/store/syncStore", () => ({
  useSyncStore: () => ({
    isInitialized: false,
    databases: new Map([["user:1", {}]]),
    repository: () => harness.db.repo,
  }),
}));
vi.mock("@/store/structureStore", () => ({ useStructureStore: () => harness.structure }));
vi.mock("@/store/markdownStore", () => ({ useMarkdownStore: () => harness.markdown }));
vi.mock("@/store/uiStore", () => ({ useUiStore: () => ({ addToast: (...a) => harness.addToast(...a) }) }));

const { useStylePresetStore } = await import("../../src/store/stylePresetStore");

const DB = "user:1";

beforeEach(() => {
  harness.db = createFakeDb();
  harness.addToast = vi.fn();
  harness.structure = reactive({
    selectedDbKey: DB,
    selectedFile: null,
    rootItems: [],
    getFolderTrail: vi.fn(async () => []),
  });
  harness.markdown = reactive({
    styles: { h1: "global-preview" },
    printStyles: { h1: "global-print" },
  });
  setActivePinia(createPinia());
});

describe("stylePresetStore", () => {
  it("creates a named style from the current values and lists it by kind", async () => {
    const store = useStylePresetStore();
    const preset = await store.createPreset(DB, "print", "  Report  ", { h1: "color: red;" });

    expect(preset.name).toBe("Report");
    expect(preset.kind).toBe("print");
    expect(preset.values.h1).toBe("color: red;");
    expect(preset.values.pageMargin).toBeDefined();
    expect(store.presetsFor(DB, "print")).toHaveLength(1);
    expect(store.presetsFor(DB, "preview")).toHaveLength(0);
  });

  it("refuses a duplicate name of the same kind but allows it for the other kind", async () => {
    const store = useStylePresetStore();
    await store.createPreset(DB, "print", "Report", {});
    await expect(store.createPreset(DB, "print", "report", {})).rejects.toThrow(/exists/);
    await expect(store.createPreset(DB, "preview", "Report", {})).resolves.toBeTruthy();
  });

  it("renames, refusing a name another style has", async () => {
    const store = useStylePresetStore();
    const a = await store.createPreset(DB, "print", "A", {});
    await store.createPreset(DB, "print", "B", {});
    await expect(store.renamePreset(DB, a.id, "b")).rejects.toThrow(/exists/);
    await store.renamePreset(DB, a.id, "Letter");
    expect(store.findPreset(DB, a.id).name).toBe("Letter");
  });

  it("updates values in memory and in the database", async () => {
    const store = useStylePresetStore();
    const p = await store.createPreset(DB, "preview", "Manual", {});
    await store.updatePresetValues(DB, p.id, { ...p.values, p: "line-height: 2;" });
    expect(store.findPreset(DB, p.id).values.p).toBe("line-height: 2;");
    expect(JSON.parse(harness.db.presets.get(p.id).styles).p).toBe("line-height: 2;");
  });

  it("deleting a style clears the defaults that pointed at it, in one transaction", async () => {
    const store = useStylePresetStore();
    const p = await store.createPreset(DB, "print", "Report", {});
    await store.setAssignment(DB, "folder", "f1", "print", p.id);
    expect(store.assignmentFor(DB, "folder", "f1", "print")).toBe(p.id);

    await store.deletePreset(DB, p.id);
    expect(store.presetsFor(DB)).toHaveLength(0);
    expect(harness.db.assignments.get("folder:f1:print").preset_id).toBeNull();
    expect(store.assignmentFor(DB, "folder", "f1", "print")).toBeNull();
  });

  it("writes one assignment row per target and kind, and clears with null", async () => {
    const store = useStylePresetStore();
    const p = await store.createPreset(DB, "print", "Report", {});
    await store.setAssignment(DB, "folder", "f1", "print", p.id);
    await store.setAssignment(DB, "folder", "f1", "print", null);
    expect(harness.db.assignments.size).toBe(1);
    expect(store.assignmentFor(DB, "folder", "f1", "print")).toBeNull();
  });

  it("gives a template's defaults as front matter", async () => {
    const store = useStylePresetStore();
    const print = await store.createPreset(DB, "print", "Invoice", {});
    const preview = await store.createPreset(DB, "preview", "Manual", {});
    await store.setAssignment(DB, "template", "t1", "print", print.id);
    await store.setAssignment(DB, "template", "t1", "preview", preview.id);
    expect(store.templateFrontMatter(DB, "t1")).toEqual({
      "preview-style": "Manual",
      "print-style": "Invoice",
    });
    expect(store.templateFrontMatter(DB, "t2")).toEqual({});
  });

  it("resolves front matter, then the folder trail, then the library Default", async () => {
    const store = useStylePresetStore();
    const report = await store.createPreset(DB, "print", "Report", { h1: "report" });
    const invoice = await store.createPreset(DB, "print", "Invoice", { h1: "invoice" });
    await store.setAssignment(DB, "folder", "parent", "print", report.id);

    const inFolder = store.resolve("print", { dbKey: DB, content: "# x", folderTrail: ["child", "parent"] });
    expect(inFolder.source).toBe("folder");
    expect(inFolder.values.h1).toBe("report");

    const own = store.resolve("print", {
      dbKey: DB, content: "---\nprint-style: Invoice\n---\n# x", folderTrail: ["child", "parent"],
    });
    expect(own.preset.id).toBe(invoice.id);

    const none = store.resolve("print", { dbKey: DB, content: "# x", folderTrail: [] });
    expect(none.source).toBe("default");
    expect(none.values.h1).toBe("global-print");
    expect(store.resolve("preview", { dbKey: DB, content: "" }).values.h1).toBe("global-preview");
  });

  it("follows the selected Document's folder trail, nearest folder first", async () => {
    harness.structure.getFolderTrail = vi.fn(async () => [{ id: "root" }, { id: "parent" }, { id: "child" }]);
    harness.structure.selectedFile = { id: "n1", folder_id: "child", content: "" };
    const store = useStylePresetStore();
    await store.refreshSelectedTrail();
    expect(harness.structure.getFolderTrail).toHaveBeenCalledWith("child", DB);
    expect(store.selectedFolderTrail).toEqual(["child", "parent", "root"]);
  });

  it("drops libraries that are no longer registered when reloading", async () => {
    const store = useStylePresetStore();
    await store.loadLibrary(DB);
    store.libraries.set("space:gone", { presets: [], assignments: new Map() });
    await store.reloadLoaded();
    expect([...store.libraries.keys()]).toEqual([DB]);
  });

  it("parameterizes every write", async () => {
    const store = useStylePresetStore();
    const p = await store.createPreset(DB, "print", "Robert'); DROP TABLE notes;--", {});
    await store.renamePreset(DB, p.id, "x\"y");
    for (const { sql } of harness.db.statements) {
      expect(sql).not.toContain("DROP TABLE");
      expect(sql).not.toContain('x"y');
    }
  });
});
