# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-24 - Accessible Full-Screen Clickable Overlays
**Learning:** Using generic `div` elements with `onClick` handlers for full-screen interactions traps keyboard users because they cannot focus or trigger the element.
**Action:** Always convert full-screen clickable `div`s into accessible buttons by adding `role="button"`, `tabIndex={0}`, keyboard event handlers (`onKeyDown` for Enter/Space), and visible focus indicators (`focus-visible:ring-2`).
