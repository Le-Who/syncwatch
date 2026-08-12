# Palette's Journal

## 2025-04-08 - Keyboard Traps in Hover-Revealed Elements
**Learning:** Using Tailwind `group-hover` utility classes to conditionally display interactive child elements (like menus or sliders) without a corresponding focus variant prevents keyboard users from accessing or knowing those elements exist, creating an accessibility barrier.
**Action:** Always pair `group-hover` variants with `group-focus-within` on the interactive child container when that container holds focusable elements. This ensures the element reveals itself upon keyboard tabbing.
