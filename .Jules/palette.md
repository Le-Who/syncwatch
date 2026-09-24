# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2026-09-24 - Interactive List Items
**Learning:** Using `div` with `onClick` for interactive playlist items breaks keyboard accessibility.
**Action:** Always use `<button type="button">` with `text-left`, `outline-none focus-visible:ring-2` for list items that function as buttons.
