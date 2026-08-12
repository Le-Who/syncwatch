# Palette's Journal
## 2024-05-18 - Accessibility on framer-motion Dialogs
**Learning:** Custom UI modal dialogs built with framer-motion `<motion.div>` lack inherent semantic meaning, making them invisible or unclear to screen readers by default.
**Action:** Always add `role="dialog"`, `aria-modal="true"`, and link an `aria-labelledby` ID to the dialog's title element when building custom modals to ensure proper screen reader compatibility.
