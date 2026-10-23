# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-10-23 - Ephemeral Overlay Accessibility

**Learning:** Overlay dismiss buttons (like UpNext) and transient action buttons (like "Skip") are often missed during focus state audits and lack adequate screen reader context.
**Action:** Always ensure ephemeral popups provide `focus-visible` styles, descriptive ARIA labels for icon-only closes with `aria-hidden` icons, and `sr-only` context for brief generic actions.
