# Palette's Journal

## 2024-05-14 - Keyboard Accessibility for Named Hover Groups
**Learning:** Tailwind named groups (`group-hover/name`) used to hide/show interactive children must strictly be paired with their focus variants (`group-focus-within/name`). Otherwise, keyboard-only users cannot access elements like volume sliders or speed menus that only appear on mouse hover.
**Action:** Always verify that interactive elements hidden behind a `group-hover` modifier have a corresponding `group-focus-within` modifier so they become visible when a user tabs into them.
