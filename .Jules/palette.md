# Palette's Journal
## 2024-04-23 - Keyboard accessibility for hidden interactive menus
**Learning:** Using Tailwind's `group-hover` to reveal interactive elements (like a volume slider or speed menu) creates a keyboard trap if users cannot tab into it. This is a common pattern in this app's media player controls.
**Action:** Always pair `group-hover` with `group-focus-within` on the parent container so that tabbing into the hidden element correctly reveals it for keyboard users.
