# SyncWatch

SyncWatch is a latency-tolerant, real-time, server-authoritative watch-party application. It coordinates synchronized media playback across multiple clients using an optimistic UI and strict server-side concurrency controls.

## Purpose

SyncWatch solves the problem of "pause loops", rubber-banding, and state drift during collaborative viewing over unreliable networks. It achieves this by combining client-side Optimistic Concurrency Control (OCC) with dynamic, continuous server clock synchronization, PID-style drift adjustment with hysteresis, and a comprehensive intent management system.

## Architecture & Core Modules

The system is designed for low-latency synchronization with eventual durability.

- **Frontend**: Next.js App Router, React 19, TailwindCSS v4, Zustand.
- **Backend (Gateway)**: A custom Node.js `server.ts` process hosts both the Next.js handler and Socket.IO.
- **Data Stores**:
  - _Redis_: The primary source of truth for high-frequency state. Used for Pub/Sub broadcasting, atomic OCC state mutations (via Lua scripts), and distributed locking.
  - _Supabase (PostgreSQL)_: Long-term durable storage of room configurations, playlists, and state snapshots.

### Synchronization Subsystem (The "Fast Path")

Playback mutations (`play`, `pause`, `seek`) are highly sensitive to latency. These commands bypass normal queues and hit Redis directly using a **Lua Script (`lib/redis-lua.ts`)**. This guarantees atomic Validate-and-Apply operations (OCC) that enforce version checks, ensuring that out-of-order client network packets cannot overwrite newer state.

### Inline CAS Mutations (The "Slow Path" & Auto-Switching)

Operations like `add_item`, `reorder_playlist`, and `video_ended` are handled by pure mutation functions in `lib/room-logic.ts`, applied inline within a CAS (Compare-And-Swap) retry loop in `commands.ts`.

- **Unified Concurrency Model**: All commands — both fast (Lua) and slow (CAS) — share the same OCC version check, eliminating the concurrency hole that existed when a separate async queue worker could race against the Lua fast path.
- **Database Synchronization**: State changes are applied to Redis first, then queued in a write-behind buffer (`lib/db-sync.ts`) to be flushed to Supabase. This shields the database from real-time websocket spam.
- **Auto-Switching**: When a provider (YouTube, Twitch, Vimeo) finishes playing the active media, `Player.tsx` immediately emits a `video_ended` command. The server processes this inline: if the room has `autoplayNext` enabled, it automatically advances to the next track in the playlist. If not, it pauses on the final frame. Loop logic (`looping` setting) is equally handled server-side.

### PlaybackIntentManager & Media Transitions

Because Native HTML5, YouTube iframe, and Twitch embed players fire lifecycle events asynchronously, the `PlaybackIntentManager` masks spurious native events from reaching the server.

- **Nonce-Based ACK Pipeline**: When the client emits a command (play/pause/seek), it records the command's nonce and blocks all native player events until the server echoes back a `room_state` containing the matching `lastActionNonce`. This deterministic approach replaces fragile wall-clock timers and works correctly at any network latency. A 3-second safety-net timeout covers lost packets.
- **Media Transitions**: When `currentMediaId` changes during auto-advancement, native iframes often fire a `pause` event during load. The intent manager employs a state-based media transition guard with an active 8-second auto-expiry timeout, ensuring stale guards never permanently block events even if `onReady` fails to fire.
- **User Scrubber Intent**: Dragging the seeker bar suppresses buffer/pause events protecting against "rubber-banding" server correction locks.
- **Selective Event Passthrough**: The `ignoreEventsFor` method accepts a `passThroughUserActions` flag, allowing deliberate user play/pause clicks to bypass post-seek ignore windows while still filtering programmatic events.
- **Twitch Phantom-Pause Guard**: Twitch's embed API fires asynchronous PAUSE events after seek operations. The intent manager detects these via a 500ms `isRecentSeek` window, preventing ghost pauses from corrupting sync state.

### Drift Correction & Hysteresis

The drift correction system (`lib/drift-math.ts`) uses hysteresis to prevent audible playback rate oscillation on YouTube. All thresholds are centralized in `lib/sync-config.ts` for single-location tuning. Rate correction starts at 0.6s and stops at 0.3s, avoiding rapid on/off toggling at the boundary. YouTube corrections are capped at ±3% to remain imperceptible to users.

### User Experience Enhancements

