# SyncTube Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring SyncWatch to SyncTube-level room, playlist, leader, media-add, and sync-readiness behavior.

**Architecture:** Preserve the existing server-authoritative Socket.IO/Redis OCC model. Add pure room mutations and schemas first, then wire commands, then update React UI and player reporting.

**Tech Stack:** Next.js 16, React 19, Zustand, Socket.IO, Redis CAS/Lua, Vitest, Playwright.

---

## File Structure

- Modify `lib/types.ts`: extend room settings, playlist items, and participant readiness fields.
- Modify `lib/zod-schemas.ts`: validate new slow-path commands.
- Modify `lib/room-logic.ts`: implement pure mutations for queue operations, leader, readiness, flashback, and rewind.
- Modify `lib/socket/commands.ts`: route new commands through existing CAS path and emit useful errors for denied mutations.
- Modify `lib/store.ts`: handle new server events and expose local queue composer helpers.
- Modify `lib/MediaApiService.ts`: return normalized provider, author, thumbnail, duration, aspect ratio, and start position.
- Create `lib/media-input.ts`: parse URLs, comma-separated lists, SyncTube-style numeric masks, YouTube playlist ids, and timestamps.
- Modify `components/Playlist.tsx`: replace duplicated add logic with the shared composer and add queue controls.
- Modify `components/AwaitingSignal.tsx`: use the same composer as Playlist.
- Modify `components/Participants.tsx`: fix role payloads and add owner transfer/leader controls.
- Modify `components/RoomSettingsDialog.tsx`: add leader and playlist behavior settings.
- Modify `components/Player.tsx`: send `media_ready`, duration updates, and flashback-safe transitions.
- Modify `app/room/[id]/page.tsx`: rework header/rail layout around central media input and tabs.
- Add tests in `__tests__/room-logic-synctube-parity.test.ts`.
- Add tests in `__tests__/media-input.test.ts`.
- Update component tests in `__tests__/components/Playlist.test.tsx` and `__tests__/components/Participants.test.tsx`.

## Tasks

### Task 1: Schema and Type Contracts

- [ ] Write failing tests in `__tests__/room-logic-synctube-parity.test.ts` for `set_next_item`, `toggle_item_temporary`, `shuffle_playlist`, `rewind`, `flashback`, `request_leader`, `release_leader`, `transfer_owner`, and `media_ready`.
- [ ] Write failing tests in `__tests__/media-input.test.ts` for comma lists, `${1-3}` masks, YouTube timestamps, and YouTube playlist id extraction.
- [ ] Extend `lib/types.ts` with the fields described in the design.
- [ ] Extend `lib/zod-schemas.ts` so new commands parse and old payloads remain valid.
- [ ] Run `pnpm vitest run __tests__/room-logic-synctube-parity.test.ts __tests__/media-input.test.ts`.

### Task 2: Pure Room Mutations

- [ ] Implement `lib/media-input.ts` helpers with no network calls.
- [ ] Implement the new room mutations in `lib/room-logic.ts`.
- [ ] Make role transfer explicit: owner can transfer ownership; former owner becomes moderator.
- [ ] Make leader commands respect roles and room settings.
- [ ] Make readiness reset when `currentMediaId` changes.
- [ ] Run `pnpm vitest run __tests__/room-logic-synctube-parity.test.ts __tests__/media-input.test.ts __tests__/zod-boundary.test.ts`.

### Task 3: Socket Command Integration

- [ ] Wire new slow-path commands through `applySlowCommand`.
- [ ] Emit `error` with stable messages when a command is denied by permission, duplicate URL, or full playlist.
- [ ] Preserve existing Redis PubSub and single-node broadcast behavior.
- [ ] Run `pnpm vitest run __tests__/server.test.ts __tests__/room-handler.test.ts __tests__/rpc_deadlock.test.ts`.

### Task 4: Shared Media Composer

- [ ] Move URL validation, metadata fetching, playlist expansion, and insert mode handling out of `Playlist.tsx`.
- [ ] Reuse the same composer in `AwaitingSignal.tsx`.
- [ ] Add "Add next" and "Add to end" controls.
- [ ] Add preview-first behavior for oEmbed/search results when available.
- [ ] Run component tests for playlist and awaiting signal behavior.

### Task 5: Player Readiness and Duration

- [ ] Send `media_ready` false when media changes and true after provider `onReady`.
- [ ] Send `update_duration` after duration is known.
- [ ] Reset readiness on auto-next, set-media, remove-current, and playlist clear.
- [ ] Keep current nonce ACK and drift correction behavior unchanged.
- [ ] Run `pnpm vitest run components/__tests__/Player.test.tsx lib/__tests__/playback-intent-manager.test.ts`.

### Task 6: Room UI Parity

- [ ] Rework `app/room/[id]/page.tsx` to a player-first room workspace with central media input.
- [ ] Update `Playlist.tsx` cards with set-next, temporary toggle, shuffle, clear, move, remove, and progress.
- [ ] Update `Participants.tsx` with fixed role payloads, owner transfer, leader state, readiness, and connected state.
- [ ] Update `RoomSettingsDialog.tsx` with playlist/leader behavior toggles.
- [ ] Keep responsive dimensions stable and verify mobile/desktop screenshots.

### Task 7: Verification

- [ ] Run `pnpm test`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] Start `pnpm dev` and run a Playwright smoke test with two pages in one room: create/join, add YouTube URL, readiness, play, pause, seek, next, role controls, reconnect.
- [ ] Record remaining limitations in `README.md` only if they are real deployment/runtime limits.
