# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-18 - PausedOverlay Icon Button Accessibility
**Learning:** Icon-only buttons using `lucide-react` (like Play/Pause overlays) in this app often lack accessible names by default.
**Action:** Always verify and add `aria-label` attributes and keyboard focus styles (e.g., `focus-visible:ring-4 ring-theme-accent`) to these interactive media overlay elements.
