# SyncWatch - Production Ready

SyncWatch is a latency-tolerant, real-time, server-authoritative watch-party application. It uses Next.js for the frontend and a custom Node.js + Socket.io server to coordinate synchronized media playback.

## Architecture

- **Frontend**: Next.js (App Router), ReactPlayer, Tailwind, Zustand (State Management).
- **Backend**: Custom `server.ts` running Next.js alongside Socket.io, tightly integrated with `ioredis` for horizontal scaling via Pub/Sub, `redlock` for distributed atomic mutations, and an iterative Write-Behind Queue for Supabase persistence.
- **Security**: JWT-based WebSocket handshakes via `jose`, SSRF-protected metadata over `htmlparser2`, and Sliding Window Log rate limiters deployed globally across all APIs and Socket commands.
- **Frontend Optimization**: Zustand store decoupled from Socket.io via Singleton DI (`RoomSocketService`). High-frequency video drift synchronizations bypass React rendering completely using an uncontrolled `Scrubber.tsx` architecture and native `requestAnimationFrame`.
- **Dynamic Theme Engine**: CSS variables natively power seamless client-side toggling between the soft, luminous "Cotton Candy Glassmorphism" and the high-contrast "Cyber-Industrial Brutalist" interface.
- **Synchronization Model**: Server-authoritative with optimistic UI. Uses custom NTP-style packet handshakes on connect to calculate precise network latency, correcting local player timestamps appropriately. Stale event rejection blocks out-of-order websocket commands.
- **API Robustness & Type Safety**: Zod validation schemas and strict Promise racing (`AbortSignal`) globally protect external API fetches (YouTube/Vimeo) from malformed data. Circuit breaking and caching safeguard third-party APIs from abuse.
- **Persistence & Performance**: Database state is synchronized with **Supabase**. Playback snapshots are safely upserted via a periodic write-behind queue to survive server restarts, preventing database rate limits at scale. Unbounded memory arrays are guarded by strict capacity limiters (500 items/room).
- **Pro-Max UI/UX**: Includes a Glassmorphic Quality Selection Menu, synchronized floating emoji reactions, intelligent "Up Next" smart-buffer countdowns, and real-time inline progress bars tracking media consumption.
- **Metadata Resolver**: Background `/api/metadata` routes securely fetch and sanitize video titles from YouTube/Vimeo/Twitch over oEmbed protocols.

## Recent Stability & Sync Improvements

- **Audio Tearing Resolution**: Resolved Chromium audio resampling artifacts by widening the synchronization deadzone to `1.0s` and utilizing gentler `1.02x`/`0.98x` playback rate adjustments for minor drifts.
- **Multi-Browser Stability**: Implemented deterministic guest ID assignments in the Socket.io `io.use` middleware. Unauthenticated connections now safely receive a `guest_` session (unblocking the UI from freezing) while state-mutating commands are explicitly rejected.
- **Database UUID Validation**: Guaranteed all dynamically generated room IDs use strict 36-character UUIDv4 strings to satisfy the Postgres `uuid` schema requirements, eliminating `22P02` serialization errors during Supabase write-behind persistence.
- **Clean Server Logs**: Suppressed legacy `url.parse()` warnings (`DEP0169`) natively via `cross-env` `NODE_OPTIONS` injections.

## Database Setup (Supabase)

You must configure a Supabase project to persist room states.

