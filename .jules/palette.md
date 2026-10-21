# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-24 - Accessible Clickable Overlays
**Learning:** Full-screen interruptive overlays (like Sleep Mode) that use `onClick` on a generic `<div>` trap keyboard users because they cannot be focused or activated via keyboard.
**Action:** Always add `role="button"`, `tabIndex={0}`, an `onKeyDown` handler (for Enter/Space), and `outline-none focus-visible:ring-2` to clickable `<div>` overlays.
