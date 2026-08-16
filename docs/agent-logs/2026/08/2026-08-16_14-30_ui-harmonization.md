# UI harmonization across modals, buttons and form controls

- **Agent:** Claude Opus 5 (Claude Code)
- **Start:** 2026-08-16 14:08 CEST
- **Status:** Complete

## Objective

Remove the accumulated visual drift across the frontend — inconsistent icon alignment inside
modals, differing font treatments, buttons of the same role rendered at different sizes and
colours, and mixed border-radius / border / focus conventions. Do it by consolidating shared
components rather than by patching class strings in place. Produce before/after screenshots
and a comparison document.

## Progress

### 1. Audit

Inventoried the frontend with grep plus reads of all nine dialog components and the pages that
carry form controls. Findings:

| Category | Before |
|---|---|
| Radius | Bare `rounded` (65), `rounded-md` (71), `rounded-lg` (36), `rounded-full` (5) applied without a rule |
| Accent | `bg-gray-800` primaries in 7 dialogs, `bg-blue-500` in 3; blue selection/progress states; focus rings gray-500 (18) vs blue-500 (4) |
| Button geometry | Five paddings for the same role; icon gaps via `space-x-1`, `mr-1`, `mr-2`, `gap-1.5`, `gap-2` |
| Dialog chrome | 9 hand-rolled dialogs — 7 copy-pasted from a common ancestor and drifted, 3 with no chrome at all |
| Titles | `text-xl font-semibold text-gray-800` (modals) vs `text-lg font-medium text-gray-900` (pages); 12 heading variants |
| Footer verbs | "Done" / "Close" / "Cancel" used interchangeably for dismissal |
| Inputs | A 130-char class chain retyped in 6 files with 3 focus variants; 4 other inputs on a short `rounded border` chain |
| Tables | 3 implementations, per-cell `px-3 py-2 align-middle` on every `<td>`, unstyled headers |

Two notable individual defects found during the audit:

- `TemplateManagerPage` forced its New button primary with
  `!text-white !bg-gray-800 !hover:bg-gray-900 !px-4 !py-2`. `!hover:bg-gray-900` is not valid
  Tailwind syntax (the modifier must precede the `!`), so hover was silently dead.
- `pn-checkbox`/`pn-radio` initially used `text-gray-800`, which is a no-op without
  `@tailwindcss/forms` (not installed). Native controls kept the OS blue until switched to
  `accent-gray-800`. Verified in-browser.

### 2. Design layer

Wrote the contracts down in `docs/architecture/ui-design-system.md`:
controls `rounded-md` / containers `rounded-lg`; accent gray-800/900 with blue reserved for
links; `border-gray-300` interactive / `border-gray-200` structural; buttons ring-2 offset-2,
inputs ring-1; icon spacing by `gap` only; six named type tiers.

### 3. Implementation

Screenshots captured from the running dev stack (`docker-compose.dev.yml`, already up) via the
Chrome tools, using a `__panelRect` helper to crop each dialog precisely so before/after pairs
frame identically.

## Changes Made

**New components**

- `frontend/src/components/BaseModal.vue` — overlay, panel (sm 480 / md 600 / lg 720), header
  with title + optional subtitle + close, scrolling body, sticky footer slot.
- `frontend/src/components/PromptModal.vue` — single-field name prompt; owns its own focus.
- `frontend/src/components/OptionCard.vue` — shared format-picker row for Import/Export; icon in
  a fixed box aligned to the title's first line.

**Rewritten / extended**

- `BaseButton.vue` — `variant` (primary / secondary / ghost / danger) × `size` (sm / md), plus
  `iconOnly` and the existing `isActive` / `as`. `danger` is deliberately the same weight as
  `ghost` so destructive table-row actions do not out-shout their neighbours (a bordered
  `danger` was tried first and visibly clipped the Templates action column).
- `assets/main.css` — 24 `pn-*` primitives in `@layer components`: form controls, type tiers,
  surfaces, alerts, tables, toolbar controls.

**Converted to the shared primitives**

ExportModal, ImportModal, VariablesModal, TemplateVariableDialog, TemplatePickerModal,
ImageLibraryModal, GitHubBackupModal, Documents.vue, TreeItem.vue (2 dialogs + context menu),
SubMenuBar.vue (14 toolbar buttons, 2 inputs), TemplateManagerPage, ImageManagerPage,
SettingsPage, StyleCustomizer, AuthForm, ChangePasswordForm, PwaInstallPrompt, RevisionPanel,
LoadingPage, TermsOfServicePage.

`utils/githubBackupProgress.js` — active progress step moved off blue to gray; its unit test
updated to the new class string.

**Docs**

- `docs/architecture/ui-design-system.md` — the contracts and the primitive reference.
- `docs/ui-harmonization/{before,after}/*.png` — 8 matched screenshot pairs.
- `docs/ui-harmonization/comparison.html` — comparison document (also published as an artifact).

## Tests

```
npm run test:fe   17 files, 254 tests passing
npm run lint      0 errors, 41 warnings (all pre-existing no-console)
vite build        clean; only pre-existing dynamic-import chunking warnings
```

Browser validation on the dev stack at `localhost:5173`: Export, Import, Global Variables,
GitHub Backup, New Note from Template, Create New File, Images page, Templates page — all
re-opened and re-captured after the change.

One regression was introduced and caught in-browser during that pass: `BaseModal`'s panel
carried both `w-full` and `w-[600px]`, and `w-full` won, so dialogs rendered full-bleed. Fixed
to `max-w-full` + the size class.

## Open Items / Notes

- **Behaviour changes, intentional:** ImportModal now dismisses on backdrop click like every
  other dialog (still blocked while an import is running); disabled primaries use `opacity-50`
  rather than `bg-gray-300`.
- **`data-testid` coverage preserved.** Five container-level ids (`export-modal-container` and
  siblings) were dropped — each was already shadowed by the parent's fall-through testid and
  referenced nowhere.
- **`frontend/src/style.css` is dead code.** Not imported anywhere (only `assets/main.css` is),
  and it carries a global `button { border-radius: 8px; background-color: #1a1a1a }` that would
  fight the button system if it were ever wired up. Left in place; safe to delete.
- **Templates action column** can overflow its card below ~1100px viewport width. `pn-table-wrap`
  scrolls so it stays usable, but the column set is dense and could lose a column at small
  widths.
- Not covered by this pass: `Editor.vue`, `Navbar.vue`, `MobileMenu.vue` and `ContentArea.vue`
  beyond removing their `space-x-1` icon-spacing hacks — their layouts are structural rather
  than control-level.
