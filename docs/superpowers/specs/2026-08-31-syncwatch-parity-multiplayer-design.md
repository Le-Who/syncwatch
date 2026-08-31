# SyncWatch Parity and Multiplayer UX Design

**Status:** Approved in chat on 2026-08-31, including the clarification that a room supports an arbitrary number of friends and that any subset of participants may have a degraded connection.

## Context

`main` is stable at the unit-test, lint, and build level, but its real-time behavior is not a coherent end-user product. In particular, playback commands do not have a functional in-memory fallback, participant lifecycle events are incomplete without Redis, some role actions send payloads that the server rejects, and a single client's buffering event can become the canonical state of the whole room.

`codex/synctube-parity` adds useful product behavior: a ReactPlayer v3-compatible player, queue operations, chat, readiness, leader controls, corrected role payloads, and an in-memory fast-command fallback. It is not safe to merge unchanged. Its end-to-end tests no longer match the UI, it retains the shared-buffering defect, removes command rate limiting, can render three media composers at once, and still has incomplete no-Redis presence behavior.

The implementation branch will therefore merge parity as an explicit integration checkpoint and then repair or remove the parts that do not satisfy this design.

## Product Goal

Friends can open one room, add a YouTube video, and watch it together with understandable controls and stable synchronization. Room semantics must not depend on there being exactly two participants. The same rules apply for 1, 3, 5, 25, or more participants, subject only to the deployment's resource capacity.

A participant with high latency, jitter, intermittent packet loss, a temporarily stalled player, or a disconnected browser must not pause, rewind, or otherwise degrade playback for healthy participants. When that participant recovers, their client converges to the current canonical timeline.

## Scope

The integration covers:

- YouTube URL entry, metadata fallback, queueing, playback, pause, seek, next, and late join.
- Multi-participant presence, roles, leadership, chat, readiness, reconnect, and owner handoff.
- A server-authoritative playback timeline with local buffering and provider-error recovery.
- Equivalent behavior with Redis configured and in the default single-node in-memory mode.
- Desktop and mobile UX, including touch-accessible controls.
- Deterministic unit, integration, and multi-client browser tests, plus a live YouTube smoke test.
- Focused operational and security corrections that prevent dependency, identity, or rate-limit defects from undermining the friend-room experience.

The integration does not add accounts, public room discovery, moderation workflows for strangers, DRM bypasses, synchronized advertisements, or a general-purpose video conferencing subsystem.

## Core Invariants

1. A room has one canonical media item and one canonical playback timeline.
2. Canonical playback states are `playing`, `paused`, and `ended`. `buffering` is never a canonical room state.
3. Readiness, buffering, provider errors, latency, drift, and connection health belong to an individual participant.
4. A participant-health event can update presence UI but cannot mutate the canonical timeline.
5. Every accepted playback mutation has a server-assigned monotonically increasing sequence, server timestamp, media ID, actor ID, and idempotency nonce.
6. A client ignores a playback update for an older sequence or a different media item.
7. Reconnecting and late-joining clients receive a current room snapshot and derive the current position from server time.
8. The Redis and in-memory paths run the same command policy and emit the same externally visible events.
9. A socket may mutate only the room it joined, and only as the participant bound to that socket.
10. No UI action fails silently. Rejected commands receive a stable error code and an understandable message.
11. No algorithm, permission rule, or test assumes that the room contains exactly two participants.
12. Full-room state is not broadcast for every progress or playback-health event; compact events keep bandwidth usable for larger rooms and weak connections.

## Control and Queue Policy

The default room remains friendly and low-ceremony:

- When there is no active leader, every connected participant may play, pause, or seek.
- When a leader is active, the leader, owner, and moderators may control playback. Viewers receive a visible rejection if they try.
- Any participant may request or claim leadership when there is no active leader.
- The leader may release leadership. The owner may replace an unavailable leader.
- Every participant may append media to the queue.
- Only the owner and moderators may remove, reorder, shuffle, clear, or directly select queue entries.
- Only the owner may change roles, transfer ownership, or remove a participant.
- The leader, owner, or a moderator may advance past an unavailable item.

