# Palette's Journal

## 2024-05-24 - Group Hover vs Focus Within in Tailwind
**Learning:** Tailwind `group-hover` accessibility pattern frequently fails keyboard users if not paired with `group-focus-within`. Elements hidden visually but required for interaction (like expanding volume sliders or playback speed menus) become completely inaccessible via Tab navigation.
**Action:** When using Tailwind named groups (e.g., `group/name` and `group-hover/name:flex`) to control the visibility of interactive children, strictly pair them with corresponding named focus variants (e.g., `group-focus-within/name:flex`) to ensure robust keyboard accessibility.
