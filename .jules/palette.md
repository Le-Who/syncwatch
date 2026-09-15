# Palette's Journal
## 2025-02-28 - Focus-within Menus
**Learning:** Pure CSS hover menus (e.g. `group-hover`) break keyboard accessibility for interactive controls like volume/speed bars, failing WCAG compliance.
**Action:** Always combine `group-hover` with `group-focus-within` and ensure hidden controls are focusable, providing clear `focus-visible` outlines when expanded.
