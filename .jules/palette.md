# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2023-10-24 - [Accessible Interruptive Overlays]
**Learning:** Interruptive UI overlays like 'Up Next' or 'Reconnecting' popups require explicit accessibility markers for their quick actions. Generic buttons ('Skip') without context, or icon-only buttons (Dismiss 'X') without aria-labels and focus-visible rings cause these critical popups to be effectively invisible or confusing to keyboard and screen-reader users.
**Action:** When creating or modifying interruptive popups/overlays, always include `aria-label`s on icon-only dismiss buttons, `outline-none focus-visible:ring-2` on all interactive elements to preserve visible focus rings, and use inline `<span className="sr-only">` within brief text buttons (e.g., 'Skip <span className="sr-only"> to next item</span>') to expand screen reader context safely.
