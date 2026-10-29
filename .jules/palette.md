# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-10-29 - Enhanced accessibility on UpNext Overlay

**Learning:** Using wrapper `aria-label`s on buttons with brief visible text (like "Skip") can overwrite and hide child content from screen readers (violating WCAG 2.5.3). Additionally, Lucide icons do not have `aria-hidden="true"` by default.
**Action:** Inject inline `<span className="sr-only">` elements beside the visible text to naturally expand screen reader context, manually apply `aria-hidden="true"` to decorative icons, and explicitly provide focus indicators using `outline-none focus-visible:ring-2`.
