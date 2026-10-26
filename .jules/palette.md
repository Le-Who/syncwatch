# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.
## 2024-05-25 - Screen Reader Context for Brief Button Text
**Learning:** Overwriting a brief button's text (like 'Skip') with a wrapper `aria-label` hides the child content and violates WCAG 2.5.3. Keyboard-accessible components also frequently miss visible focus rings.
**Action:** Always inject inline `<span className="sr-only">` elements to expand context (e.g., `<span className="sr-only"> to next item</span>`), and use Tailwind's `outline-none focus-visible:ring-2` to ensure keyboard navigation visibility.
