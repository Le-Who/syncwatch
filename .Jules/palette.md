# Palette's Journal
## 2024-04-12 - [Keyboard Accessibility for Hover Menus]
**Learning:** In Tailwind CSS, using `group-hover` utility classes to conditionally display interactive child elements (like menus or sliders) without pairing them with corresponding `group-focus-within` variants can create a keyboard trap or hide interactive areas for non-mouse users.
**Action:** When using `group-hover/name` to show elements, strictly pair it with `group-focus-within/name` on the child and ensure the parent container has the corresponding `group/name` class to ensure full keyboard accessibility.
