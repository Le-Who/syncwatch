# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2026-08-31 - Focus States in Transient Overlays

**Learning:** Transient UI components like `UpNextOverlay` often miss keyboard focus states (`focus-visible`) and ARIA labels on utility buttons (like "Dismiss").
**Action:** When working on temporary or floating overlays, explicitly verify keyboard navigation and accessible names for all interactive elements.
