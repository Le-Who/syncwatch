## 2024-11-05 - [Up Next Overlay Accessibility]
**Learning:** For brief text buttons like 'Skip', using `aria-label` overwrites the visible text, violating WCAG 2.5.3. Lucide icons also do not hide themselves from screen readers by default.
**Action:** Inject inline `<span className="sr-only">` next to visible text to naturally expand screen reader context, explicitly add `aria-hidden="true"` to generic icons, and ensure focus indicators (`focus-visible:ring-2`) are added to all interactive elements.
