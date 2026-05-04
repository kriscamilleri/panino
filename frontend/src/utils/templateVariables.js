// Match {{today:format}} — format group is optional
const TODAY_REGEX = /\{\{today(?::([^}]*))?\}\}/g;

// Match {{now:format}} — format group is optional
const NOW_REGEX = /\{\{now(?::([^}]*))?\}\}/g;

// Match {{input:Label}}
const INPUT_REGEX = /\{\{input:([^}]+)\}\}/g;

/**
 * Format a Date object using simple pattern tokens.
 * Supports: yyyy, yy, MM, dd, HH, mm, ss
 * Unrecognized characters pass through unchanged.
 * @param {Date} date
 * @param {string} format
 * @returns {string}
 */
export function formatDate(date, format) {
  const pad = (n) => String(n).padStart(2, "0");
  const tokens = {
    yyyy: date.getFullYear(),
    yy: String(date.getFullYear()).slice(-2),
    MM: pad(date.getMonth() + 1),
    dd: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };

  let result = format;
  // Replace longer tokens first to avoid partial matches
  const sortedKeys = Object.keys(tokens).sort((a, b) => b.length - a.length);
  for (const token of sortedKeys) {
    result = result.replace(new RegExp(token, "g"), tokens[token]);
  }
  return result;
}

/**
 * Resolve template variables in content.
 * @param {string} content - Raw template markdown
 * @param {Object<string,string>} inputValues - Map of label → user-entered value
 * @returns {string} Content with all variables substituted
 */
export function resolveTemplateVariables(content, inputValues = {}) {
  let result = content;

  // {{today:format}} and {{now:format}} first (match format-suffix before plain)
  result = result.replace(TODAY_REGEX, (_, format) => {
    const d = new Date();
    return format ? formatDate(d, format) : d.toISOString().slice(0, 10);
  });
  result = result.replace(NOW_REGEX, (_, format) => {
    const d = new Date();
    return format ? formatDate(d, format) : d.toISOString();
  });

  // {{input:Label}} — unchanged
  for (const [label, value] of Object.entries(inputValues)) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\{\\{input:${escaped}\\}\\}`, "g");
    result = result.replace(regex, value);
  }

  return result;
}

/**
 * Extract unique input variable labels from one or more template strings.
 * @param {string} content - Raw template markdown
 * @param {string} [titlePattern=''] - Optional title pattern
 * @returns {string[]} Unique, deduplicated labels in order of first appearance
 */
export function extractInputLabels(content, titlePattern = "") {
  const regex = /\{\{input:([^}]+)\}\}/g;
  const labels = [];
  let match;
  const combined = `${content}\n${titlePattern}`;
  while ((match = regex.exec(combined)) !== null) {
    labels.push(match[1]);
  }
  return [...new Set(labels)];
}
