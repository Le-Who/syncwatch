# Palette's Journal

## 2024-05-19 - Player Controls Keyboard Accessibility
**Learning:** The playback speed and volume controls in `components/Player.tsx` used Tailwind `group-hover` utilities to display hidden sub-menus, making them inaccessible to keyboard-only users who navigate via `Tab`.
**Action:** When hiding interactive child elements (like sliders or option lists) behind a parent's hover state in Tailwind, consistently pair `group-hover` with `group-focus-within` on the parent and ensure focusable sub-elements correctly trigger this state.
