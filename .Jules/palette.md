# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2025-02-23 - Accessibility in Interruptive Overlays

**Learning:** Components that interrupt the user flow or sit on top of the main UI (like 'Up Next' or 'Reconnecting' overlays) need explicit accessibility structures, as users may unexpectedly receive focus on elements like generic 'Skip' or 'Retry' buttons. If these buttons lack clear ARIA labels or focus rings, keyboard and screen reader users can get disoriented.
**Action:** Always verify overlay interactions have `aria-label` where context is missing (like a generic 'X' dismiss button) and `focus-visible:ring-2` to clearly highlight keyboard navigation state.
