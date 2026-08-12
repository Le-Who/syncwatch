# Palette's Journal

## 2024-04-17 - Keyboard Traps in Tailwind Group Hover Elements
**Learning:** Using `group-hover` utility classes to show interactive child elements (like volume sliders or speed menus) makes them inaccessible to keyboard users unless explicitly paired with focus state equivalents.
**Action:** Always pair `group-hover` with `group-focus-within` on the child container, and ensure the parent has the `group` class, so that when a keyboard user tabs to an interactive element within the hidden container, it becomes visible and usable.
