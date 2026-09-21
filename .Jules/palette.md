# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2026-09-21 - Accessible Interactive Overlays
**Learning:** Interruptive overlays (like Up Next and Reconnecting dialogs) frequently have interactive buttons (e.g., skip, retry, dismiss) that lack explicit accessibility structure, making them hard to use for screen readers or keyboard navigation.
**Action:** Always verify that generic buttons in interruptive overlays include clear `aria-label`s and `outline-none focus-visible:ring-2` classes to maintain context and visible focus.
