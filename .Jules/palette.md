# Palette's Journal

## 2024-04-19 - Keyboard Accessibility for Hover Menus
**Learning:** Using Tailwind named groups (`group/name` and `group-hover/name`) to conditionally display interactive children hides them from keyboard-only users.
**Action:** Always pair `group-hover/name` with `group-focus-within/name` so that when a user tabs into the hidden interactive element (or its trigger), the container reveals itself.