1.  Create a new project on [Supabase.com](https://supabase.com/).
2.  Navigate to the **SQL Editor**, and run the entire contents of `supabase/migrations/00001_initial.sql`.
3.  Navigate to **Project Settings -> API** to get your URL and Keys.

### Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```env
NEXT_PUBLIC_SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-secret-service-role-key"
# Use the Service Role Key so the server can bypass RLS to persist global room data.
```

---

## Deployment Guide (Free Tier)

Because SyncWatch relies on **WebSockets** (Socket.io) embedded in a custom `server.ts` file, **it must be deployed to a provider that supports long-running Node.js processes**. Serverless function platforms (like Vercel) terminate connections quickly and do not natively support stateful WebSockets without external brokers.

### 1. Render (Recommended Free Tier)

Render offers a free Web Service tier perfectly suited for Node.js apps.

1.  Create a new **Web Service** on Render and connect your GitHub repository.
2.  **Build Command:** `npm install && npm run build`
3.  **Start Command:** `npm start` (This will safely use `tsx server.ts` as updated in `package.json`).
4.  **Environment Variables:** Add `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Set `NODE_ENV` to `production`.
5.  _Note: Render's free tier spins down after 15 minutes of inactivity. The Supabase persistence logic ensures rooms survive these restarts!_

### 2. Northflank (Alternative Free Tier)

Northflank provides generous developer tiers for stateful Docker/Node services.

1.  Create a new **Service** on Northflank.
2.  Select **Build from version control** and connect your repo.
3.  Choose the **Node.js** buildpack or define a raw Docker builder if needed.
4.  For the **Start Command**, ensure it targets `npm start`.
5.  Under **Environment**, add the required variables listed below.
6.  Ensure **Public Ports** are mapping port `3000` to HTTP.

#### Required Environment Variables for Northflank

To deploy successfully on Northflank, you must configure the following Environment Variables in your Service's **Environment / Secrets** tab:

**1. Database & Authentication (Essential)**

- `NEXT_PUBLIC_SUPABASE_URL`: The URL of your Supabase project.
  - _How to get it:_ Go to your Supabase Project -> Settings -> API -> Project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: The secret service role key to bypass RLS for server-side state persistence.
  - _How to get it:_ Go to your Supabase Project -> Settings -> API -> Project API Keys -> `service_role` (secret).
- `JWT_SECRET`: A long, random cryptographic string used to securely sign user session cookies.
  - _How to get it:_ Generate a random string using your terminal (`openssl rand -base64 32`) or a secure password generator. Do not use the default local secret in production.

**2. Application Routing (Essential)**

- `APP_URL`: The public-facing URL where your Northflank service will be accessible.
  - _How to get it:_ After creating your service on Northflank, look at the "Ports & DNS" tab in your service dashboard and copy the generated public webdomain URL (e.g., `https://syncwatch-app-xxxx.northflank.app`).

**3. Rate Limiting (Infrastructure)**

- `REDIS_URL` (or `UPSTASH_REDIS_REST_URL`): A Redis connection string required to prevent API abuse via rate limiting.
  - _How to get it:_ Create a new Redis **Addon** directly in Northflank. Once created, go to your Service -> Environment -> Linked Addons, and link the Redis addon. Northflank will automatically inject the connection details, or you can supply an external URI from Upstash.

**4. External Integrations (Optional but Recommended)**

- `YOUTUBE_API_KEY`: Used for the built-in YouTube search via official API (falls back to scraping if missing, but API is more stable).
  - _How to get it:_ Go to the [Google Cloud Console](https://console.cloud.google.com/), create a project, enable "YouTube Data API v3", and generate an API key under Credentials.
- `GEMINI_API_KEY`: Used for AI-related operations.
  - _How to get it:_ Obtain an API key from [Google AI Studio](https://aistudio.google.com/).

_(Note: `NODE_ENV` is set to `production` and `PORT` is mapped automatically by the Northflank Node.js buildpack.)_

### 3. Vercel (Not Recommended for WebSockets)

Vercel is a Serverless platform. While you _can_ deploy the frontend here, Vercel Serverless Functions will sever WebSocket connections after a few seconds or a minute.

**If you deeply need Vercel:**

1.  You must host the `server.ts` (Socket.io) logic elsewhere (e.g., Render/Railway).
2.  Remove custom `server.ts` from the Vercel branch, deploying only the standard Next.js build.
3.  Update the Socket.io client initialization in `lib/socket.ts` to hardcode the URL of your external Render server instead of using the local path.

## Local Development

```bash
npm install
npm run dev
# Server will start on http://localhost:3000 with hot-reloading.
```

## Testing Ecosystem (`systematic-debugging`)

SyncWatch comes pre-configured with a dual-layer testing environment to ensure regressions aren't shipped to production:

- **E2E Testing (Playwright)**: Located in `e2e/`. Tests visual implementations, DOM integrity, and simulated multi-client websocket synchronization.
- **Unit/Integration (Vitest)**: Located in `lib/` and configured via `vitest.config.ts`. Used for atomic functional testing of standalone logic blocks.

### Running Tests

```bash
# Run all E2E Tests (Requires local Next.js server to be running or bypassed)
npx playwright test

# Run Playwright UI for visual debugging
npx playwright test --ui
```

_Note: The local Next.js 13+ Dev Server strictly blocks WebSocket connections originating from 127.0.0.1 (Playwright's default headless runner origin) without explicit `allowedDevOrigins` bypasses. Local E2E tests executing socket-heavy actions may be skipped locally but will run successfully in CI/CD staging environments._

## Project Factual & Mental Map

### 1. Frontend Layer (Next.js APP Router & React 19)

- **App/Routing (`app/`)**: Manages routing, API endpoints (`api/metadata`), and root layouts.
- **UI Components (`components/`)**:
  - `Player.tsx`: Wraps `react-player`, handles low-level playback state and syncing with store.
  - `Playlist.tsx`: Manages video queue (maximum 500 items constraint).
  - `Participants.tsx`: Displays users and roles.
  - `ThemeProvider.tsx`/`ThemeToggle.tsx`: Manages custom CSS theme switching.
- **State Management (`lib/store.ts`)**: Zustand store managing room state, playback progress, and user info. Synchronizes natively with Socket.io events.

### 2. Backend Layer (Node.js & Socket.io)

- **Custom Server (`server.ts`)**: The architectural backbone. Holds in-memory multi-room states securely.
- **WebSocket Gateway**: Processes `command` and `join_room` events. Authoritative over playback rate, seeking, and playing/pausing to prevent desyncs. Guards against memory exhaustion (OOM).
- **Supabase Persistence**: `server.ts` debounces state persistence (2s loop) to Supabase tables (`rooms`, `playlist_items`, `playback_snapshots`).

### 3. Data Flow Pattern

1. Client action (e.g., Click Play in UI).
2. `useStore.sendCommand('play', payload)` fires the event to Socket.io.
3. `server.ts` receives event, validates permissions/limits securely.
4. `server.ts` mutates authoritative in-memory room state.
5. `server.ts` emits updated `room_state` back to all connected clients in the room.
6. Local Zustand store (`lib/store.ts`) updates; React re-renders globally.

## Targeted Test Coverage Strategy

Based on comprehensive systematic analysis, full coverage requires addressing the following identified gaps:

1. **Unit Testing (Vitest)**:
   - **Gaps**: `lib/store.ts` (critical state logic), `components/Player.tsx` (state mapping), `server.ts` (in-memory validation logic).
   - **Strategy**: Implement mock-driven Vitest files focusing on the AAA pattern (Arrange, Act, Assert). E.g. mocking `getSocket()` to verify Zustand store mutations. Include edge case testing (null payloads).
2. **Integration Testing**:
   - **Gaps**: Core socket message throughput (e.g., testing `add_items` deduplication logic and limits in `server.ts`).
   - **Strategy**: Set up local in-memory Socket.io server-client pairs to validate event handling boundaries safely.
3. **E2E Testing (Playwright)**:
   - **Current State**: Visuals and basic multi-client connect exist (`e2e/player.spec.ts`).
   - **Gaps**: Complex sync actions (buffering pauses, playback rate modifications, malicious payload testing).
   - **Strategy**: Extend Playwright test matrix to test specific error boundaries and UI recovery mechanisms.

_(Note: The agent relies on the local `skills/syncwatch-testing/SKILL.md` custom skill to rigorously drive TDD coverage across these layers for this project.)_