- **SyncStatusBadge**: A 5-state floating indicator (synced/syncing/drift/lost/offline) with smooth color transitions, a 2-second grace period after play transitions to eliminate false alarms, and an auto-hiding "In Sync ✓" pulse.
- **Disconnected Participant Dimming**: When a participant's socket drops, their avatar dims to 50% opacity with a red presence dot and "Reconnecting…" label within milliseconds, well before the 15-second cleanup removes them.
- **Scrubber Smoothing**: Progress bar uses CSS `transition: width 100ms linear` for compositor-level smoothing during rate correction, automatically disabled during active scrubbing for instant pointer tracking. `formatTime()` is throttled to ~1/s.
- **ReconnectingOverlay**: Shown when WebSocket disconnects, featuring auto-retry countdown and manual retry.
- **Toast Notifications**: Participant join/leave events shown via sonner toasts.
- **Keyboard Shortcuts**: Space (play/pause), M (mute), Arrow Left/Right (seek ±5s/±10s with Shift), Arrow Up/Down (volume ±5%), F (fullscreen), T (theater mode).
- **Double-Click Fullscreen**: Double-clicking the player area toggles fullscreen.

## Data & Control Flow

1. **Client Action**: User pauses the video. Client creates a unique nonce, optimistically updates local Zustand state, and emits a `pause` websocket command.
2. **Server Ingress**: `commands.ts` intercepts the event, validates it via Zod, and checks Redis rate limits.
3. **Atomic State Mutation**: The server executes the `LUA_FAST_MUTATION` script in Redis. If the client's known room version matches the server's version, the state is updated and the version increments.
4. **Broadcast**: The successful mutation is broadcast via Redis Pub/Sub to all connected clients across all horizontally scaled gateway nodes.
5. **Reconciliation**: Clients receive the broadcast. If the broadcast nonce matches their local optimistic nonce, they gracefully accept. If not, they experience an "OCC Rollback" and warp to the server's true state.
6. **Persistence**: The `db-sync` worker wakes up periodically and upserts the new room state from Redis into Postgres.

## Setup & Execution

### Prerequisites

- Node.js 20+
- Redis (Local or Upstash)
- Supabase instance

### Running the System

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Production build and run
pnpm run build
pnpm start
```

### Configuration Environment Variables

| Variable                    | Required | Description                                                  |
| --------------------------- | -------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`  | Yes      | URL of the Supabase instance.                                |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Admin key for server components to bypass RLS.               |
| `JWT_SECRET`                | Yes      | Cryptographic secret for signing session JWTs.               |
| `NEXT_PUBLIC_APP_URL`       | Yes      | Public bounds for CORS and YouTube origin.                   |
| `REDIS_URL`                 | No       | URI for Redis. System degrades gracefully to memory without. |
| `YOUTUBE_API_KEY`           | No       | Enables stable YouTube searches (bypasses scraper worker).   |

## Operational Notes & Limitations

- **Stateful Hosting Required**: SyncWatch relies on persistent WebSocket connections via Socket.IO. It **cannot** be hosted on traditional stateless serverless platforms (e.g., standard Vercel functions). It requires long-running Node.js processes (e.g., Render, Railway, AWS ECS).
- **Graceful Shutdown**: The service captures `SIGTERM` and `SIGINT` to definitively flush the Redis write-behind queue memory buffer to Postgres before dying. Do not kill processes with `SIGKILL` or recent playlist changes may be lost.
- **Provider API Quotas**: The system uses a headless worker script to scrape YouTube if the `YOUTUBE_API_KEY` quota exhausts. However, Twitch metadata entirely lacks an oEmbed fallback and relies on raw HTML parsing, which is brittle.
- **Browser Autoplay Policies**: Modern browsers aggressively block autoplay without user interaction. SyncWatch forces a "Initialize Stream Sync" confirmation click before mounting `react-player`.
- **Twitch Native Seek Quirks**: Due to an explicit constraint in the Twitch Embed API v1, scrubbing the native Twitch player timeline _always_ forces a `PAUSE` event. SyncWatch implements a multi-layered guard: the `PlaybackIntentManager` detects recent programmatic seeks via a 500ms `isRecentSeek` window and blocks these phantom pauses before they corrupt sync state.

## Testing Strategy

- **Unit/Integration (`npm run test:coverage`)**: Uses Vitest to test pure logic (Zod schemas, Drift Math, Redis Lua OCC behaviors).
- **E2E (`npx playwright test`)**: Tests full multi-browser web-socket synchronization workflows.

## Technical Debt & Improvement Backlog

- The `disconnect` handler cleanup delay (15s) is a UX trade-off: too short causes false removals on network blips, too long leaves stale entries. The 1s debounce on the dimming visual could be added if brief flickers prove noticeable.
- The 3-second join grace period means a new joiner may be ~3s out of sync initially. Rate correction still applies during the window.

## Fixed Issues Log

