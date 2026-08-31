# SyncTube Parity Design

## Goal

Bring SyncWatch to the functional standard observed in sync-tube.de while keeping SyncWatch's stronger server-authoritative OCC/Redis sync core.

## Reference Findings

The current sync-tube.de production app is a Vue/Vite SPA. Room creation uses `POST /api/create`, join uses `POST /api/join`, and room state is streamed over a per-room WebSocket such as `/ws/<room>/<token>`. The initial payload contains room identity, owner, users with ready state, chat config, playlist config, player state, and permissions.

Media adding is intentionally lightweight: the top-bar input builds an oEmbed preview first. Clicking the preview sends a WebSocket media request; the server broadcasts the accepted media item, the client lazy-loads the provider player, then reports readiness and duration. The server emits frequent time updates. The public Haxe SyncTube repo uses the same core idea: a single server timer, explicit leader permissions, playlist commands, readiness before initial playback, flashback/rewind, and queue operations.

## Product Direction

SyncWatch should not copy SyncTube's protocol verbatim. Its Redis CAS/Lua fast path, OCC versions, nonce ACKs, clock-sync, and drift hysteresis are better suited to larger rooms. The parity work should add the missing product behaviors:

- Fast room entry with a central media input and an empty-room state that behaves like the normal queue composer.
- Explicit leadership/host affordances on top of the existing role model.
- Queue operations for "add next", "add to end", "set next", "shuffle", "clear", and multi-link/mask expansion.
- Participant readiness and duration reporting so the server can avoid starting or switching media before clients have loaded enough metadata.
- Flashback and relative rewind commands to recover from accidental seeks or jumps.
- A calmer, denser room UI closer to sync-tube.de: player-first layout, top media input, right-side playlist/chat/participants tabs, share/settings in the header, and clear permission feedback.

## Server Model

Extend `RoomSettings` with playlist behavior flags and host-control affordances:

- `leaderId`: participant currently driving playback in controlled sessions.
- `playlistMode`: append-only or editable ordering behavior.
- `shuffle`: whether automatic advancement chooses randomized next items.
- `requestLeaderOnPause` and `unpauseWithoutLeader`: small-group convenience toggles matching SyncTube's proven UX.

Extend `PlaylistItem` with:

- `isTemporary`: removed after it plays when enabled.
- `requesterId`: stable participant id, not only display nickname.
- `readyParticipants`: map of participant ids that reported the current media ready.
- `aspectRatio` and `author` when metadata can provide them.

Add slow-path commands:

- `add_items` with `insertMode: "next" | "end"` and server-side URL de-duplication.
- `set_next_item`, `shuffle_playlist`, `toggle_item_temporary`.
- `media_ready`, `update_duration`, `rewind`, `flashback`.
- `request_leader`, `release_leader`, and `transfer_owner`.

Fast playback commands remain server-authoritative. A client can optimistically update only after creating a nonce; the server is still the source of truth.

## Client Model

Keep Zustand as the room state cache, but normalize command helpers:

- `sendCommand` remains the only outbound command path.
- Media input parsing moves to reusable utilities so `Playlist` and `AwaitingSignal` do not duplicate behavior.
- The player reports `media_ready` and `update_duration` after provider readiness.
- The room page surfaces leader ownership, ready state, current playback owner, and permission status without modal-only discoverability.

## UI

Use a watch-party workspace layout instead of a novelty terminal style:

- Fixed header: brand, share, central media input, room controls.
- Player stage: large video surface with title and compact sync controls below.
- Right rail: tabs for Playlist, Chat, and People.
- Playlist cards: thumbnail, provider, title, duration, requester, progress, move up/down, set next, temporary toggle, remove.
- People list: role, readiness, connected/disconnected state, owner/mod controls.

The UI remains responsive: player first on mobile, rail below with tabs. Text must not overflow buttons or cards.

## Error Handling

Invalid media input returns a local validation error before sending. Metadata failures still allow adding a playable URL with fallback title. Permission-denied no-ops should emit user-visible server errors. Duplicate URLs should surface as queue feedback, not silent no-ops.

## Testing

Add focused Vitest coverage for pure room mutations and schemas before implementation. Extend component tests for playlist controls and participant role management. Run the existing server/room-handler tests after each server change and run a browser smoke test against the local app after UI work.
