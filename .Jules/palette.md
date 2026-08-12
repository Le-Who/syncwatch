# Palette's Journal

## 2024-05-18 - Keyboard accessibility for Tailwind hover groups
**Learning:** Tailwind `group-hover` utility classes conditionally display interactive child elements but hide them from keyboard users.
**Action:** Pair `group-hover` with `group-focus-within` on the child element (and `group` on the parent container) to ensure the element reveals itself upon keyboard tabbing, preventing keyboard traps or hidden interactive areas.
