# Palette's Journal

## 2024-04-11 - Tailwind Hover Sub-Menus Keyboard Accessibility

**Learning:** Elements relying solely on `group-hover` utility classes (e.g., `group-hover:flex` or `group-hover:w-24`) to display interactive elements create keyboard traps where visually impaired users or users navigating with a keyboard cannot access or see the sub-items.
**Action:** Always pair `group-hover` with `group-focus-within` on the child and `group` on the parent container when building interactive elements revealed by hover.
