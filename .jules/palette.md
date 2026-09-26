# Palette's Journal

## 2024-05-18 - Semantic buttons for interactive list items
**Learning:** Using `div` with `onClick` for list items prevents keyboard navigation and lacks semantic meaning. Complex list items need a comprehensive `aria-label` to avoid disjointed screen reader announcements.
**Action:** Always use `<button type="button">` with alignment classes (e.g., `text-left`), `outline-none`, focus styles (`focus-visible:ring-2`), and a summarizing `aria-label` for interactive items.