The old `controlMode` values remain readable for persisted-room compatibility but do not define runtime permissions. One permission function is the source of truth for both server enforcement and client affordances.

## State Model

The room snapshot is composed from logical room state and ephemeral participant state.

```ts
type CanonicalPlaybackStatus = "playing" | "paused" | "ended";

interface CanonicalPlayback {
  mediaItemId: string | null;
  status: CanonicalPlaybackStatus;
  basePosition: number;
  baseTimestamp: number;
  rate: number;
  sequence: number;
  updatedBy: string;
  lastActionNonce?: string;
}

type ConnectionState = "connected" | "reconnecting" | "disconnected";
type PlaybackHealth = "idle" | "ready" | "buffering" | "error";

interface ParticipantRuntimeState {
  connection: ConnectionState;
  playbackHealth: PlaybackHealth;
  readyMediaId: string | null;
  lastSeen: number;
  lastDriftSeconds?: number;
}
```

Participant runtime state is useful for the People/readiness UI but is not persisted as durable playback truth. Existing persisted `buffering` playback values are normalized to `paused` during hydration. Existing rooms missing parity fields such as `chat`, `leaderId`, or `flashbacks` receive explicit defaults at the boundary.

## Architectural Boundaries

### Shared command contract

A single discriminated union defines command names, payloads, acknowledgement codes, and the command envelope. The client socket service, Zod validation, permission checks, in-memory application, Redis Lua adapter, and tests consume this contract instead of repeating string names and `any` payloads.

The envelope binds a command to the current room and participant:

```ts
interface RoomCommandEnvelope<C extends RoomCommand = RoomCommand> {
  roomId: string;
  command: C;
  nonce: string;
  clientSequence: number;
}

interface CommandAcknowledgement {
  nonce: string;
  status: "applied" | "ignored" | "rejected";
  code?: string;
  message?: string;
  roomSequence?: number;
}
```

### Room command service

One service owns validation, room binding, permission enforcement, idempotency, mutation, persistence scheduling, and event publication. Transport handlers do not contain a second implementation of room policy.

Fast playback commands use a compact atomic mutation in Redis and the same pure mutation function in memory. Slow queue, role, leader, and chat commands use versioned room mutation. Last-writer-wins is an explicit playback policy; documentation must not describe it as optimistic conflict rejection.

### Room repository

The repository exposes get, compare-and-set, atomic playback mutation, expiry, and persistence scheduling. Redis and in-memory implementations conform to the same interface. In-memory room mutations are serialized per room so concurrent commands cannot overwrite each other.

### Room event bus

All room events go through one event bus with local and Redis-backed adapters. Publishing an event always reaches sockets on the current node. Redis additionally propagates the same event to other nodes without causing duplicate local delivery.

Supported events include compact `playback_updated`, snapshot `room_state`, and participant lifecycle/health events. Pub/sub handling must be exhaustive for the shared event union.

### Playback coordinator

The client playback coordinator owns provider-event suppression, server clock offset, drift calculation, soft correction, hard seek, local buffering recovery, and stale-event rejection. React components provide a small player adapter and display coordinator state; they do not independently emit room commands for every provider callback.

### Connection lifecycle owner

One connection owner registers and unregisters Socket.IO listeners, performs session establishment, joins a room, acknowledges reconnect, and requests a fresh snapshot. React remounts cannot accumulate duplicate global listeners.

## Event and Data Flow

### Join and presence

1. The client establishes or reuses a server-issued participant session.
2. `join_room` validates bounded room ID and nickname values.
3. The server adds or reconnects the participant through the room command service.
4. The joining client receives a full sanitized snapshot.
5. Every existing client receives a compact joined/reconnected event through the event bus in both Redis and in-memory deployments.
6. Disconnect immediately marks the participant as reconnecting. A grace timer prevents tab refreshes from creating leave/join churn.
7. Reconnect within the grace period preserves role and leadership and cancels cleanup.
8. After the grace period, the server removes the participant and emits `participant_left`.

