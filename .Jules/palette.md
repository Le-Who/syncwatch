# Palette's Journal

## 2026-05-02 - Keyboard Accessibility on Tailwind Hover States
**Learning:** In Tailwind CSS, complex interactive elements that use `group-hover` logic to display hidden menus must also use `group-focus-within` to ensure keyboard users tabbing through the UI can access those same menus.
**Action:** Whenever introducing `group-hover` variants for showing content, strictly pair them with corresponding `group-focus-within` variants to enforce accessibility standards.
