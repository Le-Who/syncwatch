# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-24 - Overlays Accessibility Enhancements
**Learning:** Interruptive overlays (like Up Next, Reconnecting) often lack semantic attributes and focus visibility on interactive elements.
**Action:** Always verify generic buttons (like 'Skip', 'Retry', or icon-only dismiss buttons) inside overlays include clear aria-labels and outline-none focus-visible:ring-2 classes to maintain context and visible focus.
