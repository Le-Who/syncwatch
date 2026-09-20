# Palette's Journal

## 2024-05-19 - Accessible Interruptive Overlays

**Learning:** Interruptive UI states that overlay the core player (e.g., 'Up Next', 'Reconnecting', 'Sleep Mode') often lack proper semantic structure and visual keyboard focus for their interactive elements (dismiss buttons, custom click targets).
**Action:** Always verify that generic interactive elements (like 'Skip', 'Retry Now', or full-screen click targets) use appropriate semantic attributes (`role="button"`, `tabIndex`, `onKeyDown`) and include explicit `outline-none focus-visible:ring-2` focus styling to maintain accessibility context during disruptive state changes.
