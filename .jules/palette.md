# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-24 - Context Expansion for Screen Readers
**Learning:** Overwriting a button's content entirely using `aria-label` (like `aria-label="Skip to next item"` on a "Skip" button) can violate WCAG 2.5.3 (Label in Name) because the visible text ("Skip") is no longer part of the accessible name.
**Action:** Use an inline `<span className="sr-only"> to next item</span>` alongside the visible text for short, unambiguous action verbs instead of overriding the whole label.
