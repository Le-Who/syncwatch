# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-05-25 - Interactive List Items in Playlists
**Learning:** Using div tags with onClick for playlist items breaks keyboard navigation and semantic meaning.
**Action:** Always use semantic <button type="button"> with text-left and focus-visible classes for clickable list items.
