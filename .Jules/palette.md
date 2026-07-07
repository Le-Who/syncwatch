# Palette's Journal
## 2025-02-15 - Improved RoomSettingsDialog accessibility
**Learning:** The custom modal dialog was missing proper ARIA roles and labels, which made it inaccessible to screen readers. Elements using the focus-visible outline utility need explicitly defined focus states.
**Action:** Explicitly set role="dialog" and aria-modal="true" with an aria-labelledby title mapping on custom dialog frames. Ensured interactive buttons use the standard tailwind focus styles to guarantee proper keyboard navigation support.
