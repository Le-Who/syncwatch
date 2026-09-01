# Palette's Journal

## 2024-05-24 - Missing aria-label on PausedOverlay Play Button

**Learning:** The central "Play" button overlay lacked an `aria-label`. Icon-only buttons, even large central ones, must explicitly state their purpose for screen readers.
**Action:** Added `aria-label="Play"` and `title="Play"` to the `<button>` element in `PausedOverlay.tsx`. Ensure all icon-only interactive overlays have accessible names.
