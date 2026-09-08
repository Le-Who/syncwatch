# Palette's Journal

## 2026-09-08 - Focus and semantic markup for clickable overlays
**Learning:** The 'SleepOverlay' component used a clickable div as an interactive element without semantic `role="button"`, `tabIndex`, or keyboard event handlers, breaking accessibility.
**Action:** Always add `role="button"`, `tabIndex={0}`, `onKeyDown` (handling Enter and Space), and `aria-label` alongside `outline-none focus-visible:ring-2` when converting non-interactive elements like divs into clickable overlays.
