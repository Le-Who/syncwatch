# Palette's Journal

## 2024-05-24 - Interactive Menus Keyboard Accessibility
**Learning:** When using Tailwind named groups (e.g., `group/name`) to control the visibility of interactive children via hover (`group-hover/name:flex`), these children remain inaccessible to keyboard-only users who tab through the interface.
**Action:** Strictly pair `group-hover` utility classes with corresponding named focus variants (e.g., `group-focus-within/name:flex`) on the child container to ensure keyboard accessibility.