If the owner leaves permanently, ownership transfers deterministically to the longest-present connected moderator, otherwise the longest-present connected viewer. If the leader leaves permanently, leadership is released. These transitions are included in the emitted state and do not depend on object iteration after a role has already been changed.

### Playback command

1. A controller performs a user gesture.
2. The client emits one command with a nonce and its observed position.
3. The server validates room binding and permissions, applies the mutation, assigns canonical sequence/timestamp, and acknowledges the command.
4. The event bus broadcasts a compact playback update.
5. Each client converts server time to its local clock and reconciles its provider.
6. Provider callbacks produced by that reconciliation are recognized as intent echoes and do not generate a second command.

### Local buffering and degraded connections

When a player's provider fires waiting/buffering, the client sets only its own playback health and may publish ephemeral health telemetry. Healthy clients continue against the canonical timeline.

When the player becomes playable again, the client fetches or uses the newest canonical update, computes the current target position, and applies the normal drift policy. A stale queued event from before a reconnect cannot roll the room or client backward because its sequence is older.

Small drift is corrected without a visible jump when the provider supports rate adjustment. Large drift, a late join, or recovery from a long stall uses a hard seek. The thresholds remain centralized and provider-aware. Health telemetry is rate-limited and coalesced so a weak client cannot flood a larger room.

### Media failure

An embed failure is local because videos may be blocked by region, account state, or provider policy for only one participant. The affected client sees the failed title and actions to retry or reinitialize sync. Owner, moderator, and leader also see Skip, which sends a normal authorized queue command. One client's provider error never automatically skips or pauses media for everyone.

Metadata failure does not prevent adding a valid YouTube URL. The queue uses a safe fallback title and preserves the original URL.

## User Experience

### Room entry

The home page uses human-readable copy for creating or joining a room while retaining the visual identity. A generated room link remains unguessable. Joining requires a bounded nickname and provides actionable connection errors.

### Media composition

There is one visible media composer at a time. In an empty room it appears in the player placeholder; after media exists it moves to the queue surface or drawer. Desktop and mobile never show duplicate composers. YouTube URLs are the primary path; search and playlist import are secondary conveniences.

### Player

The first-gesture requirement is explicit and shown once per browser/provider initialization. Native YouTube controls remain available where ReactPlayer cannot provide equivalent reliable control. Direct-media custom controls are visible and operable on touch, keyboard, and pointer devices.

The sync badge communicates useful states such as synced, catching up, reconnecting, or local buffering. It does not expose raw drift as the only explanation and does not suggest that another participant's buffering paused the room.

### People, readiness, and leadership

The People panel always converges to the same participant count on every healthy client. It distinguishes connected, reconnecting, and disconnected-grace states. Role and leader actions appear only when permitted and display server rejection if state changed concurrently.

Readiness is advisory. The UI can show `4/6 ready`, but one unready or slow participant never blocks play automatically. Friends may choose socially when to start.

### Queue and chat

Queue operations have optimistic feedback only when they can be reconciled with acknowledgement; otherwise the server snapshot remains authoritative. Duplicate URLs and full-queue errors are visible. Chat messages are bounded, sanitized through React text rendering, ordered by server time, and capped in room state.

## Merge Strategy

1. Preserve `main` as the audited base and keep the user's existing staged deletion outside the worktree.
2. Merge `codex/synctube-parity` into `codex/syncwatch-ux-audit` as a traceable integration checkpoint.
3. Run parity's unit, lint, and build baselines before behavioral edits.
4. Add failing tests for each audited defect before changing production behavior.
5. Keep parity's useful queue, chat, leader, permission, media-adapter, and mobile work.
6. Replace shared buffering, duplicated composition, stale E2E helpers, incomplete lifecycle broadcasting, and silent command rejection.
7. Keep commits cohesive so parity integration, synchronization fixes, UX fixes, networking tests, and operational hardening can be reviewed separately.

## Testing Strategy

### Unit and contract tests

