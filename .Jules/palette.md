# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-24 - Overlay Accessibility
**Learning:** Central overlay controls that mirror primary functionalities (like a big Play button) must accurately reflect their `disabled` state and have proper `aria-label`s, as they often lack accessible names.
**Action:** Ensure icon-only buttons in overlays have `aria-label`, conditional `disabled` states, and appropriate visual feedback (`cursor-not-allowed`) when disabled.
