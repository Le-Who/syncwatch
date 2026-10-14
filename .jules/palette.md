# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-10-14 - Accessibility in Interruptive Overlays

**Learning:** Interruptive overlays (like "Up Next" or "Reconnecting") often have brief or icon-only buttons (like "Skip", "Retry", or "X") that lack necessary screen-reader context or keyboard focus visibility. Furthermore, descriptive icons beside visible text redundantly announce their generic names if not hidden.
**Action:** Always add explicit `aria-label`s to icon-only buttons, inject inline `<span className="sr-only">` elements for brief visible text, apply `aria-hidden="true"` to descriptive icons beside text, and ensure interactive elements have `outline-none focus-visible:ring-2` to maintain visible keyboard focus.
