# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-11-12 - UpNextOverlay Accessibility Improvements
**Learning:** Dismiss buttons often lack aria-labels, decorative icons need aria-hidden, and brief text like 'Skip' needs contextual expansion for screen readers using inline .sr-only spans. Focus rings are also easily forgotten on secondary overlays.
**Action:** Always apply aria-label, aria-hidden, focus-visible:ring-2, and sr-only contextual spans to interactive elements in transient overlays like UpNextOverlay.
