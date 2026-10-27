# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-10-27 - Screen Reader Context for Brief Action Buttons
**Learning:** Buttons with brief visual text like "Skip" can lack sufficient context for screen reader users, but adding a wrapper `aria-label` overrides the visible text (violating WCAG 2.5.3 Label in Name).
**Action:** Use inline `<span className="sr-only">` (e.g., `<span className="sr-only"> to next item</span>`) to expand the accessible name naturally without hiding the visible text from screen readers.
