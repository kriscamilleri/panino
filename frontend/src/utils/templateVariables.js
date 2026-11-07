/**
 * The template placeholder helpers live in the shared package
 * (`shared/templateVariables.js`) so the API's create-from-template gives the
 * same title and body as "New from template". This module keeps the old import path.
 */
export {
  formatDate,
  resolveTemplateVariables,
  extractInputLabels,
  resolveTemplateTitle,
} from '@panino/content-merge/template-variables';
