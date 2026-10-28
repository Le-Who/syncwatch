# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-10-28 - Accessible Clickable Overlays

**Learning:** Full-screen overlays using div elements with onClick handlers block keyboard users from activating them.
**Action:** Always add role="button", tabIndex={0}, onKeyDown (handling Enter and Space keys), aria-label, and outline-none focus-visible:ring-2 focus visibility classes to clickable div overlays to ensure keyboard accessibility.
