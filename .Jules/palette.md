# Palette's Journal

## 2026-04-03 - Keyboard Accessibility for Hover Menus

**Learning:** Tailwind `group-hover` utilities can create hidden interactive areas that remain inaccessible to keyboard users if not paired with focus states.
**Action:** When using `group-hover` to conditionally display interactive child elements (like speed menus or volume sliders), always pair it with the corresponding `group-focus-within` variant to ensure the element reveals itself upon keyboard tabbing.
