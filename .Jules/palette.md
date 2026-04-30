# Palette's Journal

## 2024-05-15 - Interactive Elements Hidden by Tailwind Named Groups
**Learning:** When using Tailwind named groups (e.g., `group/name`) to control the visibility of interactive children via hover (e.g., `group-hover/name:flex`), the hidden elements become inaccessible to keyboard users because they are omitted from the tab order.
**Action:** Strictly pair `group-hover/name:X` variants with corresponding `group-focus-within/name:X` variants to ensure focus-driven visibility and keyboard accessibility.
