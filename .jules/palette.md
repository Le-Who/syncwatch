# Palette's Journal
## 2024-03-05 - Interruptive overlays accessibility
**Learning:** Interruptive overlays (e.g., 'Up Next', 'Reconnecting') and state guards must have explicit accessibility structures for their interactive elements to maintain context and visible focus.
**Action:** Always verify generic buttons (like 'Skip', 'Retry', or icon-only dismiss buttons) in overlays include clear `aria-label`s and `outline-none focus-visible:ring-2` (and often ring-offset) classes.
