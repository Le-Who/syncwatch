# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2026-09-22 - Central Overlay Controls Accessibility
**Learning:** Central overlay controls that mirror primary control bar functionalities (like play/pause) must synchronize their disabled states and conditional styling based on canControl props to provide visual feedback and prevent confusion. They also need accessible names (aria-label) and focus visibility.
**Action:** Always verify overlay interactive elements mirror the state and accessibility features of their primary control bar counterparts.
