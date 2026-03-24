# Palette's Journal

## 2024-05-18 - Keyboard Accessibility for Hover-Revealed Menus
**Learning:** Using `group-hover` utility classes to conditionally display interactive child elements (like volume sliders or playback speed menus) breaks keyboard accessibility because users cannot hover via keyboard.
**Action:** Use `group` on the parent container and `group-focus-within` on the hidden child elements alongside `group-hover` classes. This ensures the element gracefully reveals itself when a user tabs into it with a keyboard, preventing keyboard traps or hidden interactive areas.
