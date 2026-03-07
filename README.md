# SyncWatch - Production Ready

SyncWatch is a latency-tolerant, real-time, server-authoritative watch-party application. It uses Next.js for the frontend and a custom Node.js + Socket.io server to coordinate synchronized media playback.

## Architecture

- **Frontend**: Next.js (App Router), ReactPlayer, Tailwind, Zustand (State Management).
- **Backend**: Custom `server.ts` running Next.js alongside Socket.io.
- **Dynamic Theme Engine**: CSS variables natively power seamless client-side toggling between the soft, luminous "Cotton Candy Glassmorphism" and the high-contrast "Cyber-Industrial Brutalist" interface.
- **Synchronization Model**: Server-authoritative with optimistic UI. Uses custom NTP-style packet handshakes on connect to calculate precise network latency, correcting local player timestamps appropriately. Stale event rejection blocks out-of-order websocket commands.
- **Persistence & Performance**: Database state is synchronized with **Supabase**. Playback snapshots are safely upserted to survive server restarts or inactive hibernation. All database syncs perform highly optimized 2-second debouncing per-room to prevent rate limits and DB starvation. Unbounded memory arrays are guarded by strict cap limits (500 items/room) to eliminate OOM vulnerabilities.

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
5.  Under **Environment**, link your Supabase secrets.
6.  Ensure **Public Ports** are mapping port `3000` to HTTP.

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
