# Palette's Journal

## 2024-05-18 - Semantic Tags and Focus Visibility on Overlays and Lists
**Learning:** Interruptive UI overlays and general interactive list items (like the Reconnecting Overlay, Up Next Overlay, and Playlist items) often suffer from accessibility regressions when using non-semantic tags (like `<div onClick>`) or lacking explicit labels and focus styling for keyboard navigation.
**Action:** Always ensure that generic icon buttons (e.g. skip/dismiss) and overlay actions have explicit `aria-label`s and `outline-none focus-visible:ring-2` focus styling. For interactive list items, convert them to semantic `<button type="button">` tags while adding alignment classes (e.g., `text-left`) to maintain the intended layout flow.