| Issue                     | File                                                                | Description                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync loop death           | `hooks/usePlaybackSync.ts`                                          | Early returns (`!getIsReady()`, `getSeeking()`, `isRecentCommand()`) exited `syncPlayback` without rescheduling `setTimeout`, permanently killing the sync loop. Fixed by rescheduling with 200ms retry on all early exits.                                                                                                            |
| Double room_state emit    | `lib/socket/commands.ts`                                            | Fast path success both emitted `room_state` directly to local sockets AND published via PubSub (which re-emitted). Clients on the same node received the event twice. Fixed with conditional logic: PubSub when Redis is available, direct emit as single-node fallback.                                                               |
| PubSub handler cross-fire | `lib/socket/pubsub.ts`                                              | Two separate `pmessage` handlers on the same ioredis subscriber caused both to fire on every message. The `room_events` handler lacked a prefix guard and would process `queue_wakeup` messages. Fixed by merging into a single handler with explicit `channel.startsWith()` routing.                                                  |
| Death pause feedback loop | `lib/store.ts`, `components/Player.tsx`, `hooks/usePlaybackSync.ts` | Three interacting bugs: (1) double nonce — `sendCommand` overwrote `emitCommand`'s nonce, breaking echo protection; (2) command-type/status-type mismatch in `markCommandEmitted`; (3) sync loop overrode user intent after 1.5s barrier expired. Fixed by removing duplicate nonce, normalizing types, and adding intent-aware guard. |
| Media transition deadlock | `lib/playback-intent-manager.ts`                                    | `setMediaTransition` could permanently block events if `onReady` never fired. Fixed with active 8-second auto-expiry `setTimeout`.                                                                                                                                                                                                     |
| Twitch phantom pause      | `components/Player.tsx`, `lib/playback-intent-manager.ts`           | Twitch embed fires asynchronous PAUSE after seek. Fixed with `isRecentSeek(500)` guard in `handleNativePause`.                                                                                                                                                                                                                         |
| OCC rollback flicker      | `hooks/usePlaybackSync.ts`                                          | Owner `sync_correction` broadcast echoed back and triggered a visible rollback. Fixed by tagging emissions with nonce via `markCommandEmitted`.                                                                                                                                                                                        |
| YouTube rate oscillation  | `lib/drift-math.ts`                                                 | Playback rate toggled rapidly when drift hovered at 0.5s boundary, causing audible pitch changes. Fixed with hysteresis (start=0.6s, stop=0.3s).                                                                                                                                                                                       |
| Stale wakeUp closure      | `components/Player.tsx`                                             | `wakeUp` function closed over stale `isSleeping` state, causing event listener churn on every render. Fixed by using `isSleepingRef` for stable identity.                                                                                                                                                                              |
| BufferingOverlay getState | `components/overlays/BufferingOverlay.tsx`                          | `BufferingOverlay` called `useStore.getState()` during render to read `updatedBy`, which is non-reactive. Fixed by using a Zustand selector hook.                                                                                                                                                                                      |
| Clock sync cold-start     | `lib/store.ts`                                                      | First `room_state` payload computed clock offset as 0 (RTT samples not yet collected), causing spurious hard seeks on join. Fixed by adding a `clockSyncReady` flag.                                                                                                                                                                   |
| Sequence capture race     | `lib/store.ts`                                                      | `sendCommand` read `sequence` before `set()` applied the increment, emitting stale values. Fixed by reading after state update.                                                                                                                                                                                                        |
| Double-seek in controlled | `hooks/usePlaybackSync.ts`                                          | Missing `return` after follower hard-seek caused code to fall through to the iframe-aware seek block, firing two seeks per sync cycle.                                                                                                                                                                                                 |
| Sync starvation on buffer | `hooks/usePlaybackSync.ts`                                          | Sync loop applied rate corrections to stalled player during buffering. Fixed with early-exit guard and hysteresis state reset.                                                                                                                                                                                                         |
| Cold-start ghost seek     | `hooks/usePlaybackSync.ts`, `components/Player.tsx`                 | Single-sample clock offset caused hard-seek within 1–3s of joining. Fixed with 3-second join grace period.                                                                                                                                                                                                                             |
| Pause debounce too short  | `components/Player.tsx`                                             | 50ms window missed YouTube's second-wave pause events at 60–100ms. Increased to 150ms.                                                                                                                                                                                                                                                 |
| Scrubber visual jitter    | `components/Scrubber.tsx`                                           | Raw 60fps progress bar updates caused wobble during rate correction. Fixed with CSS `transition: width 100ms linear` and `formatTime` throttled to 1/s.                                                                                                                                                                                |
| Badge false flash         | `components/SyncStatusBadge.tsx`                                    | Stale driftRef during pause→play caused false "Sync Lost" flash. Fixed with 2-second grace period after status transitions.                                                                                                                                                                                                            |
| Ghost participant window  | `lib/socket/connection.ts`, `lib/socket.ts`, `lib/store.ts`         | Disconnected participant remained fully visible for 15s cleanup window. Fixed with immediate `participant_disconnected` event + UI dimming.                                                                                                                                                                                            |
