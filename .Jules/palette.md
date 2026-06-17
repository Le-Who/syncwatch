# Palette's Journal

## 2024-05-24 - Custom Dialog Accessibility
**Learning:** Framer Motion modal elements (e.g., `<motion.div>`) lack native dialog semantics by default, which causes screen readers to misinterpret them as standard page content instead of an isolated modal.
**Action:** When building custom modals, always explicitly apply `role="dialog"`, `aria-modal="true"`, an `aria-labelledby` attribute linking to the header, and `aria-hidden="true"` to background overlay elements.
