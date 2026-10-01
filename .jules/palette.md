# Palette's Journal

## 2024-05-30 - Accessible Semantic Interactive List Items
**Learning:** For complex interactive elements like custom dropdown list items or search results that contain multiple distinct text fragments (e.g., title, author, duration), screen readers can announce them as disconnected, confusing fragments if the parent container is a \`div\` without semantic meaning and missing a comprehensive summary.
**Action:** Always avoid wrapping interactive list items with \`div\` tags using \`onClick\`. Instead, convert non-interactive elements into semantic \`<button type="button">\` tags with \`outline-none focus-visible:ring-2\` for visible focus. Add a single, comprehensive \`aria-label\` on this parent interactive element summarizing all details to provide clear context for screen reader users.
