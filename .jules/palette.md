# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2025-02-27 - Global Theme Toggle Accessibility
**Learning:** Global floating action buttons often miss keyboard focus rings and native hover tooltips due to custom styling. Redundant `aria-label` and `sr-only` text can also cause screen reader double-announcements.
**Action:** Always provide `outline-none focus-visible:ring-2` to floating buttons, use `title` for visual tooltips, and hide decorative icons with `aria-hidden="true"` while relying on `sr-only` for accessible names.
