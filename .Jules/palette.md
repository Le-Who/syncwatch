# Palette's Journal
## 2024-05-29 - Explicit ARIA Roles on Custom Motion Dialogs
**Learning:** Custom animation components like `motion.div` from Framer Motion are frequently used as modal dialogs but lack inherent semantic meaning. Without explicit ARIA roles, screen readers will not announce them correctly as dialogs.
**Action:** When building custom modal dialogs using components like `<motion.div>`, always explicitly add `role="dialog"`, `aria-modal="true"`, and an `aria-labelledby` attribute linking to an `id` on the dialog's title to ensure full screen reader compatibility.
