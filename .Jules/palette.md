# Palette's Journal

## 2024-05-24 - Accessible Interactive Hover Menus

**Learning:** Elements hidden behind `group-hover` modifiers remain invisible to keyboard users navigating via `Tab`, rendering interactive children like sliders and dropdown buttons inaccessible.
**Action:** Always pair `group-hover` utility classes (e.g., `group-hover:flex` or `group-hover:w-24`) with their focus equivalent (`group-focus-within:flex`) on the same container when the revealed element contains interactive controls.
