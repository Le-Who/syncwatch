# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2023-10-21 - Expand Brief Button Text Contextually
**Learning:** For interactive elements with brief visible text (like 'Skip'), using a wrapper aria-label can overwrite and hide the visible text from screen readers, violating WCAG 2.5.3 (Label in Name).
**Action:** Inject inline <span className="sr-only"> elements beside the visible text to naturally expand screen reader context without removing the original text node.
