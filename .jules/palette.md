# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-24 - Provide Semantic Context Without Overwriting Labels
**Learning:** For interactive overlay components containing multiple text parts, adding a generic `aria-label` (e.g. `aria-label="Skip to next"`) completely overwrites the inner text content, hiding the native elements from screen readers. This violates WCAG 2.5.3 (Label in Name) when the visible text is "Skip".
**Action:** Instead of wrapping with an `aria-label`, inject inline `<span className="sr-only"> to next item</span>` context blocks beside the visible text to naturally expand screen reader context without obscuring visible labels or breaking WCAG rules.
