# SyncWatch

SyncWatch is a latency-tolerant, real-time, server-authoritative watch-party application. It coordinates synchronized media playback across multiple clients using an optimistic UI and strict server-side concurrency controls.

## Purpose

SyncWatch solves the problem of "pause loops", rubber-banding, and state drift during collaborative viewing over unreliable networks. It achieves this by combining client-side Optimistic Concurrency Control (OCC) with dynamic, continuous server clock synchronization and PID-style drift adjustment.

## Architecture & Core Modules

The system is designed for low-latency synchronization with eventual durability.

- **Frontend**: Next.js App Router, React 19, TailwindCSS v4, Zustand.
- **Backend (Gateway)**: A custom Node.js `server.ts` process hosts both the Next.js handler and Socket.IO.
- **Data Stores**:
  - _Redis_: The primary source of truth for high-frequency state. Used for Pub/Sub broadcasting, atomic OCC state mutations (via Lua scripts), and distributed locking.
  - _Supabase (PostgreSQL)_: Long-term durable storage of room configurations, playlists, and state snapshots.

### Synchronization Subsystem (The "Fast Path")

Playback mutations (`play`, `pause`, `seek`) are highly sensitive to latency. These commands bypass normal queues and hit Redis directly using a **Lua Script (`lib/redis-lua.ts`)**. This guarantees atomic Validate-and-Apply operations (OCC) that enforce version checks, ensuring that out-of-order client network packets cannot overwrite newer state.

### Write-Behind Queue (The "Slow Path" & Auto-Switching)

Operations like `add_item`, `reorder_playlist`, and `video_ended` use a reliable background worker (`lib/redis-queue-worker.ts`). 
- **Database Synchronization**: State changes are applied to Redis first, then queued in a write-behind buffer (`lib/db-sync.ts`) to be flushed to Supabase. This shields the database from real-time websocket spam.
- **Auto-Switching**: When a provider (YouTube, Twitch, Vimeo) finishes playing the active media, `Player.tsx` immediately emits a `video_ended` command. The queue worker processes this intelligently: if the room has `autoplayNext` enabled, the worker automatically advances to the next track in the playlist. If not, it pauses on the final frame. Loop logic (`looping` setting) is equally handled server-side here.

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
npm install

# Start development server
npm run dev

# Production build and run
npm run build
npm start
```

### Configuration Environment Variables

| Variable                    | Required | Description                                                  |
| --------------------------- | -------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`  | Yes      | URL of the Supabase instance.                                |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Admin key for server components to bypass RLS.               |
| `JWT_SECRET`                | Yes      | Cryptographic secret for signing session JWTs.               |
| `APP_URL`                   | Yes      | Public bounds for CORS via Socket.io.                        |
| `REDIS_URL`                 | No       | URI for Redis. System degrades gracefully to memory without. |
| `YOUTUBE_API_KEY`           | No       | Enables stable YouTube searches (bypasses scraper worker).   |

## Operational Notes & Limitations

- **Stateful Hosting Required**: SyncWatch relies on persistent WebSocket connections via Socket.IO. It **cannot** be hosted on traditional stateless serverless platforms (e.g., standard Vercel functions). It requires long-running Node.js processes (e.g., Render, Railway, AWS ECS).
- **Graceful Shutdown**: The service captures `SIGTERM` and `SIGINT` to definitively flush the Redis write-behind queue memory buffer to Postgres before dying. Do not kill processes with `SIGKILL` or recent playlist changes may be lost.
- **Provider API Quotas**: The system uses a headless worker script to scrape YouTube if the `YOUTUBE_API_KEY` quota exhausts. However, Twitch metadata entirely lacks an oEmbed fallback and relies on raw HTML parsing, which is brittle.
- **Twitch Native Seek Quirks**: Due to an explicit constraint in the Twitch Embed API v1, scrubbing the native Twitch player timeline *always* forces a `PAUSE` event. SyncWatch implements a client-side micro-debounce (`TwitchPlayer.tsx` / `Player.tsx`) that catches this specific native auto-pause when seeking while playing, overriding it mathematically to maintain sync without trapping the room in pause-loops.

## Testing Strategy

- **Unit/Integration (`npm run test:coverage`)**: Uses Vitest to test pure logic (Zod schemas, Drift Math, Redis Lua OCC behaviors).
- **E2E (`npx playwright test`)**: Tests full multi-browser web-socket synchronization workflows.

## Technical Debt & Improvement Backlog

- Current integration tests require a live Redis instance. Consider adding an ephemeral in-memory redis-mock for CI pipelining robustness.
- `usePlaybackSync` drift parameters (`±15%` max) are currently hardcoded. They could be exposed as room settings for users on high-jitter networks.
