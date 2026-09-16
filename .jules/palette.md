# Palette's Journal

## 2024-05-18 - Central Overlay Controls Accessibility
**Learning:** Central overlay controls (like the PausedOverlay) that mirror primary control bar functionalities often miss critical accessibility attributes (like `aria-label` and `focus-visible`) and proper interaction states (`disabled`, `cursor-not-allowed`) because they are implemented as quick visual overlays rather than primary controls.
**Action:** When implementing or updating visual overlay buttons that control playback or other state, explicitly ensure they maintain the same `canControl` disabled logic, cursor styling, and keyboard focus visibility (`focus-visible:ring-4`) as the primary control bar to provide a consistent and accessible experience for all users.
