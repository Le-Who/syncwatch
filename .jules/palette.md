# Palette's Journal
## 2025-05-18 - Improve RoomSettingsDialog Accessibility
**Learning:** RoomSettingsDialog lacked basic standard modal aria tags and keyboard focus states on action buttons. Implementing `role="dialog"`, `aria-modal`, `aria-hidden` overlay, and `:focus-visible` styles ensures proper screen-reader compatibility and keyboard navigation.
**Action:** Always add semantic accessibility attributes to custom modal overlays and ensure interactive elements highlight properly via keyboard navigation across the app.
