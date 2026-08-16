import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hasDocumentContentChanged } from "../../src/utils/documentPersistence.js";

describe("hasDocumentContentChanged", () => {
  it("does not treat editor initialization with persisted content as a change", () => {
    expect(hasDocumentContentChanged("# Existing note", "# Existing note")).toBe(
      false,
    );
  });

  it("treats legacy null content and the editor empty string as unchanged", () => {
    expect(hasDocumentContentChanged(null, "")).toBe(false);
  });

  it("detects actual edits", () => {
    expect(hasDocumentContentChanged("# Existing note", "# Updated note")).toBe(
      true,
    );
  });
});

describe("Editor document persistence", () => {
  const source = readFileSync(
    new URL("../../src/components/Editor.vue", import.meta.url),
    "utf8",
  );

  it("does not schedule a save for unchanged editor values", () => {
    expect(source).toMatch(
      /if\s*\(hasDocumentContentChanged\(file\.value\.content,\s*value\)\)\s*\{\s*debouncedSyncToDB\(file\.value\.id,\s*value\);\s*\}\s*else\s*\{\s*debouncedSyncToDB\.cancel\(\);/s,
    );
  });
});
