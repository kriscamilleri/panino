/**
 * Resolve template variables in content.
 * @param {string} content - Raw template markdown
 * @param {Object<string,string>} inputValues - Map of label → user-entered value
 * @returns {string} Content with all variables substituted
 */
export function resolveTemplateVariables(content, inputValues = {}) {
  let result = content;

  // Replace {{today}} with current date (YYYY-MM-DD)
  result = result.replace(/\{\{today\}\}/g,
    new Date().toISOString().slice(0, 10));

  // Replace {{now}} with current ISO 8601 datetime
  result = result.replace(/\{\{now\}\}/g,
    new Date().toISOString());

  // Replace {{input:Label}} with user-provided values
  for (const [label, value] of Object.entries(inputValues)) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\{\\{input:${escaped}\\}\\}`, 'g');
    result = result.replace(regex, value);
  }

  return result;
}

/**
 * Extract unique input variable labels from template content.
 * @param {string} content - Raw template markdown
 * @returns {string[]} Unique, deduplicated labels in order of first appearance
 */
export function extractInputLabels(content) {
  const regex = /\{\{input:([^}]+)\}\}/g;
  const labels = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    labels.push(match[1]);
  }
  return [...new Set(labels)];
}
