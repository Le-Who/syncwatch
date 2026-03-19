## 2024-05-18 - Added systematic ARIA labels to custom video player controls

**Learning:** Custom video player controls, when stripped of their native HTML5 `<video controls>` structure, often miss essential accessibility markings like `aria-label` or `aria-expanded` (for menus like Quality settings). This is a common pitfall in web media players that negatively impacts screen-reader accessibility. Adding descriptive ARIA labels to all interactive icons in the player overlay greatly improves discoverability.
**Action:** When working on custom media controls or interactive icon-only overlays, make sure to add specific, context-aware `aria-label` and `aria-expanded` attributes. Also ensure a `focus-visible:ring` is clearly styled for keyboard tab-navigation visibility.
