# Palette's Journal

## 2024-09-18 - Semantic Tags for Interactive List Items
**Learning:** Found a `<div onClick>` wrapping the playlist item details, which is a common accessibility anti-pattern. This prevents keyboard navigation and lacks semantic meaning for screen readers.
**Action:** Always use semantic `<button type="button">` tags for interactive list items, ensuring proper focus states with `outline-none focus-visible:ring-2` and `text-left` alignment so text flows correctly instead of centering.
