# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-10-25 - Expand Context for Brief Button Text

**Learning:** Buttons with very brief visible text like 'Skip' lack context for screen reader users and can violate WCAG 2.5.3 if overwritten entirely by a full `aria-label`.
**Action:** Use inline `<span className="sr-only">` elements (e.g., `<span className="sr-only"> to next item</span>`) to naturally append contextual words without overwriting the visible label.
