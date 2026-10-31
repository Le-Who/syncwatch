# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-05-24 - Accessible Clickable Overlays
**Learning:** Using structural `div` elements as clickable overlays breaks keyboard navigation and screen readers because they lack interactive semantics, trapping keyboard users.
**Action:** Always add `role="button"`, `tabIndex={0}`, keyboard event handlers (handling 'Enter' and ' ' with `e.preventDefault()`), `aria-label`, and `focus-visible:ring-2` styles when converting non-interactive elements into actionable overlays.
