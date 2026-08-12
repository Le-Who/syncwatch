# Palette's Journal

## 2024-06-22 - Dialog Accessibility Pattern
**Learning:** Custom framer-motion modal dialogs (like RoomSettingsDialog) need explicit ARIA roles (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`) and hidden background overlays (`aria-hidden="true"`) to function correctly with screen readers, as the animation wrapper div doesn't provide these semantics out-of-the-box.
**Action:** When building custom modals, always include standard dialog ARIA attributes and ensure focus management on interactive elements.
