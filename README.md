# SyncWatch

SyncWatch is a latency-tolerant, real-time, server-authoritative watch-party application. It coordinates synchronized media playback across multiple clients using an optimistic UI and server-ordered concurrency controls.

## Purpose

SyncWatch solves the problem of "pause loops", rubber-banding, and state drift during collaborative viewing over unreliable networks. It combines nonce-correlated optimistic client intents with server-ordered last-writer-wins playback, dynamic continuous clock synchronization, PID-style drift adjustment with hysteresis, and a comprehensive intent management system.

## Architecture & Core Modules

The system is designed for low-latency synchronization with eventual durability.

- **Frontend**: Next.js App Router, React 19, TailwindCSS v4, Zustand.
- **Backend (Gateway)**: A custom Node.js `server.ts` process hosts both the Next.js handler and Socket.IO.
- **Data Stores**:
  - _Redis_: The primary source of truth for high-frequency state. Used for Pub/Sub broadcasting, atomic server-ordered state mutations (via Lua scripts), distributed locking, and shared rate limits. When Redis is unavailable, SyncWatch uses bounded process-local rate limits and in-memory room state; that mode is suitable for development or degraded single-process operation, not consistent multi-instance enforcement.
  - _Supabase (PostgreSQL)_: Long-term durable storage of room configurations, playlists, and state snapshots.

### Synchronization Subsystem (The "Fast Path")

Playback mutations (`play`, `pause`, `seek`) are highly sensitive to latency. These commands bypass normal queues and hit Redis directly using a **Lua Script (`lib/redis-lua.ts`)**. The script atomically validates current server-side permissions and applies each accepted command in server arrival order. Playback therefore follows server-ordered last-writer-wins semantics; command nonces make retries idempotent without trusting a client-supplied room version.

### Inline CAS Mutations (The "Slow Path" & Auto-Switching)

Operations like `add_item`, `reorder_playlist`, and `video_ended` are handled by pure mutation functions in `lib/room-logic.ts`, applied through the repository's serialized CAS (Compare-And-Swap) transaction in `lib/room-command-service.ts`.

- **Unified Concurrency Model**: Fast commands are atomically ordered in Lua, while slow commands use a serialized CAS transaction that reloads permissions and room state after conflicts. Both paths remain server-authoritative and preserve every accepted command without requiring a client version.
- **Database Synchronization**: State changes are applied to Redis first, then queued in a write-behind buffer (`lib/db-sync.ts`) to be flushed to Supabase. This shields the database from real-time websocket spam.
- **Auto-Switching**: When a provider (YouTube, Twitch, Vimeo) finishes playing the active media, `Player.tsx` immediately emits a `video_ended` command. The server processes this inline: if the room has `autoplayNext` enabled, it automatically advances to the next track in the playlist. If not, it pauses on the final frame. Loop logic (`looping` setting) is equally handled server-side.

### PlaybackIntentManager & Media Transitions

Because Native HTML5, YouTube iframe, and Twitch embed players fire lifecycle events asynchronously, the `PlaybackIntentManager` masks spurious native events from reaching the server.

- **Nonce-Based ACK Pipeline**: When the client emits a command (play/pause/seek), it records the command's nonce and blocks native player echoes until the server returns a compact `playback_updated` carrying the matching `lastActionNonce`. This deterministic approach replaces fragile wall-clock timers and works correctly at any network latency. A 3-second safety-net timeout covers lost packets.
- **Media Transitions**: When `currentMediaId` changes during auto-advancement, native iframes often fire a `pause` event during load. The intent manager employs a state-based media transition guard with an active 8-second auto-expiry timeout, ensuring stale guards never permanently block events even if `onReady` fails to fire.
- **User Scrubber Intent**: Dragging the seeker bar suppresses buffer/pause events protecting against "rubber-banding" server correction locks.
- **Selective Event Passthrough**: The `ignoreEventsFor` method accepts a `passThroughUserActions` flag, allowing deliberate user play/pause clicks to bypass post-seek ignore windows while still filtering programmatic events.
- **Twitch Phantom-Pause Guard**: Twitch's embed API fires asynchronous PAUSE events after seek operations. The intent manager filters recent programmatic seeks and commands with `isRecentProgrammaticSeek` and `isRecentCommand`, preventing ghost pauses from corrupting sync state.

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
3. **Atomic State Mutation**: The server executes `LUA_FAST_MUTATION` in Redis. The script revalidates the current permission snapshot and atomically applies accepted playback commands in server arrival order; no client room version decides the winner.
4. **Broadcast**: The successful mutation is broadcast via Redis Pub/Sub to all connected clients across all horizontally scaled gateway nodes.
5. **Reconciliation**: Clients receive the compact playback update. A matching nonce acknowledges the local intent; a different newer sequence reconciles the player to the server-authoritative timeline.
6. **Persistence**: The `db-sync` worker wakes up periodically and upserts the new room state from Redis into Postgres.

