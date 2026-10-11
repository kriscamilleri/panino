import { parseDbKey } from "./db.js";
import { parseInternalImageLink } from "./imageLinks.js";
import { toCanonicalImageUrl } from "./spaceStorage.js";

// A label longer than this is not a label anyone wrote. Without a bound, each
// "![" on a long line makes the expression scan to the end of that line.
const MAX_LABEL_LENGTH = 1000;

function normalizeReferenceLabel(value) {
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

function lineOffsets(text) {
  const lines = [];
  let offset = 0;
  for (const value of text.split(/(?<=\n)/)) {
    lines.push({ value, offset });
    offset += value.length;
  }
  if (text.length === 0) lines.push({ value: "", offset: 0 });
  return lines;
}

function excludedRanges(markdown) {
  const ranges = [];
  let fence = null;
  let htmlBlockTag = null;
  let htmlComment = false;
  for (const line of lineOffsets(markdown)) {
    const body = line.value.replace(/\r?\n$/, "");
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(body);
    if (fence) {
      ranges.push([line.offset, line.offset + line.value.length]);
      if (new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`).test(body)) fence = null;
      continue;
    }
    if (htmlComment) {
      ranges.push([line.offset, line.offset + line.value.length]);
      if (body.includes("-->")) htmlComment = false;
      continue;
    }
    if (htmlBlockTag) {
      ranges.push([line.offset, line.offset + line.value.length]);
      if (!body.trim() || new RegExp(`</${htmlBlockTag}\\s*>`, "i").test(body)) htmlBlockTag = null;
      continue;
    }
    if (/^ {0,3}<!--/.test(body)) {
      ranges.push([line.offset, line.offset + line.value.length]);
      htmlComment = !body.includes("-->");
      continue;
    }
    const htmlStart = /^ {0,3}<(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|>|\/)/i.exec(body);
    if (htmlStart) {
      ranges.push([line.offset, line.offset + line.value.length]);
      if (!new RegExp(`</${htmlStart[1]}\\s*>`, "i").test(body) && !/\/>\s*$/.test(body)) {
        htmlBlockTag = htmlStart[1];
      }
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      ranges.push([line.offset, line.offset + line.value.length]);
      continue;
    }
    if (/^(?: {4}|\t)/.test(body)) {
      ranges.push([line.offset, line.offset + line.value.length]);
      continue;
    }

    // Markdown code spans can contain image-looking text. A matching run of
    // backticks closes only a run of the same length.
    for (let cursor = 0; cursor < body.length;) {
      if (body[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      let length = 1;
      while (body[cursor + length] === "`") length += 1;
      const close = body.indexOf("`".repeat(length), cursor + length);
      if (close < 0) break;
      ranges.push([line.offset + cursor, line.offset + close + length]);
      cursor = close + length;
    }

    // Raw inline HTML is deliberately outside the Markdown-image contract.
    for (const match of body.matchAll(/<[^>\n]*>/g)) {
      ranges.push([line.offset + match.index, line.offset + match.index + match[0].length]);
    }
  }
  // Sorted and merged, so a lookup is a binary search. A linear scan per match
  // made a Document of many short code spans and image links quadratic, and
  // the whole server waited for it.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

function isExcluded(index, ranges) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (index < ranges[middle][0]) high = middle - 1;
    else if (index >= ranges[middle][1]) low = middle + 1;
    else return true;
  }
  return false;
}

function isEscaped(text, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function collectReferenceLabels(markdown, ranges) {
  const labels = new Set();
  const expression = new RegExp(`!\\[[^\\]\\n]{0,${MAX_LABEL_LENGTH}}\\]\\[([^\\]\\n]{1,${MAX_LABEL_LENGTH}})\\]`, "g");
  for (const match of markdown.matchAll(expression)) {
    if (!isExcluded(match.index, ranges) && !isEscaped(markdown, match.index)) {
      labels.add(normalizeReferenceLabel(match[1]));
    }
  }
  return labels;
}

function unwrapDestination(raw) {
  return raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
}

function wrapDestination(original, replacement) {
  return original.startsWith("<") ? `<${replacement}>` : replacement;
}

/**
 * Rebind the Markdown images of one database to their copies in another.
 * Everything outside the destination byte spans is returned unchanged.
 *
 * A link counts as an image of the source database in every form the editor
 * writes (see `parseInternalImageLink`): `/images/<id>`, `/api/images/<id>`
 * and an absolute URL on the API's origin. The first version recognised only
 * the bare form, which no running frontend writes, so a transfer copied no
 * images, warned about nothing and reported success. The rewritten link keeps
 * the form it had.
 *
 * `noncanonicalImageIds` are internal image links that are left alone: they
 * point into a different database than the source, or carry parameters this
 * code does not understand.
 */
export function rewriteCanonicalImageDestinations(markdown, {
  sourceDbKey,
  destinationDbKey,
  imageMap = {},
} = {}) {
  const source = parseDbKey(sourceDbKey);
  parseDbKey(destinationDbKey);
  const text = typeof markdown === "string" ? markdown : "";
  const ranges = excludedRanges(text);
  const referencedLabels = collectReferenceLabels(text, ranges);
  const replacements = [];
  const sourceImageIds = new Set();
  const missingImageIds = new Set();
  const noncanonicalImageIds = new Set();

  function consider(raw, start, end) {
    const link = parseInternalImageLink(unwrapDestination(raw));
    if (!link) return;
    const inSourceDatabase = source.kind === "space" ? link.spaceId === source.id : link.spaceId === null;
    if (!inSourceDatabase || link.extraParameters) {
      noncanonicalImageIds.add(link.imageId);
      return;
    }
    const sourceImageId = link.imageId;
    sourceImageIds.add(sourceImageId);
    const destinationImageId = imageMap[sourceImageId];
    if (!destinationImageId) {
      missingImageIds.add(sourceImageId);
      return;
    }
    replacements.push({
      start,
      end,
      // A session token has no place in stored Markdown; it is not carried over.
      value: wrapDestination(raw, `${link.prefix}${toCanonicalImageUrl(destinationImageId, destinationDbKey)}`),
    });
  }

  // Inline image destinations, with an optional Markdown title after the URL.
  const inline = new RegExp(
    `!\\[[^\\]\\n]{0,${MAX_LABEL_LENGTH}}\\]\\(\\s*(<[^>\\n]+>|[^\\s)\\n]+)(?=\\s*(?:["'][^"'\\n]*["']|\\([^\\n)]*\\))?\\s*\\))`,
    "g",
  );
  for (const match of text.matchAll(inline)) {
    if (isExcluded(match.index, ranges) || isEscaped(text, match.index)) continue;
    const relative = match[0].indexOf(match[1]);
    consider(match[1], match.index + relative, match.index + relative + match[1].length);
  }

  // Only definitions actually referenced by image syntax are eligible. An
  // ordinary link using the same definition must never cause a rewrite.
  const definition = /^ {0,3}\[([^\]\n]+)\]:\s*(<[^>\n]+>|\S+)/gm;
  for (const match of text.matchAll(definition)) {
    if (isExcluded(match.index, ranges)) continue;
    if (!referencedLabels.has(normalizeReferenceLabel(match[1]))) continue;
    const relative = match[0].lastIndexOf(match[2]);
    consider(match[2], match.index + relative, match.index + relative + match[2].length);
  }

  replacements.sort((a, b) => b.start - a.start);
  let content = text;
  for (const replacement of replacements) {
    content = `${content.slice(0, replacement.start)}${replacement.value}${content.slice(replacement.end)}`;
  }
  return {
    content,
    sourceImageIds: [...sourceImageIds],
    missingImageIds: [...missingImageIds],
    noncanonicalImageIds: [...noncanonicalImageIds],
  };
}
