# Palette's Journal

## 2024-05-18 - Synchronize Overlay Controls
**Learning:** Icon-only overlay controls (like the central Play button) must have synchronized disabled states, ARIA labels, and visual feedback that match the permissions (`canControl`) of the primary control bar to avoid confusing non-authorized users.
**Action:** Always add `aria-label`, bind `disabled={!canControl}`, add `outline-none focus-visible:ring-2`, and conditionally apply styling for cursor and opacity on all interactive elements in overlay components.
