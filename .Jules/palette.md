# Palette's Journal

## 2024-04-05 - Keyboard Accessible Hover Menus in Tailwind
**Learning:** When using Tailwind named groups (e.g., `group/name`) to conditionally display interactive child elements via hover (e.g., `group-hover/name:flex` or `group-hover/name:w-24`), these elements are inaccessible via keyboard navigation (tabbing) because the hover state is never triggered.
**Action:** Strictly pair `group-hover/name` utility classes with corresponding named focus variants (e.g., `group-focus-within/name`) to ensure the hidden element reveals itself upon receiving keyboard focus, preventing keyboard traps or hidden interactive areas.
