# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-11-06 - Icon-Only Button Polish
**Learning:** Floating action buttons and icon-only buttons need `title` attributes for sighted users on hover, and `lucide-react` icons require explicit `aria-hidden="true"` to prevent redundant screen reader announcements.
**Action:** Always add `title="[Action]"` and `aria-hidden="true"` to SVG icons in icon-only buttons, along with `focus-visible` classes for keyboard navigation.
