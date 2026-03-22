# Palette's Journal

## 2024-05-19 - Actionable Empty States conditionally shown based on permissions

**Learning:** Empty states in collaborative applications (like shared playlists) often feel "broken" or confusing to users if they just state the empty condition (e.g., "Playlist is empty"). Users need clear, actionable guidance on _how_ to change that state (e.g., "Search or paste a media link above"). However, this call-to-action should only be visible to users who actually have the permission to perform that action (`canEdit`). Displaying action text to viewers without permissions can cause frustration.
**Action:** When designing empty states for collaborative interfaces, always include a helpful call-to-action conditionally rendered based on the user's current permissions.
