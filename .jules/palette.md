# Palette's Journal

## 2024-05-18 - Keyboard Accessibility for Hover Menus

**Learning:** Hidden interactive UI components (like menus or sliders) that appear on `group-hover` create a keyboard trap or are simply inaccessible when tabbing.
**Action:** Always pair `group-hover/name` with `group-focus-within/name` when using Tailwind classes to control the visibility of interactive children, ensuring they reveal themselves upon keyboard tabbing.
