import { describe, it, expect } from "vitest";
import {
  assignmentId,
  normalizeStyleName,
  parseStyleValues,
  readDocumentStyleNames,
  resolveStylePreset,
  serializeStyleValues,
  styleNameError,
  MAX_STYLE_NAME_LENGTH,
} from "../../src/utils/stylePresets";
import {
  parseFrontMatter,
  setFrontMatterValues,
  unquoteValue,
} from "../../src/utils/frontMatter";
import {
  DEFAULT_PREVIEW_STYLES,
  DEFAULT_PRINT_STYLES,
  buildPrintCss,
} from "../../src/utils/styleDefaults";

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------
describe("styleNameError", () => {
  const existing = [
    { id: "a", name: "Report" },
    { id: "b", name: "Formal  letter" },
  ];

  it("accepts a new name", () => {
    expect(styleNameError("Invoice", existing)).toBeNull();
  });

  it("refuses an empty or blank name", () => {
    expect(styleNameError("", existing)).toMatch(/name/i);
    expect(styleNameError("   ", existing)).toMatch(/name/i);
  });

  it("refuses a name that differs only by case or spacing", () => {
    expect(styleNameError("report", existing)).toMatch(/exists/);
    expect(styleNameError(" formal letter ", existing)).toMatch(/exists/);
  });

  it("lets a style keep its own name when renamed", () => {
    expect(styleNameError("REPORT", existing, "a")).toBeNull();
  });

  it("refuses an over-long name", () => {
    expect(styleNameError("x".repeat(MAX_STYLE_NAME_LENGTH + 1), [])).toMatch(/characters/);
    expect(styleNameError("x".repeat(MAX_STYLE_NAME_LENGTH), [])).toBeNull();
  });

  it("normalizes inner whitespace", () => {
    expect(normalizeStyleName("  a \t b  ")).toBe("a b");
  });
});

