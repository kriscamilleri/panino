import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Covers docs/specs/.../document-templates-extensions.md §11.4 —
// the template editor fields and list columns for the two new columns.
const source = readFileSync(
  new URL("../../src/pages/TemplateManagerPage.vue", import.meta.url),
  "utf8",
);

describe("TemplateManagerPage – editor fields", () => {
  it("renders a Title Pattern input bound to form.titlePattern", () => {
    expect(source).toMatch(
      /<input[^>]*v-model="form\.titlePattern"[\s\S]*?data-testid="template-editor-title-pattern"/,
    );
  });

  it("caps the title pattern at 500 characters and hints the default", () => {
    expect(source).toMatch(
      /v-model="form\.titlePattern"[\s\S]*?maxlength="500"[\s\S]*?placeholder="Defaults to template name"/,
    );
  });

  it("shows help text listing the available variables and format tokens", () => {
    expect(source).toMatch(/today:format/);
    expect(source).toMatch(/now:format/);
    expect(source).toMatch(/input:Label/);
    expect(source).toMatch(/Format tokens:[\s\S]*?yyyy[\s\S]*?ss/);
  });

  it("renders a Default Folder select bound to form.defaultFolderId", () => {
    expect(source).toMatch(
      /<select[^>]*v-model="form\.defaultFolderId"[\s\S]*?data-testid="template-editor-default-folder"/,
    );
  });

  it("populates the folder dropdown from the built folder options", () => {
    expect(source).toMatch(/v-for="opt in folderOptions"/);
    expect(source).toMatch(/structureStore\.getChildren\(item\.id\)/);
  });

  it('offers "— Use current folder —" as the first option with an empty value', () => {
    expect(source).toMatch(
      /folderOptions\s*=\s*ref\(\[\{\s*id:\s*''\s*,\s*name:\s*'— Use current folder —'\s*\}\]\)/,
    );
    expect(source).toMatch(
      /const\s+options\s*=\s*\[\{\s*id:\s*''\s*,\s*name:\s*'— Use current folder —'\s*\}\]/,
    );
  });

  it("offers a clear button that resets the default folder selection", () => {
    expect(source).toMatch(
      /v-if="form\.defaultFolderId"[\s\S]*?@click="form\.defaultFolderId = ''"/,
    );
  });
});

describe("TemplateManagerPage – persistence", () => {
  it("initialises the form with titlePattern and defaultFolderId", () => {
    expect(source).toMatch(
      /const\s+form\s*=\s*reactive\(\{[\s\S]*?titlePattern:\s*''[\s\S]*?defaultFolderId:\s*''[\s\S]*?\}\)/,
    );
  });

  it("passes both new fields to createTemplate when saving a new template", () => {
    expect(source).toMatch(
      /createTemplate\([\s\S]*?form\.content,[\s\S]*?form\.titlePattern\.trim\(\),[\s\S]*?folderId,/,
    );
  });

  it("passes both new fields to updateTemplate when saving an existing template", () => {
    expect(source).toMatch(
      /updateTemplate\([\s\S]*?form\.content,[\s\S]*?form\.titlePattern\.trim\(\),[\s\S]*?folderId,/,
    );
  });

  it("stores an empty folder selection as NULL rather than an empty string", () => {
    expect(source).toMatch(
      /const\s+folderId\s*=\s*form\.defaultFolderId\s*\|\|\s*null/,
    );
  });

  it("pre-fills both fields when editing an existing template", () => {
    expect(source).toMatch(
      /function\s+openEdit\(tpl\)\s*\{[\s\S]*?form\.titlePattern\s*=\s*tpl\.titlePattern\s*\|\|\s*''[\s\S]*?form\.defaultFolderId\s*=\s*tpl\.defaultFolderId\s*\|\|\s*''/,
    );
  });

  it("clears both fields when starting a new template", () => {
    expect(source).toMatch(
      /function\s+openCreate\(\)\s*\{[\s\S]*?form\.titlePattern\s*=\s*''[\s\S]*?form\.defaultFolderId\s*=\s*''/,
    );
  });

  it("counts both new fields as unsaved changes", () => {
    expect(source).toMatch(
      /function\s+hasUnsavedChanges\(\)\s*\{[\s\S]*?form\.titlePattern[\s\S]*?form\.defaultFolderId/,
    );
  });
});

describe("TemplateManagerPage – list view columns", () => {
  it("renders Title Pattern and Folder header cells", () => {
    expect(source).toMatch(
      /<th[^>]*>Name<\/th>[\s\S]*?<th[^>]*>Title Pattern<\/th>[\s\S]*?<th[^>]*>Folder<\/th>/,
    );
  });

  it("shows an em dash when a template has no title pattern", () => {
    expect(source).toMatch(
      /v-if="tpl\.titlePattern"[\s\S]*?<span v-else[^>]*>—<\/span>/,
    );
  });

  it("resolves the default folder to a display path, or an em dash when unset", () => {
    expect(source).toMatch(
      /v-if="tpl\.defaultFolderId"[\s\S]*?getFolderPath\(tpl\.defaultFolderId\)[\s\S]*?<span v-else[^>]*>—<\/span>/,
    );
  });
});
