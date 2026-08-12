# Palette's Journal
## 2026-05-04 - Keyboard Accessibility with Tailwind Groups
**Learning:** Interactive components using Tailwind `group-hover` to reveal nested controls (like playback speed dropdowns or volume sliders) are completely inaccessible to keyboard users unless explicitly paired with focus equivalents.
**Action:** Always strictly pair `group-hover/name:visible` with `group-focus-within/name:visible` when the hidden content contains interactive focusable elements, ensuring keyboard navigation works flawlessly.
