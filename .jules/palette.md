# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-11-07 - Overlay Button Accessibility
**Learning:** Overlay interactive elements like "Skip" and dismiss icons frequently lack proper keyboard focus rings, `aria-hidden` on decorative icons, and contextual clarity for screen readers.
**Action:** Always add `outline-none focus-visible:ring-2 ring-theme-accent` to overlay buttons, apply `aria-hidden="true"` to icons, and expand terse visible text (e.g. "Skip") with inline `<span className="sr-only">` elements.
