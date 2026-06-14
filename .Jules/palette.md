# Palette's Journal

## 2024-06-14 - Custom Modal Dialog Accessibility

**Learning:** When building custom modal dialogs with framer-motion (`<motion.div>`), screen readers may not automatically announce them correctly without explicit ARIA roles. The background overlay must also be explicitly hidden from screen readers.
**Action:** Always ensure custom modals have `role="dialog"`, `aria-modal="true"`, an `aria-labelledby` linking to their title, and that the background overlay has `aria-hidden="true"`.
