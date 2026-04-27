# Palette's Journal

## 2024-05-28 - Keyboard Accessibility for Tailwind Named Hover Groups
**Learning:** When using Tailwind named groups to control the visibility of interactive children via hover (e.g., `group-hover/speed:flex`), it hides the nested interactive elements from keyboard-only users. Children cannot be focused if they are hidden, or are visually hidden when focused.
**Action:** Strictly pair named group hover variants with corresponding named focus-within variants (e.g., `group-focus-within/speed:flex`) so that tabbing into the group trigger element makes the interactive children visible and keyboard-navigable.
