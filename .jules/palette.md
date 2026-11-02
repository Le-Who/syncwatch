# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2023-10-25 - Expand Context for Brief Buttons & Fix Lucide Icons
**Learning:** Using `aria-label` on buttons with brief visible text (like 'Skip') overwrites the visible text for screen readers, which can violate WCAG 2.5.3 (Label in Name). Also, `lucide-react` icons are not hidden from screen readers by default, causing redundant announcements.
**Action:** Inject inline `<span className="sr-only">` elements beside visible text to naturally expand context, and manually apply `aria-hidden="true"` to decorative `lucide-react` icons. Ensure focus indicators (`outline-none focus-visible:ring-2`) are present on all interactive elements.
