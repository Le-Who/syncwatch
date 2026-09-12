# Palette's Journal

## 2024-09-12 - Playlist Item Accessibility
**Learning:** Wrapping interactive list items in a `div` element with an `onClick` handler prevents keyboard navigation and lacks semantic meaning for screen readers.
**Action:** Always use semantic `<button type="button">` tags with appropriate focus visibility classes (e.g., `focus-visible:ring-2`) and `aria-label` attributes for interactive items like in Playlists.