- Permission matrices cover rooms with 1, 3, 5, and 25 participants and do not use fixed host/viewer assumptions.
- Pure room mutations cover every command, unauthorized attempts, stale media IDs, duplicate nonces, and owner/leader departure.
- Playback coordinator tests cover provider echoes, monotonic sequences, clock offset, late join, local buffering recovery, and stale events after reconnect.
- Event-bus contract tests run the same lifecycle scenarios against in-memory and fake Redis adapters; a disposable real Redis instance verifies Lua and pub/sub behavior end to end.
- Schema tests enforce bounded IDs, nicknames, URLs, queue sizes, chat text, and command envelopes.

### Socket integration tests

- Five clients join and every client observes all five participants.
- Playback commands in a leaderless room reach all clients.
- With a leader, viewer commands are rejected while leader and owner/moderator overrides succeed.
- One or more reconnecting clients preserve identity and do not duplicate participants.
- Permanent owner departure elects one deterministic successor and leaves exactly one owner.
- Redis-disabled and Redis-adapter suites assert the same emitted event sequence.

### Browser E2E

Playwright runs room tests serially against unique room IDs. Stable page objects and accessible names replace assertions tied to obsolete tab copy.

The deterministic browser matrix includes:

- Five independent browser contexts joining the same room.
- YouTube add, initialize, play, pause, seek, and queue-next propagation.
- Late join while the room is playing.
- One high-latency client while four healthy clients continue.
- Two clients with changing latency to model jitter.
- Short offline bursts to model packet loss and a longer disconnect/reconnect.
- Local buffering on one client while canonical state remains playing.
- Owner departure, leader departure, role changes, chat, and participant-count convergence.
- Desktop and 390-pixel mobile layouts with exactly one visible composer.

Chromium network emulation supplies latency and offline bursts. Lower-level transport tests deliberately delay, drop, duplicate, and reorder events so correctness does not depend on browser emulation faithfully modeling every packet.

### Live provider smoke

A headed smoke test uses a real embeddable YouTube URL and at least three independent browser contexts. It requires a user gesture per context, verifies that play/pause/seek converge within provider-appropriate tolerances, stalls or disconnects one context, and confirms the other contexts keep playing. External metadata or advertising requests may fail without failing the core smoke if the video itself initializes and synchronization works.

## Operational and Security Corrections

Functional and UX correctness is implemented first, but the integration must not ship known low-effort hazards:

- Update direct dependencies or safe overrides for the audited Next.js, Socket.IO parser/engine, PostCSS, and related advisories, then rerun the complete suite.
- Isolate or remove vulnerable `yt-search` transitive paths where a maintained version or direct YouTube API/fallback can provide the required UX.
- In production, require an explicit JWT secret. Never log raw tokens or full rejected payloads.
- The session endpoint issues participant IDs server-side instead of signing an arbitrary claimed ID. Existing valid sessions remain reconnectable.
- Bind commands to the socket's joined room and participant.
- Restore command rate limiting in parity, correct 60-millisecond windows to 60 seconds, and provide a bounded in-memory fallback when Redis is absent.
- Trust forwarded IP headers only through configured deployment boundaries.
- Correct `.env.example` so a publishable Supabase key is not labeled as a service-role key, and align the README Node requirement with `package.json`.

## Acceptance Criteria

The work is acceptable only when all of the following are demonstrated on the integration branch:

1. Unit tests, lint, production build, and type checks exit successfully.
2. Multi-client E2E passes serially with five clients and no stale selectors.
3. A live three-client YouTube smoke demonstrates play, pause, seek, late/reconnect convergence, and continued playback while one client is degraded.
4. Local buffering never changes canonical playback to buffering and never pauses healthy clients.
5. Presence converges in both Redis and no-Redis modes, including reconnect and deterministic owner handoff.
6. Permission UI and server enforcement use the same policy and rejected actions are visible.
7. Exactly one media composer is visible on desktop and mobile.
8. No new code assumes a two-person room; participant-count tests cover multiple N values.
9. Dependency audit results and any intentionally accepted residual advisories are documented with reachability and trade-offs.
10. The final diff preserves unrelated user changes and is reviewed for critical and important findings before integration into `main` is offered.
