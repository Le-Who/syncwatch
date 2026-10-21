# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-05-24 - Semantic List Items
**Learning:** Interactive list items built with `<div onClick>` lack native keyboard navigation and proper semantics for screen readers. Using wrapper `aria-label`s can also overwrite text content.
**Action:** Convert interactive elements into semantic `<button type="button">` with `text-left outline-none focus-visible:ring-2`, and inject inline `<span className="sr-only">Play </span>` text before content to preserve natural screen reader reading flow.
