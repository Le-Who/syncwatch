## 2025-04-06 - Interactive Element Visibility Keyboard Traps

**Learning:** When using Tailwind `group-hover` utilities to display hidden interactive elements (like custom volume sliders or speed setting dropdowns), keyboard users are completely locked out because they cannot trigger a hover state.
**Action:** Always strictly pair `group-hover` utilities with `group-focus-within` on the parent container when exposing interactive children. This ensures keyboard users can tab into the hidden element, making it visible and usable.
