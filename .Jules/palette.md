# Palette's Journal

## 2024-04-21 - Interactive Element Keyboard Accessibility
**Learning:** Hidden interactive elements relying on Tailwind's `group-hover` (like speed menus or volume sliders) become completely inaccessible to keyboard users unless explicitly paired with focus states.
**Action:** Always pair `group-hover/[name]` with `group-focus-within/[name]` on the revealing container to ensure keyboard focus flow works consistently with mouse interactions.
