# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-10-22 - Appending Screen Reader Context vs Overwriting Label

**Learning:** For elements with concise visible text (e.g., 'Skip'), overriding the text with `aria-label="Skip to next item"` violates WCAG 2.5.3 (Label in Name).
**Action:** Instead of `aria-label`, inject an inline `<span className="sr-only"> to next item</span>` directly after the visible text to naturally expand screen reader context.
