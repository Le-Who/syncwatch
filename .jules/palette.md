# Palette's Journal

## 2023-10-27 - [Interactive List Item Accessibility]
**Learning:** In the `Playlist` component, interactive list items were wrapped in a `div` with an `onClick` handler. This anti-pattern prevents keyboard navigation (tabbing) and lacks semantic meaning for screen readers.
**Action:** Always use native semantic HTML like `<button type="button">` for interactive elements to ensure automatic keyboard support (`outline-none` and `focus-visible:ring-2`) and screen reader compatibility.
