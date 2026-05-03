import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const subMenuBarSource = readFileSync(
  new URL("../../src/components/SubMenuBar.vue", import.meta.url),
  "utf8",
);

describe("SubMenuBar tools menu", () => {
  it("groups the document-dependent tools at the beginning of the Tools menu", () => {
    expect(subMenuBarSource).toMatch(
      /v-else-if="ui\.showFileMenu"[\s\S]*?data-testid="submenu-tools-dictate"[\s\S]*?data-testid="submenu-tools-revisions"[\s\S]*?data-testid="submenu-tools-print"[\s\S]*?<div class="separator"><\/div>[\s\S]*?data-testid="submenu-tools-import"/,
    );
  });

  it("uses the shared BaseButton styling for the Tools menu dictate action", () => {
    expect(subMenuBarSource).toMatch(
      /v-else-if="ui\.showFileMenu"[\s\S]*?<BaseButton[\s\S]*?data-testid="submenu-tools-dictate"/,
    );
  });

  it("no longer renders Dictate in the Editor submenu", () => {
    expect(subMenuBarSource).not.toContain(
      'data-testid="submenu-editor-dictate"',
    );
  });

  it("has a Templates button with data-testid submenu-tools-templates", () => {
    expect(subMenuBarSource).toMatch(/data-testid="submenu-tools-templates"/);
  });

  it("Templates button appears after Images and before Variables", () => {
    expect(subMenuBarSource).toMatch(
      /data-testid="submenu-tools-images"[\s\S]*?data-testid="submenu-tools-templates"[\s\S]*?data-testid="submenu-tools-variables"/,
    );
  });

  it("Templates button is not disabled (works offline)", () => {
    expect(subMenuBarSource).not.toMatch(
      /<[^>]*\bdata-testid="submenu-tools-templates"[^>]*\bdisabled\b/,
    );
  });
});
