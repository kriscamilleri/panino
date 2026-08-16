# Dark Mode — Spec

> Add a persisted navy dark appearance to Panino, controlled by an accessible navbar
> toggle.
> Status: active
> Created: 2026-08-16
> Last updated: 2026-08-16

---

## 1) Summary

Panino currently renders only light-gray and white interface surfaces. Add a light/dark preference
that uses the supplied navy palette when dark and is available from the right side of the
main navbar. The preference is local to the browser rather than synced, so users may choose a
different interface theme on each device without creating a document change.

## 2) Goals

1. Let a user toggle between light and dark mode from the right side of the desktop navbar.
2. Make the same toggle available through the mobile navigation menu.
3. Persist the selected preference in browser storage and restore it before user interaction.
4. Apply the dark mode to application surfaces, text, icons, controls, menus, dialogs, tables,
   the markdown editor, rendered preview, and focus states.
5. Use an off-black dark surface, `#77a0a5` as primary, and `#9377a5` as the accent.
   Semantic status colors are success `#7dff95`, warning `#ffbc5e`, danger `#ff8080`, and
   info `#87d1ff`.
6. Keep text, icon, focus, link, error, and disabled states legible and keyboard accessible.
7. Preserve the existing light appearance and all document/sync behavior.

## 3) Non-goals

- Theme preferences are not stored in CR-SQLite and do not sync between devices.
- This does not add a system-preference or scheduled theme mode.
- This does not change document print styles or user-authored CSS.

## 4) User journeys

| # | Persona | Journey | Acceptance criteria |
|---|---|---|---|
| U1 | Desktop writer | Activates the navbar theme button while editing a note. | The complete workspace changes to dark mode; the button exposes the current state and the editor/preview remain readable. |
| U2 | Returning writer | Reloads after selecting dark mode. | Dark mode is restored before interaction and no document or sync state changes. |
| U3 | Mobile writer | Opens the mobile menu and changes the theme. | The mode changes immediately, the menu remains usable, and the selected theme persists after reload. |
| U4 | Keyboard user | Tabs to and activates the toggle. | The control has a descriptive accessible label, visible focus ring, and correct pressed state. |
| U5 | Desktop writer | Collapses the navbar labels. | Labels disappear from all desktop navbar controls while icons remain, and the saved preference restores on return. |

## 5) Design and accessibility

`html[data-theme="dark"]` activates the dark theme. The coal application base is `#151515`,
`#77a0a5` is the interactive primary, and `#9377a5` is the accent. Elevated and inset navy
surfaces are derived from that base for hierarchy. Foreground and muted text use VS Code-like
soft gray contrast rather than pure white; semantic status colors remain distinct from neutral
controls.

Theme overrides live after Tailwind utilities and map the utility classes used by shared
components. This preserves the existing component API while ensuring that existing pages, dialogs,
menus, forms, tables, and icons do not retain light-only backgrounds. The editor theme is rebuilt
when the preference changes so OverType receives matching foreground, background, code, cursor,
and selection values. The markdown preview inherits the global text colors and has explicit
code/table/blockquote styles.

The toggle uses a text-first `Dark mode` / `Light mode` label with a Lucide `Sun`/`Moon` icon,
`aria-pressed`, a changing title, and the standard focus-visible ring. The desktop-only navbar
collapse button persists whether labels are shown; labels are always hidden on mobile.

## 6) Data and interaction behavior

- Valid values are `light` and `dark`; malformed or missing storage values resolve to `light`.
- The local storage key is `panino-theme`.
- Setting a preference updates the root `data-theme` attribute and CSS `color-scheme` immediately.
- Theme persistence errors are surfaced by normal browser behavior; application code does not
  silently suppress them.

## 7) Security review

- The stored preference is validated against the two allowed constants before use.
- No user-supplied value is placed into HTML, CSS, SQL, or a URL.
- Theme changes make no network request and do not access synced data.
- No secrets, credentials, or new dependencies are introduced.

## 8) Tests

- Unit-test normalization, storage read/write, toggle behavior, and root-attribute application.
- Component-test the navbar button's accessible state and click wiring.
- Browser-verify both themes at 1280px and 375px, including a modal/input/editor/preview surface.
