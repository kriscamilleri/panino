import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("document terminology", () => {
  it("uses Document for creation controls and labels", () => {
    const documentsPane = source("../../src/components/Documents.vue");
    const dashboard = source("../../src/components/DocumentDashboard.vue");
    const treeItem = source("../../src/components/TreeItem.vue");

    expect(documentsPane).toContain('title="New Document"');
    expect(documentsPane).toContain('placeholder="Search documents and folders..."');
    expect(dashboard).toContain('title="Create New Document"');
    expect(dashboard).toContain('label="Document name"');
    expect(treeItem).toContain("<span>New Document</span>");
    expect(treeItem).toContain("(Documents inside matching folder)");
  });

  it("uses Document for user-facing sync, import, and export copy", () => {
    const syncStore = source("../../src/store/syncStore.js");
    const exportModal = source("../../src/components/ExportModal.vue");
    const importModal = source("../../src/components/ImportModal.vue");

    expect(syncStore).toContain("Syncing your documents");
    expect(exportModal).toContain("All your documents");
    expect(importModal).toContain("matching documents");
  });
});
