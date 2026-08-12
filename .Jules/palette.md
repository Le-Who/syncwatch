## 2024-05-18 - Keyboard accessibility for hidden menus

**Learning:** Using `group-hover` utility classes to conditionally display interactive child elements (like menus or sliders) creates a keyboard accessibility trap if not paired correctly with focus states.
**Action:** When hiding interactive children, pair `group-hover` with `group-focus-within` on the hidden container, and ensure the parent has `group`. This ensures the element reveals itself upon keyboard tabbing, allowing keyboard users to access the content.
