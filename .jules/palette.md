# Palette's Journal

## 2024-05-24 - Accessibility Labels in Dialogs

**Learning:** Modal close buttons using generic `<X />` icons lack accessible names by default in this component library.
**Action:** Always verify icon-only buttons inside dialogs/modals have appropriate `aria-label` attributes.

## 2024-06-03 - Interruptive Overlay Accessibility

**Learning:** Overlays that interrupt the user's flow (like Reconnecting, Up Next, or User Gestures) are easy to miss during accessibility audits because they only appear under specific conditions (network loss, end of stream). Their buttons frequently lack focus indicators or ARIA labels (for icon-only dismiss buttons), making them a trap for keyboard and screen reader users when they unexpectedly take over the screen.
**Action:** When working on interruptive full-screen or modal overlays, explicitly verify that every interactive element has `outline-none focus-visible:ring-2` focus management and clear ARIA descriptions if they lack visible text.
