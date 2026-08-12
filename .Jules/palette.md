# Palette's Journal

## 2024-03-27 - [Add aria-label to stream URL input]
**Learning:** Found an input element missing a label or aria-label in AwaitingSignal.tsx, which is problematic for screen readers and accessibility. Placeholders do not replace explicit labels.
**Action:** Always add an explicit `aria-label` or `label` for inputs when an associated label element isn't visible, even if a placeholder is present.
