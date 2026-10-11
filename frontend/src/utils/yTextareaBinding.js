import * as Y from "yjs";

const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

// A pasted megabyte as one insertion is one update larger than the server
// accepts. Inserted in pieces, each piece is its own update.
const INSERT_CHUNK_LENGTH = 64 * 1024;

/**
 * The one contiguous replacement that turns `previousValue` into `nextValue`.
 *
 * Strings are compared by UTF-16 code unit, and most emoji are two units that
 * share their first with every other emoji of the same range. Compared naively,
 * deleting the first of two emoji gave an edit that removed the second half of
 * one and the first half of the next: the shared text ended up holding two
 * broken characters, for everyone. The boundaries are therefore moved off the
 * middle of a pair.
 *
 * `caret` is where the caret is after the change. Typing "a" between two "a"s
 * gives the same text wherever the new one is said to be, and without the
 * caret it was always placed after its equal neighbours. The text is the same
 * either way, but the position decides how the edit merges with someone
 * else's, so the change is anchored to end at the caret whenever that fits.
 *
 * @param {string} previousValue
 * @param {string} nextValue
 * @param {number} [caret] caret offset in `nextValue`, when the selection is collapsed
 */
export function contiguousTextEdit(previousValue, nextValue, caret) {
  const before = String(previousValue ?? "");
  const after = String(nextValue ?? "");

  /** The edit left between a common prefix and a common suffix of these lengths. */
  const between = (prefix, suffix) => {
    let start = prefix;
    let tail = suffix;
    if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start -= 1;
    if (tail > 0 && isLowSurrogate(before.charCodeAt(before.length - tail))) tail -= 1;
    return {
      index: start,
      deleteCount: before.length - start - tail,
      insertText: after.slice(start, after.length - tail),
    };
  };

  let prefix = 0;
  const sharedLength = Math.min(before.length, after.length);
  while (prefix < sharedLength && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  const smallest = between(prefix, suffix);

  // The same change, placed so that it ends at the caret. Used only when it is
  // no larger than the smallest one: a caret that is somewhere else (a value
  // set from code, a replacement the browser made elsewhere) must not turn a
  // one-letter edit into deleting and retyping a stretch of unchanged text.
  if (Number.isInteger(caret) && caret >= 0 && caret <= after.length) {
    const tail = after.length - caret;
    if (tail <= before.length && before.endsWith(after.slice(caret))) {
      let anchoredPrefix = 0;
      const limit = Math.min(before.length, after.length) - tail;
      while (anchoredPrefix < limit && before[anchoredPrefix] === after[anchoredPrefix]) anchoredPrefix += 1;
      const anchored = between(anchoredPrefix, tail);
      if (anchored.deleteCount === smallest.deleteCount && anchored.insertText.length === smallest.insertText.length) {
        return anchored;
      }
    }
  }
  return smallest;
}

export function transformOffset(offset, delta) {
  const target = Math.max(0, Number(offset) || 0);
  let oldOffset = 0;
  let newOffset = 0;
  for (const operation of delta || []) {
    if (operation.insert !== undefined) {
      newOffset += typeof operation.insert === "string" ? operation.insert.length : 1;
    } else if (operation.delete !== undefined) {
      const end = oldOffset + operation.delete;
      if (target <= end) return newOffset;
      oldOffset = end;
    } else if (operation.retain !== undefined) {
      const end = oldOffset + operation.retain;
      if (target <= end) return newOffset + target - oldOffset;
      oldOffset = end;
      newOffset += operation.retain;
    }
  }
  return newOffset + target - oldOffset;
}

export class YTextareaBinding {
  constructor({ textarea, ytext, origin, applyValue }) {
    if (!(textarea instanceof HTMLTextAreaElement)) throw new TypeError("A textarea is required");
    if (!(ytext instanceof Y.Text)) throw new TypeError("A Y.Text is required");
    this.textarea = textarea;
    this.ytext = ytext;
    this.origin = origin;
    this.applyValue = applyValue;
    this.previousValue = ytext.toString();
    this.composing = false;
    this.applyingRemote = false;
    // How the shared text moved while an input method was composing.
    this.remoteDeltasDuringComposition = [];
    this.undoManager = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([origin]),
      captureTimeout: 500,
    });
    this.onInput = () => {
      if (!this.composing && !this.applyingRemote) this.applyLocalInput();
    };
    this.onCompositionStart = () => { this.composing = true; };
    this.onCompositionEnd = () => {
      this.composing = false;
      if (this.remoteDeltasDuringComposition.length) this.applyComposedInput();
      else this.applyLocalInput();
    };
    this.onYText = (event, transaction) => {
      const value = ytext.toString();
      if (transaction.origin === origin) {
        this.previousValue = value;
        return;
      }
      if (this.composing) {
        // The input method owns the textarea until it finishes (every word, on
        // Android keyboards and for Chinese, Japanese and Korean). Setting the
        // value now would throw the composition away. Remember how the text
        // moved and catch up when the composition ends.
        this.remoteDeltasDuringComposition.push(event.delta);
        return;
      }
      const start = transformOffset(textarea.selectionStart, event.delta);
      const end = transformOffset(textarea.selectionEnd, event.delta);
      this.applyingRemote = true;
      try {
        applyValue?.(value);
        if (textarea.value !== value) textarea.value = value;
        textarea.setSelectionRange(start, end, textarea.selectionDirection || "none");
        this.previousValue = value;
      } finally {
        this.applyingRemote = false;
      }
    };
    textarea.addEventListener("input", this.onInput);
    textarea.addEventListener("compositionstart", this.onCompositionStart);
    textarea.addEventListener("compositionend", this.onCompositionEnd);
    ytext.observe(this.onYText);
    if (textarea.value !== this.previousValue) applyValue?.(this.previousValue);
  }

  /** Apply one replacement to the shared text, in pieces when it is very large. */
  replace(index, deleteCount, insertText) {
    const { ytext, origin } = this;
    if (insertText.length <= INSERT_CHUNK_LENGTH) {
      ytext.doc.transact(() => {
        if (deleteCount) ytext.delete(index, deleteCount);
        if (insertText) ytext.insert(index, insertText);
      }, origin);
      return;
    }
    if (deleteCount) ytext.doc.transact(() => ytext.delete(index, deleteCount), origin);
    for (let offset = 0; offset < insertText.length;) {
      let end = Math.min(offset + INSERT_CHUNK_LENGTH, insertText.length);
      if (end < insertText.length && isHighSurrogate(insertText.charCodeAt(end - 1))) end -= 1;
      const piece = insertText.slice(offset, end);
      const at = index + offset;
      ytext.doc.transact(() => ytext.insert(at, piece), origin);
      offset = end;
    }
  }

  /** The caret, when there is one place it can mean. */
  caret() {
    const { selectionStart, selectionEnd } = this.textarea;
    return selectionStart === selectionEnd ? selectionStart : undefined;
  }

  applyLocalInput() {
    const edit = contiguousTextEdit(this.previousValue, this.textarea.value, this.caret());
    if (!edit.deleteCount && !edit.insertText) return;
    this.replace(edit.index, edit.deleteCount, edit.insertText);
    this.previousValue = this.ytext.toString();
  }

  /**
   * A composition has ended and other participants changed the text while it
   * ran. What was composed is found against the text the textarea was showing,
   * moved to where that place is now, applied, and the textarea then shows the
   * combined text with the caret after the composed input.
   */
  applyComposedInput() {
    const { ytext, textarea } = this;
    const edit = contiguousTextEdit(this.previousValue, textarea.value, this.caret());
    let index = edit.index;
    for (const delta of this.remoteDeltasDuringComposition) index = transformOffset(index, delta);
    this.remoteDeltasDuringComposition = [];
    index = Math.min(index, ytext.length);
    const deleteCount = Math.min(edit.deleteCount, ytext.length - index);
    if (deleteCount || edit.insertText) this.replace(index, deleteCount, edit.insertText);

    const value = ytext.toString();
    const caret = index + edit.insertText.length;
    this.applyingRemote = true;
    try {
      this.applyValue?.(value);
      if (textarea.value !== value) textarea.value = value;
      textarea.setSelectionRange(caret, caret);
      this.previousValue = value;
    } finally {
      this.applyingRemote = false;
    }
  }

  undo() { this.undoManager.undo(); }
  redo() { this.undoManager.redo(); }

  destroy() {
    this.textarea.removeEventListener("input", this.onInput);
    this.textarea.removeEventListener("compositionstart", this.onCompositionStart);
    this.textarea.removeEventListener("compositionend", this.onCompositionEnd);
    this.ytext.unobserve(this.onYText);
    this.undoManager.destroy();
  }
}