## Setup & Execution

### Prerequisites

- Node.js 24+
- Redis (Local or Upstash; optional for local/degraded single-process operation)
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

| Variable                    | Required   | Description                                                                                                                     |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`  | Yes        | URL of the Supabase instance.                                                                                                   |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes        | Admin key for server components to bypass RLS.                                                                                  |
| `JWT_SECRET`                | Production | Cryptographic secret for signing session JWTs; startup fails in production when absent.                                         |
| `ALLOW_LEGACY_SOCKET_TOKEN` | No         | Temporarily enables browser-readable session tokens and signed legacy Socket.IO authentication during a rolling migration. |
| `NEXT_PUBLIC_APP_URL`       | Production | Canonical HTTP(S) origin used for Socket.IO CORS/origin enforcement and YouTube origin.                                         |
| `REDIS_URL`                 | No         | URI for Redis. Without it, limits and room state are bounded and process-local; deploy Redis for shared production enforcement. |
| `TRUST_PROXY`               | No         | Set to `true` only when a trusted proxy overwrites forwarded headers; otherwise direct peer addresses are used.                 |
| `YOUTUBE_API_KEY`           | No         | Enables stable YouTube searches (bypasses scraper worker).                                                                      |

## Operational Notes & Limitations

- **Stateful hosting required**. SyncWatch uses Socket.IO long-polling to open a room connection and upgrades to WebSocket when available. A proxy must preserve the public `Host` matching `NEXT_PUBLIC_APP_URL` and forward WebSocket upgrades. When multiple gateways are deployed, configure session affinity on `/socket.io/` so all polling requests for an Engine.IO session reach the same gateway. Redis shares room state and events across gateways.
- **Graceful Shutdown**: The service captures `SIGTERM` and `SIGINT` to definitively flush the Redis write-behind queue memory buffer to Postgres before dying. Do not kill processes with `SIGKILL` or recent playlist changes may be lost.
- **Provider API Quotas**: The system uses a headless worker script to scrape YouTube if the `YOUTUBE_API_KEY` quota exhausts. However, Twitch metadata entirely lacks an oEmbed fallback and relies on raw HTML parsing, which is brittle.
- **Browser Autoplay Policies**: Modern browsers aggressively block autoplay without user interaction. SyncWatch forces a "Initialize Stream Sync" confirmation click before mounting `react-player`.
- **Twitch Native Seek Quirks**: Twitch can emit asynchronous `PAUSE` events after timeline changes. SyncWatch uses the `PlaybackIntentManager` to recognize recent programmatic seeks and commands and filter these phantom pauses before they affect shared playback.
- **Session and origin boundary**. The app receives a random server-issued identity and a 30-day HttpOnly, `SameSite=Lax` cookie. Socket.IO uses the cookie for normal joins and reconnects. An explicit live recovery requests a 30-second, room-specific proof for the existing connection. In production the gateway checks the canonical origin and admits an originless polling GET only with same-origin browser metadata and the configured public host. Deploy TLS at the proxy and enable `TRUST_PROXY` only when that proxy sanitizes forwarding headers.
- **Legacy session migration**. Set `ALLOW_LEGACY_SOCKET_TOKEN=true` on all gateways while old browser bundles or supported cookie-less clients still need the legacy signed-token protocol. Cookie-less clients must continue to send the configured canonical origin. After those clients migrate, unset the flag across all gateways to keep new session credentials in HttpOnly cookies and require a scoped proof for live upgrades.
- **Rate-limit behavior**: Auth/session is limited to 10 requests per 60 seconds, metadata/search to 20 per 60 seconds, playlists to 10 per 60 seconds, room joins to 50 per 60 seconds, and commands to 60 per 10 seconds. Rejected commands receive a nonce-correlated `RATE_LIMITED` acknowledgement and are not retried or snapshot-refreshed automatically.
- **Dependency boundary**: YouTube fallback searches execute in a worker with a timeout to contain failed or slow scraping. That boundary limits one request's work but is not a blanket security guarantee; keep `yt-search` and its dependency tree under audit and prefer the YouTube API key path for production traffic.

## Testing Strategy

- **Unit and integration tests (`pnpm test`)**: Vitest runs deterministic tests including fast-path command logic with a Redis test double. Suites that need disposable services skip by default.
- **E2E (`npx playwright test`)**: Tests full multi-browser web-socket synchronization workflows.

The production Lua suite runs compare-and-swap, permission races and playback
commands against a disposable Redis database. Set `SYNCWATCH_TEST_REDIS_URL`
to opt in.

```bash
pnpm exec cross-env SYNCWATCH_TEST_REDIS_URL=redis://127.0.0.1:6379/15 vitest run __tests__/integration/fast-path-redis.test.ts
```

Other Redis integration tests require `REDIS_URL`. The persistence queue suite also
requires `SYNCWATCH_TEST_DB_SYNC_REDIS=1` and an empty, disposable Redis database:
the real worker enumerates the pending queue. Its database RPC is a controlled
test boundary; it does not write to Supabase.

```bash
pnpm exec cross-env REDIS_URL=redis://127.0.0.1:6379/15 SYNCWATCH_TEST_DB_SYNC_REDIS=1 vitest run __tests__/integration/db-sync-redis.test.ts
```

The Supabase concurrency suite requires a separate disposable database with
the repository migrations applied. Its fixture needs `DELETE` on
`public.rooms` for the test service role, in addition to the grants in the
migrations. Set `SYNCWATCH_TEST_DB_DEADLOCK=1`, `SYNCWATCH_TEST_SUPABASE_URL`,
and `SYNCWATCH_TEST_SUPABASE_SERVICE_ROLE_KEY` in the process environment, then
run `pnpm exec vitest run __tests__/rpc_deadlock.test.ts`.

## Technical Debt & Improvement Backlog

- The `disconnect` handler cleanup delay (15s) is a UX trade-off: too short causes false removals on network blips, too long leaves stale entries. The 1s debounce on the dimming visual could be added if brief flickers prove noticeable.
- The 3-second join grace period means a new joiner may be ~3s out of sync initially. Rate correction still applies during the window.

## Fixed Issues Log

| Issue                        | File                                                                | Description                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync loop death              | `hooks/usePlaybackSync.ts`                                          | Early returns (`!getIsReady()`, `getSeeking()`, `isRecentCommand()`) exited `syncPlayback` without rescheduling `setTimeout`, permanently killing the sync loop. Fixed by rescheduling with 200ms retry on all early exits.                                                                                                            |
| Double room_state emit       | `lib/socket/commands.ts`                                            | Fast path success both emitted `room_state` directly to local sockets AND published via PubSub (which re-emitted). Clients on the same node received the event twice. Fixed with conditional logic: PubSub when Redis is available, direct emit as single-node fallback.                                                               |
| PubSub handler cross-fire    | `lib/socket/pubsub.ts`                                              | Two separate `pmessage` handlers on the same ioredis subscriber caused both to fire on every message. The `room_events` handler lacked a prefix guard and would process `queue_wakeup` messages. Fixed by merging into a single handler with explicit `channel.startsWith()` routing.                                                  |
| Death pause feedback loop    | `lib/store.ts`, `components/Player.tsx`, `hooks/usePlaybackSync.ts` | Three interacting bugs: (1) double nonce — `sendCommand` overwrote `emitCommand`'s nonce, breaking echo protection; (2) command-type/status-type mismatch in `markCommandEmitted`; (3) sync loop overrode user intent after 1.5s barrier expired. Fixed by removing duplicate nonce, normalizing types, and adding intent-aware guard. |
| Media transition deadlock    | `lib/playback-intent-manager.ts`                                    | `setMediaTransition` could permanently block events if `onReady` never fired. Fixed with active 8-second auto-expiry `setTimeout`.                                                                                                                                                                                                     |
| Twitch phantom pause         | `components/Player.tsx`, `lib/playback-intent-manager.ts`           | Twitch embed fires asynchronous PAUSE after seek. Fixed with `isRecentProgrammaticSeek` / `isRecentCommand` guards in `handleNativePause`.                                                                                                                                                                                                                         |
| Stale-state rollback flicker | `hooks/usePlaybackSync.ts`                                          | Owner `sync_correction` broadcast echoed back and triggered a visible rollback. Fixed by tagging emissions with nonce via `markCommandEmitted`.                                                                                                                                                                                        |
| YouTube rate oscillation     | `lib/drift-math.ts`                                                 | Playback rate toggled rapidly when drift hovered at 0.5s boundary, causing audible pitch changes. Fixed with hysteresis (start=0.6s, stop=0.3s).                                                                                                                                                                                       |
| Stale wakeUp closure         | `components/Player.tsx`                                             | `wakeUp` function closed over stale `isSleeping` state, causing event listener churn on every render. Fixed by using `isSleepingRef` for stable identity.                                                                                                                                                                              |
| BufferingOverlay getState    | `components/overlays/BufferingOverlay.tsx`                          | `BufferingOverlay` called `useStore.getState()` during render to read `updatedBy`, which is non-reactive. Fixed by using a Zustand selector hook.                                                                                                                                                                                      |
| Clock sync cold-start        | `lib/store.ts`                                                      | First `room_state` payload computed clock offset as 0 (RTT samples not yet collected), causing spurious hard seeks on join. Fixed by adding a `clockSyncReady` flag.                                                                                                                                                                   |
| Sequence capture race        | `lib/store.ts`                                                      | `sendCommand` read `sequence` before `set()` applied the increment, emitting stale values. Fixed by reading after state update.                                                                                                                                                                                                        |
| Double-seek in controlled    | `hooks/usePlaybackSync.ts`                                          | Missing `return` after follower hard-seek caused code to fall through to the iframe-aware seek block, firing two seeks per sync cycle.                                                                                                                                                                                                 |
| Participant-local buffering  | `lib/playback-health.ts`, `hooks/usePlaybackSync.ts`                | Provider stalls update only that participant's health. Healthy friends keep following canonical playback; the recovering client catches up by provider-aware rate correction or a hard seek to current server time.                                                                                                                    |
| Cold-start ghost seek        | `hooks/usePlaybackSync.ts`, `components/Player.tsx`                 | Single-sample clock offset caused hard-seek within 1–3s of joining. Fixed with 3-second join grace period.                                                                                                                                                                                                                             |
| Pause debounce too short     | `components/Player.tsx`                                             | 50ms window missed YouTube's second-wave pause events at 60–100ms. Increased to 150ms.                                                                                                                                                                                                                                                 |
| Scrubber visual jitter       | `components/Scrubber.tsx`                                           | Raw 60fps progress bar updates caused wobble during rate correction. Fixed with CSS `transition: width 100ms linear` and `formatTime` throttled to 1/s.                                                                                                                                                                                |
| Badge false flash            | `components/SyncStatusBadge.tsx`                                    | Stale driftRef during pause→play caused false "Sync Lost" flash. Fixed with 2-second grace period after status transitions.                                                                                                                                                                                                            |
| Ghost participant window     | `lib/socket/connection.ts`, `lib/socket.ts`, `lib/store.ts`         | Disconnected participant remained fully visible for 15s cleanup window. Fixed with immediate `participant_disconnected` event + UI dimming.                                                                                                                                                                                            |
