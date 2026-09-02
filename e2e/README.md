# Browser acceptance tests

The deterministic acceptance matrix uses a dedicated server on port 3001 and
runs serially. Every friend is a fresh browser context, so cookies, local
storage, media state, and Socket.IO transports are independent.

```powershell
pnpm exec playwright test e2e/multiplayer-room.spec.ts e2e/degraded-network.spec.ts --workers=1
```

## Deterministic provider boundary

`installDeterministicMedia()` owns only the external media boundary. It
intercepts the test URL's metadata request and serves a generated 15-minute
PCM WAV as finite HTTP byte ranges. A test may hold and release those range
responses to create a real local `waiting` event. The application room UI,
`/api/auth/session`, HTTP-only session cookie, Socket.IO connection and
reconnection, repository, permission checks, exact command ACKs, canonical
event reduction, and player synchronization logic all run normally. No
production test hook or browser global is used.

The deterministic suite checks:

- five-context presence, leaderless viewer control, active-leader rejection,
  leader control, and moderator control;
- short and in-grace reconnects without duplicate participants, late join,
  deterministic owner handoff, missing-leader release, and continued playback;
- one visible media composer at 1280x720 and 390x844, before and after media;
- one provider stalled at the media range boundary while another context has
  200/1200 ms HTTP jitter plus a real offline Socket.IO pulse; and
- observable healthy media advancement followed by all-client convergence.

`setLatency()` uses Chromium CDP HTTP emulation with 1,500,000-byte/s download,
750,000-byte/s upload, and the requested latency. HTTP latency alone does not
delay an established WebSocket, so the suite never treats it as transport
proof: `pulseOffline()` supplies the independently observable Socket.IO drop
and reconnect. Deliberate canonical event loss, duplication, delay, and
reordering remain lower-level event-bus/integration coverage.

## Live YouTube smoke

The external provider smoke is opt-in and must be run headed. It uses a real,
known embeddable YouTube URL and at least three independent contexts; no
provider traffic is stubbed.

```powershell
$env:LIVE_YOUTUBE_SMOKE = "1"
pnpm exec playwright test e2e/live-youtube-smoke.spec.ts --headed --workers=1
Remove-Item Env:LIVE_YOUTUBE_SMOKE
```

The deterministic suite is the required local gate. The live smoke is an
external-network/provider check and is not considered executed when it is
skipped by default.
