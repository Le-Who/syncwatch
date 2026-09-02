# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-25 - Accessibility in Play/Dismiss Overlays
**Learning:** Icon-only overlay buttons (like the Play button in PausedOverlay or the Dismiss button in UpNextOverlay) lack screen reader names and visible focus states by default.
**Action:** Always add `aria-label`, `aria-hidden="true"` to the icon, and `focus-visible:ring-*` classes to ensure keyboard and screen-reader accessibility for floating overlay controls.