// ---------------------------------------------------------------------------
// Assignment ids
// ---------------------------------------------------------------------------
describe("assignmentId", () => {
  it("is fixed for a target and kind", () => {
    expect(assignmentId("folder", "f1", "print")).toBe("folder:f1:print");
    expect(assignmentId("template", "t1", "preview")).toBe("template:t1:preview");
  });

  it("rejects unknown targets, kinds, and missing ids", () => {
    expect(() => assignmentId("note", "x", "print")).toThrow();
    expect(() => assignmentId("folder", "x", "screen")).toThrow();
    expect(() => assignmentId("folder", "", "print")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Style values
// ---------------------------------------------------------------------------
describe("parseStyleValues", () => {
  it("lays stored values over the defaults for the kind", () => {
    const parsed = parseStyleValues(JSON.stringify({ h1: "color: red;" }), "print");
    expect(parsed.h1).toBe("color: red;");
    expect(parsed.pageMargin).toBe(DEFAULT_PRINT_STYLES.pageMargin);
  });

  it("drops unknown keys and print-only keys from a preview style", () => {
    const parsed = parseStyleValues({ bogus: "x", pageMargin: "1cm" }, "preview");
    expect(parsed).not.toHaveProperty("bogus");
    expect(parsed).not.toHaveProperty("pageMargin");
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(DEFAULT_PREVIEW_STYLES).sort());
  });

  it("coerces enablePageNumbers to a boolean and other values to strings", () => {
    expect(parseStyleValues({ enablePageNumbers: "false" }, "print").enablePageNumbers).toBe(false);
    expect(parseStyleValues({ enablePageNumbers: "true" }, "print").enablePageNumbers).toBe(true);
    expect(parseStyleValues({ headerFontSize: 12 }, "print").headerFontSize).toBe("12");
  });

  it("returns the defaults for unreadable input", () => {
    expect(parseStyleValues("{not json", "preview")).toEqual({ ...DEFAULT_PREVIEW_STYLES });
    expect(parseStyleValues(null, "print")).toEqual({ ...DEFAULT_PRINT_STYLES });
    expect(parseStyleValues("[1,2]", "print")).toEqual({ ...DEFAULT_PRINT_STYLES });
  });

  it("refuses to serialize oversized styles", () => {
    expect(() => serializeStyleValues({ customCSS: "x".repeat(300 * 1024) }, "preview")).toThrow(/too large/);
    expect(JSON.parse(serializeStyleValues({ h1: "a" }, "preview")).h1).toBe("a");
  });
});

describe("buildPrintCss", () => {
  it("puts element rules before custom CSS and leaves out header settings", () => {
    const css = buildPrintCss({ h1: "color: red;", customCSS: "h1 { color: blue; }", printHeaderHtml: "<b>x</b>" });
    expect(css.indexOf("h1 { color: red; }")).toBeLessThan(css.indexOf("h1 { color: blue; }"));
    expect(css).not.toContain("printHeaderHtml");
  });
});

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------
describe("front matter", () => {
  it("reads style names case-insensitively and without quotes", () => {
    const doc = `---\nPrint-Style: "Invoice"\npreview-style: 'Manual'\n---\n# Body`;
    expect(readDocumentStyleNames(doc)).toEqual({ preview: "Manual", print: "Invoice" });
  });

  it("reads nothing from a Document without front matter", () => {
    expect(readDocumentStyleNames("# Just a heading")).toEqual({ preview: "", print: "" });
  });

  it("unquotes only matching quotes", () => {
    expect(unquoteValue('"a"')).toBe("a");
    expect(unquoteValue("'a\"")).toBe("'a\"");
  });

  it("adds a block to a Document without one", () => {
    const out = setFrontMatterValues("# Hello", { "print-style": "Report" });
    expect(out).toBe("---\nprint-style: Report\n---\n\n# Hello");
    expect(parseFrontMatter(out).body.trim()).toBe("# Hello");
  });

  it("replaces an existing key and keeps the rest of the block", () => {
    const doc = "---\ntitle: X\nPRINT-STYLE: Old\n---\nBody";
    const out = setFrontMatterValues(doc, { "print-style": "New", "preview-style": "Manual" });
    expect(out).toBe("---\ntitle: X\nprint-style: New\npreview-style: Manual\n---\nBody");
  });

  it("skips empty values and leaves the Document alone when nothing is set", () => {
    expect(setFrontMatterValues("Body", { "print-style": "", "preview-style": null })).toBe("Body");
  });

  it("keeps Windows line endings", () => {
    const out = setFrontMatterValues("---\r\ntitle: X\r\n---\r\nBody", { "print-style": "A" });
    expect(out).toBe("---\r\ntitle: X\r\nprint-style: A\r\n---\r\nBody");
  });

  it("treats an unclosed block as no block", () => {
    const out = setFrontMatterValues("---\ntitle: X", { "print-style": "A" });
    expect(out.startsWith("---\nprint-style: A\n---\n\n---\ntitle: X")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------
describe("resolveStylePreset", () => {
  const presets = [
    { id: "p1", kind: "print", name: "Report" },
    { id: "p2", kind: "print", name: "Invoice" },
    { id: "v1", kind: "preview", name: "Report" },
  ];
  const assignments = new Map([
    ["folder:child:print", null],
    ["folder:parent:print", "p1"],
    ["folder:root:print", "p2"],
    ["folder:gone:print", "deleted-style"],
  ]);

  it("uses the Document's own choice first", () => {
    const r = resolveStylePreset({
      kind: "print", documentStyleName: "invoice", folderTrail: ["parent"], presets, assignments,
    });
    expect(r).toEqual({ preset: presets[1], source: "document" });
  });

  it("uses the nearest folder with a default, skipping cleared ones", () => {
    const r = resolveStylePreset({ kind: "print", folderTrail: ["child", "parent", "root"], presets, assignments });
    expect(r).toEqual({ preset: presets[0], source: "folder", folderId: "parent" });
  });

  it("skips a front matter name or folder default that points at a missing style", () => {
    const r = resolveStylePreset({
      kind: "print", documentStyleName: "Nope", folderTrail: ["gone", "root"], presets, assignments,
    });
    expect(r.preset).toBe(presets[1]);
    expect(r.source).toBe("folder");
  });

  it("only matches styles of the requested kind", () => {
    const r = resolveStylePreset({ kind: "preview", documentStyleName: "Report", presets, assignments });
    expect(r.preset).toBe(presets[2]);
    const none = resolveStylePreset({ kind: "preview", folderTrail: ["parent"], presets, assignments });
    expect(none).toEqual({ preset: null, source: "default" });
  });
});
