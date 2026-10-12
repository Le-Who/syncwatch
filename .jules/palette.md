# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-10-12 - Interruptive Overlay Accessibility
**Learning:** Generic buttons (e.g., 'Skip', 'Retry', 'Initialize Stream Sync') and icon-only dismiss buttons in interruptive overlays (like Up Next, Reconnecting, UserGestureGuard) often lack explicit focus indicators (`focus-visible:ring-2`) and screen reader context (`aria-label` or inline `.sr-only` text), reducing accessibility for keyboard and screen reader users during critical UI interruptions.
**Action:** Always verify that interactive elements within interruptive overlays include clear focus visibility classes (`outline-none focus-visible:ring-2`), and ensure that brief visible text or icon-only buttons are supplemented with `aria-label` or inline `<span className="sr-only">` elements to expand screen reader context naturally.
