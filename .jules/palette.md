# Palette's Journal

## 2024-05-24 - Screen Reader Compatibility in Framer Motion Modals
**Learning:** When building custom modal dialogs using framer-motion (`<motion.div>`), they do not inherently provide the semantic structure screen readers expect for dialogs, leading to poor accessibility for visually impaired users.
**Action:** Always explicitly add `role="dialog"`, `aria-modal="true"`, and an `aria-labelledby` attribute linking to the dialog's title on the main modal container. Additionally, add `aria-hidden="true"` to any background overlay elements and ensure focus rings are added for keyboard navigation using `ring-theme-accent outline-none focus-visible:ring-2`.
