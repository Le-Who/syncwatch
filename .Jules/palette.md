## 2024-03-14 - Dynamic ARIA labels for toggle buttons
**Learning:** Found an accessibility issue pattern where icon-only toggle buttons lacked screen-reader context about their state. Adding dynamic `aria-label` (e.g., "Open menu" vs "Close menu") and `aria-expanded` significantly improves usability for assistive technologies in these interactive components.
**Action:** Always include `aria-expanded` and state-dependent `aria-label`s for interactive toggle components that only use icons.
