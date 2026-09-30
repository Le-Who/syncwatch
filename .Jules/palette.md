# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-05-25 - Comprehensive ARIA labels for complex list items
**Learning:** Complex interactive elements (like playlist items or custom dropdowns) with multiple distinct text fragments cause screen readers to read disjointed, confusing fragments.
**Action:** Provide a single, comprehensive aria-label on the parent interactive element summarizing all details, and always use semantic button tags over divs for onClick handlers.
