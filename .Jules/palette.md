# Palette's Journal

## 2024-11-20 - Ensure Keyboard Reachability for Submenus

**Learning:** Found a specific pattern in the application's components: interactive child menus (like Playback Speed and Volume control) use `group-hover` to display but are inaccessible to keyboard-only users who tab to the parent element, resulting in keyboard traps.
**Action:** Pair `group-hover` utility classes with `group-focus-within` on the hidden child elements to ensure submenus and sliders are revealed upon keyboard tabbing.
