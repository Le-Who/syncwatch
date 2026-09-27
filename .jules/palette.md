# Palette's Journal

## 2024-09-27 - Icon-only close buttons in transient overlays need explicit ARIA labels and focus rings
**Learning:** Icon-only dismiss buttons inside popups or transient overlays (like "Up Next") are frequently missed by screen readers without `aria-label` attributes and are difficult to operate for keyboard users without `focus-visible:ring` styles.
**Action:** Always verify that every interactive button inside an overlay has a distinct `aria-label` and `outline-none focus-visible:ring-2` to support both screen readers and keyboard navigation users.
