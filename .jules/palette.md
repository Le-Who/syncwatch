## 2025-02-12 - Decorative Icons Accessibility
**Learning:** `lucide-react` does not apply `aria-hidden="true"` by default. Decorative or generic icons (e.g., `<X />`, `<Play />`) inside buttons (whether icon-only with `aria-label` or containing text) need `aria-hidden="true"` to prevent redundant or confusing screen reader announcements.
**Action:** Always manually apply `aria-hidden="true"` to decorative icons inside buttons.
