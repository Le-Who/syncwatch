# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-24 - Improve Context for Brief Visible Text Buttons
**Learning:** For complex interactive elements or buttons with brief visible text (e.g., 'Skip'), wrapper `aria-label`s can overwrite and hide child content from screen readers, violating WCAG 2.5.3 (Label in Name).
**Action:** Inject inline `<span className="sr-only">` elements beside the visible text (e.g., `<span className="sr-only"> to next item</span>`) to naturally expand screen reader context without changing visible UI.
