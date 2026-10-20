# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2025-01-22 - Expanding Screen Reader Context Without `aria-label` Overwrites
**Learning:** For interactive elements with brief visible text (like "Skip"), adding a generic `aria-label="Skip to next item"` violates WCAG 2.5.3 (Label in Name) by entirely overwriting the child text content, preventing screen readers from announcing the visible text. Furthermore, redundant icons in buttons (like `<RefreshCw>` in "Retry Now") are unnecessarily announced by screen readers if not hidden.
**Action:** Instead of `aria-label`, inject inline `.sr-only` elements beside visible text (e.g., `<span className="sr-only"> to next item</span>`) to naturally expand context while preserving the visible name. Always apply `aria-hidden="true"` to decorative or redundant icons within text buttons.
