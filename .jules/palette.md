# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-05-24 - Accessibility in Overlays and Modals

**Learning:** Interruptive overlays (like Reconnecting, UpNext, UserGestureGuard) often contain generic buttons or icon-only buttons that lack explicit accessibility attributes (aria-labels, outline-none focus-visible:ring-2), making keyboard navigation and screen reader usage difficult or confusing.
**Action:** Always verify that buttons inside overlays and modals maintain context with explicit `aria-label`s, `aria-hidden="true"` on descriptive icons next to text, and visible focus rings `outline-none focus-visible:ring-2` to support keyboard navigation.
