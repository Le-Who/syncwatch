# Palette's Journal
## 2024-05-24 - Accessibility Labels in Dialogs
**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-06-25 - Accessibility Keyboard Navigation in Dialogs and Custom Toggles
**Learning:** Certain custom UI elements like the `<motion.button>` ThemeToggle and standard buttons inside `RoomSettingsDialog.tsx` lack clear focus states out-of-the-box in this codebase, which makes keyboard navigation difficult to follow.
**Action:** Always add keyboard focus styles (`focus-visible:ring-2 focus-visible:ring-theme-accent focus:outline-none`) to these elements to provide clear visual feedback to keyboard users without impacting mouse users.
