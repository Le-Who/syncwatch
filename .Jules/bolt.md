
## 2024-07-01 - Prevent unnecessary re-renders via Zustand useShallow
**Learning:** Destructuring directly from `useStore()` without a granular selector subscribes components to the entire store. In an app where some state (like `serverClockOffset` or `commandSequence`) updates very frequently, this causes unnecessary re-renders of unrelated components.
**Action:** Always wrap Zustand store selections returning multiple properties in `useShallow` (from `zustand/react/shallow`) or use granular individual selectors to limit re-renders strictly to when the needed properties change.
