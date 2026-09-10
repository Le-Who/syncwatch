# Palette's Journal
## 2024-05-18 - Synchronize Central Overlays with Control Bars
**Learning:** Icon-only central overlays (like `PausedOverlay`) often lack accessible names. Additionally, they must accurately mirror the disabled state logic from the primary control bar to prevent misleading users into thinking they have playback controls when they do not.
**Action:** Always verify `aria-label`s on icon-only overlay components. Always pass and check `disabled` states synchronously across main control bars and their associated central overlays (e.g., using a single `canControl` prop), ensuring both visual styles (`opacity-50`, `cursor-not-allowed`) and HTML properties (`disabled`) reflect this reality.
