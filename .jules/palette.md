# Palette's Journal

## 2024-05-18 - Overlay Control States Synchronization
**Learning:** Large, central overlay controls (like the PausedOverlay play button) often lack the state synchronization found in the primary control bar. They are incorrectly active and missing accessibility descriptors when the user lacks control permissions, causing confusion and frustration.
**Action:** When implementing or updating central overlays that mirror player controls, always synchronize `disabled` states and conditional opacity/cursor styling based on `canControl` props to match the main control bar, and ensure they have accurate ARIA labels and focus visibility since they act as primary interactive elements.
