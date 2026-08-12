# Palette's Journal

## 2024-05-06 - Accessible Custom Dialogs
**Learning:** Custom framer-motion modal dialog components lack inherent semantic meaning for screen readers and can easily hide their interactive controls from keyboard users.
**Action:** When building custom modal dialogs, always ensure the container has `role="dialog"`, `aria-modal="true"`, and an `aria-labelledby` linking to the dialog's title. Additionally, explicitly provide standard focus rings (`ring-theme-accent outline-none focus-visible:ring-2`) to all close and action buttons to maintain a consistent keyboard navigation path.
