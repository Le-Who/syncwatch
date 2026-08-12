# Palette's Journal

## 2024-04-24 - Interactive Elements Hidden by Tailwind Groups
**Learning:** Interactive elements hidden behind `group-hover` (like dropdowns and sliders) remain inaccessible to keyboard users because they cannot Tab into `display: none` or 0-width elements easily, or the element disappears when focus moves inside.
**Action:** When using Tailwind named groups (e.g., `group/name`) to reveal interactive children via hover (`group-hover/name:flex`), strictly pair them with corresponding named focus variants (`group-focus-within/name:flex`) to ensure keyboard accessibility.
