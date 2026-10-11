// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { YTextareaBinding, contiguousTextEdit } from "@/utils/yTextareaBinding";

const bindings = [];
afterEach(() => {
  while (bindings.length) bindings.pop().destroy();
  document.body.replaceChildren();
});

function bind(ytext, origin) {
  const textarea = document.createElement("textarea");
  textarea.value = ytext.toString();
  document.body.appendChild(textarea);
  const binding = new YTextareaBinding({ textarea, ytext, origin, applyValue: (value) => { textarea.value = value; } });
  bindings.push(binding);
  return { textarea, binding };
}

function input(textarea, value) {
  textarea.value = value;
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
}

describe("production Y.Text textarea binding", () => {
  it("expresses insert, delete, replace, and paste as one contiguous edit", () => {
    const edit = contiguousTextEdit("alpha beta", "alpha brave beta");
    expect(
      `alpha beta`.slice(0, edit.index)
      + edit.insertText
      + `alpha beta`.slice(edit.index + edit.deleteCount),
    ).toBe("alpha brave beta");
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "alpha beta");
    const a = bind(text, { id: "a" });
    const b = bind(text, { id: "b" });
    input(a.textarea, "alpha brave beta");
    expect(b.textarea.value).toBe("alpha brave beta");
    input(a.textarea, "alpha bold beta\na pasted block");
    expect(text.toString()).toBe("alpha bold beta\na pasted block");
  });

  it("preserves a selection under remote edits and defers IME composition", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "hello world");
    const a = bind(text, { id: "a" });
    const b = bind(text, { id: "b" });
    b.textarea.setSelectionRange(6, 11);
    input(a.textarea, "start hello world");
    expect([b.textarea.selectionStart, b.textarea.selectionEnd]).toEqual([12, 17]);
    a.textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    a.textarea.value += "世界";
    a.textarea.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    expect(text.toString()).not.toContain("世界");
    a.textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(text.toString()).toContain("世界");
  });

  it("undoes only transactions from the local origin", () => {
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "root");
    const a = bind(text, { id: "a" });
    const b = bind(text, { id: "b" });
    input(a.textarea, "root-A");
    input(b.textarea, "root-A-B");
    a.binding.undo();
    expect(text.toString()).toBe("root-B");
  });

  /** Two participants, each with their own document, exchanging every update. */
  function pair(initial) {
    const docA = new Y.Doc();
    docA.getText("content").insert(0, initial);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    docA.on("update", (update, origin) => { if (origin !== "net") Y.applyUpdate(docB, update, "net"); });
    docB.on("update", (update, origin) => { if (origin !== "net") Y.applyUpdate(docA, update, "net"); });
    const a = bind(docA.getText("content"), { id: "a" });
    const b = bind(docB.getText("content"), { id: "b" });
    return { a, b, textA: docA.getText("content"), textB: docB.getText("content"), docA, docB };
  }
  const apply = (value, edit) => value.slice(0, edit.index) + edit.insertText + value.slice(edit.index + edit.deleteCount);
  const wellFormed = (value) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value);

  describe("characters made of two code units", () => {
    // Most emoji are a surrogate pair, and emoji of the same range share the
    // first half. A code-unit diff found a "common prefix" ending between the
    // halves, and the edit then removed half of one character and half of the
    // next: the shared text held two broken characters, for everyone.
    it.each([
      ["deleting the first of two emoji", "😀😁", "😁"],
      ["deleting the second of two emoji", "😀😁", "😀"],
      ["typing an emoji before another", "a😁", "a😀😁"],
      ["typing an emoji after another", "😀", "😀😁"],
      ["replacing one emoji with another", "x😀y", "x😁y"],
      ["replacing a flag with another", "🇫🇷", "🇩🇪"],
      ["deleting an emoji between text", "a😀b", "ab"],
    ])("%s never splits a character", (_label, before, after) => {
      const edit = contiguousTextEdit(before, after);

      expect(apply(before, edit)).toBe(after);
      expect(wellFormed(edit.insertText), JSON.stringify(edit)).toBe(true);
      expect(wellFormed(before.slice(edit.index, edit.index + edit.deleteCount)), JSON.stringify(edit)).toBe(true);
    });

    it("reaches the other participant intact", () => {
      const { a, b, textB } = pair("😀😁");
      input(a.textarea, "😁");
      expect(textB.toString()).toBe("😁");
      expect(b.textarea.value).toBe("😁");
      expect(wellFormed(b.textarea.value)).toBe(true);
    });
  });

  describe("input-method composition", () => {
    it("keeps the composition when another participant edits meanwhile, and merges afterwards", () => {
      // A remote update used to replace the textarea's value mid-composition,
      // discarding what was being composed. Android keyboards compose every word.
      const { a, b, textA, textB } = pair("hello world");
      a.textarea.dispatchEvent(new CompositionEvent("compositionstart"));
      a.textarea.value = "hello world にほ";                        // composing at the end

      input(b.textarea, "REMOTE hello world");                      // someone types at the start

      expect(a.textarea.value).toBe("hello world にほ");            // untouched while composing
      a.textarea.value = "hello world 日本";
      a.textarea.dispatchEvent(new CompositionEvent("compositionend"));

      expect(textA.toString()).toBe("REMOTE hello world 日本");
      expect(textB.toString()).toBe("REMOTE hello world 日本");
      expect(a.textarea.value).toBe("REMOTE hello world 日本");
      expect(a.textarea.selectionStart).toBe("REMOTE hello world 日本".length);
    });

    it("places the composed text correctly when the remote edit was before it", () => {
      const { a, b, textA } = pair("one two three");
      a.textarea.dispatchEvent(new CompositionEvent("compositionstart"));
      a.textarea.value = "one two X three";                         // composing in the middle
      input(b.textarea, "ZERO one two three");
      a.textarea.dispatchEvent(new CompositionEvent("compositionend"));

      expect(textA.toString()).toBe("ZERO one two X three");
    });

    it("behaves as before when nothing arrived during the composition", () => {
      const { a, textB } = pair("abc");
      a.textarea.dispatchEvent(new CompositionEvent("compositionstart"));
      a.textarea.value = "abcé";
      a.textarea.dispatchEvent(new CompositionEvent("compositionend"));
      expect(textB.toString()).toBe("abcé");
    });
  });

  it("inserts a very large paste in pieces, each its own update, without breaking characters", () => {
    const { a, textB, docA } = pair("start ");
    const sizes = [];
    docA.on("update", (update, origin) => { if (origin !== "net") sizes.push(update.length); });
    const pasted = `${"😀".repeat(40_000)}${"x".repeat(150_000)}`;       // 230,000 code units

    input(a.textarea, `start ${pasted}`);

    expect(textB.toString()).toBe(`start ${pasted}`);
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThan(300 * 1024);
    expect(wellFormed(textB.toString())).toBe(true);
  });

  describe("where a keystroke is placed", () => {
    it("puts a typed character where the caret is, not where an equal neighbour is", () => {
      // "aa" with the caret between the two, typing "a": all three placements
      // give "aaa"; only one of them is where the user typed.
      expect(contiguousTextEdit("aa", "aaa", 2)).toEqual({ index: 1, deleteCount: 0, insertText: "a" });
      expect(contiguousTextEdit("aa", "aaa", 1)).toEqual({ index: 0, deleteCount: 0, insertText: "a" });
      expect(contiguousTextEdit("aa", "aaa", 3)).toEqual({ index: 2, deleteCount: 0, insertText: "a" });
      // A deletion ends with the caret where the text was removed.
      expect(contiguousTextEdit("aaa", "aa", 1)).toEqual({ index: 1, deleteCount: 1, insertText: "" });
      expect(contiguousTextEdit("aaa", "aa", 0)).toEqual({ index: 0, deleteCount: 1, insertText: "" });
      // Without a caret, or with one that does not fit the change, it still works.
      expect(contiguousTextEdit("aa", "aaa")).toMatchObject({ deleteCount: 0, insertText: "a" });
      expect(contiguousTextEdit("abc", "abXc", 0)).toEqual({ index: 2, deleteCount: 0, insertText: "X" });
    });
  });
});
