# Palette's Journal
## 2024-06-15 - Modal Dialog Accessibility
**Learning:** Adding screen reader accessibility features to framer-motion components (`<motion.div>`) requires explicit `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` attributes as framer-motion does not add them automatically. Additionally, background overlays must have `aria-hidden="true"` to prevent screen readers from reading background content.
**Action:** When building custom modals or overlays with framer-motion, always include these three aria attributes on the modal container and `aria-hidden` on the backdrop.
