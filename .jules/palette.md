# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-24 - Screen Reader Redundancy in Text Buttons
**Learning:** Buttons containing both visible text and an icon can cause screen readers to redundantly announce the icon's generic name alongside the text (e.g. 'Refresh Retry Now').
**Action:** Always apply `aria-hidden="true"` to decorative or descriptive icons when they accompany visible text inside a button.
