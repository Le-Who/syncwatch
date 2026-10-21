# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-05-24 - Interruptive Overlay Accessibility

**Learning:** Interruptive overlays (like Up Next, Reconnecting, User Gesture Guards) often lack explicit accessibility structures for their interactive elements, breaking keyboard navigation and screen reader context.
**Action:** Always verify generic buttons (like 'Skip', 'Retry', or icon-only dismiss buttons) in overlays include clear `aria-label`s, context-expanding `.sr-only` text, and `outline-none focus-visible:ring-2` classes to maintain context and visible focus.
