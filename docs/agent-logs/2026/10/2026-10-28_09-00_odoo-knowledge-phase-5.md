# Odoo integration — Phase 5: Article to Knowledge

- **Agent:** Claude Code (Fable 5.1)
- **Start:** 2026-10-28 09:00
- **Status:** Done

## Objective

Implement Phase 5 of [`docs/specs/active/odoo-integration.md`](../../../specs/active/odoo-integration.md):
send a Document to Odoo Knowledge as an article, with the HTML conversion of §7, a parent
picker, and overwrite on resend under the ownership rules of §6.

## Progress

- Backend `odooKnowledge.js`: `articleBody` runs the client's HTML through DOMPurify (jsdom) with
  a Knowledge allow-list, drops a first `<h1>` equal to the title, turns `contains-task-list`
  lists into `ul.o_checklist` with `li.o_checked`, replaces images with "Image not sent"
  placeholders (Phase 6 uploads them) and adds `target="_blank" rel="noopener noreferrer"` to
  links. One trap: DOMPurify runs *every* attribute value through `ALLOWED_URI_REGEXP`, so a
  strict scheme-only regex silently dropped `type="checkbox"`; the regex now also admits plain
  values. `searchArticles` excludes templates (`is_template`, with a fallback search).
  `sendArticleToKnowledge` creates under the chosen parent or at the top level and updates
  `name` and `body` after the `create_date` check.
- Routes: `GET /addons/odoo/articles`, `/send` takes `knowledge: {parentId?, html}` (2 MB cap,
  `parentId` 0 = top level, remembered in `odoo_defaults.parent_article_id`); `pdfRequest` is
  required only when Documents or the chatter is chosen, so a Knowledge-only send renders no PDF.
- Frontend: `utils/odooArticle.js` (plain MarkdownIt + task lists + DOMPurify),
  `composables/useDocumentArticle.js` (flush pending save, draft, front-matter variables),
  `odooStore.fetchArticles`, the send sheet's "Article to Knowledge" section with the parent
  picker ("Top level" first, remembered choice preselected), last-sent line and result.
- Fake Odoo: `knowledge.article` search_read/create/read/write with two demo articles.
- Browser check against the real local Odoo 20 Enterprise, headless: desktop 1280px create at
  the top level, Odoo-side body checked (no repeated heading, `o_checklist`/`o_checked`,
  placeholder, table), resend → one article with the new text; phone 375px sheet shows the
  Knowledge section with the last-sent line, no overflow, no page errors. 20/20.

## Changes Made

- `backend/api-service/odooKnowledge.js` (new), `odoo.js` (articles route, Knowledge
  destination, `KNOWLEDGE_MESSAGES`), `tests/fakeOdoo.js`, `tests/unit/odooKnowledge.test.js`
  (new, 5), `tests/integration/odooKnowledge.test.js` (new, 10).
- `frontend/src/utils/odooArticle.js` (new), `frontend/src/composables/useDocumentArticle.js`
  (new), `frontend/src/store/odooStore.js`, `frontend/src/components/OdooSendModal.vue`,
  `frontend/tests/unit/odooArticle.test.js` (new, 3), `frontend/tests/unit/odooSendModal.test.js`
  (+3).
- Docs: spec Phase 5 ✅; `backend/api-service/AGENTS.md`, `frontend/AGENTS.md`.

## Tests

- `./scripts/test-backend.sh tests/integration/odooKnowledge.test.js tests/unit/odooKnowledge.test.js`: 15 passed.
- `npm run test:fe`: 75 files, 930 tests passed.
- `npm run test:be`: 42 files, 616 tests passed.
- `npm run lint`: clean.
- Headless browser check (`scratchpad/knowledge-browser.mjs`): 20/20.

## Open Items / Notes

- Images in articles are placeholders until Phase 6.
- The "Keep in sync" switch on this section is Phase 9.
