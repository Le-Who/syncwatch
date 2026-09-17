# Palette's Journal

## 2026-09-17 - [Interruptive Overlay Accessibility]
**Learning:** Interruptive overlays like 'Up Next' and 'Reconnecting' lack explicitly defined accessibility structures for their interactive elements (e.g. Skip, Retry, icon-only dismiss).
**Action:** Always verify generic buttons on custom overlays include clear `aria-label`s and `outline-none focus-visible:ring-2` classes to maintain context and visible focus.
