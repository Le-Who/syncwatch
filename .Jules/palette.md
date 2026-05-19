# Palette's Journal

## 2024-05-19 - Ensure Keyboard Accessibility for Tailwind Named Groups
**Learning:** When using Tailwind named groups (e.g., `group/name`) to control the visibility of interactive children via hover (e.g., `group-hover/name:flex`), these children remain inaccessible to keyboard users because hover states cannot be triggered via keyboard navigation.
**Action:** Strictly pair `group-hover` visibility classes with corresponding named focus variants (e.g., `group-focus-within/name:flex`) to ensure that keyboard users can tab into and interact with the hidden elements.
