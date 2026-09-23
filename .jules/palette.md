# Palette's Journal

## 2024-03-15 - Interruptive Overlays Require Accessible Controls

**Learning:** Interruptive overlays like "Up Next" often rely on icon-only generic dismiss buttons (like an "X") without accessible names or focus indicators, causing screen readers to lose context.
**Action:** Always verify icon-only buttons in new overlays have explicit `aria-label`s and `outline-none focus-visible:ring-2` to support keyboard and screen reader navigation.
