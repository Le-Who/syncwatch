# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-05-15 - Interruptive Overlays Accessibility

**Learning:** Interruptive UI overlays (like Up Next or Reconnecting states) often contain generic buttons (e.g., 'Skip', 'Retry', 'Dismiss' icon) that lack proper accessibility structures (like clear `aria-label`s or focus rings) because they rely heavily on visible timing or state context.
**Action:** Always verify interactive elements in overlays include explicit `aria-label`s, natural `sr-only` inner text, and `outline-none focus-visible:ring-2 focus-visible:ring-offset-2` classes to maintain keyboard and screen reader accessibility, even if they are temporary or auto-dismissing.
