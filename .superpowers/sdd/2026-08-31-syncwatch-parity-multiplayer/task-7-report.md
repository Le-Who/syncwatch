# Task 7 report: Deterministic N-client and degraded-network E2E

## Outcome

Implemented a serial, product-level browser matrix for five independent room
participants, two independently degraded clients, reconnect/late-join/owner
handoff, and the one-composer desktop/mobile invariant. The deterministic run
uses genuine UI joins and server-issued sessions. A separate real YouTube smoke
exists behind `LIVE_YOUTUBE_SMOKE=1` and was not executed in Task 7.

## TDD evidence

### RED

Initial command:

```powershell
pnpm exec playwright test e2e/multiplayer-room.spec.ts --workers=1 --list
```

Expected result: failed during test discovery because the new test named the
required `./helpers/network` boundary before it existed:

```text
Error: Cannot find module './helpers/network'
at multiplayer-room.spec.ts:18
Total: 0 tests in 0 files
```

Focused behavioral RED runs then exposed three concrete stale-test/harness
assumptions:

- the real player exposes two accessible `Play` controls, so a page-global
  locator failed strict mode instead of selecting the product control bar;
- the paused overlay legitimately intercepts the behind-player interaction
  layer, so the visible z-50 control bar had to be selected; and
- the local participant is an editable input rather than text, so a participant
  card locator based only on text could not find the current user. An attempted
  Testing Library-style `getByDisplayValue` also failed because it is not a
  Playwright API; the final locator uses public Playwright locator composition.

These failures were reproduced once each, the call logs were read, and only the
test boundary/locators were corrected. No production behavior was changed.

### GREEN

Focused commands and results:

```text
pnpm exec playwright test e2e/multiplayer-room.spec.ts --workers=1 --grep "desktop mounts"
1 passed (26.0s)

pnpm exec playwright test e2e/multiplayer-room.spec.ts --workers=1 --grep "five independent"
1 passed (33.6s)

pnpm exec playwright test e2e/multiplayer-room.spec.ts --workers=1 --grep "reconnects without"
1 passed (45.5s)

pnpm exec playwright test e2e/degraded-network.spec.ts --workers=1
1 passed (28.8s)

pnpm exec playwright test e2e/multiplayer-room.spec.ts --workers=1 --grep "mobile mounts"
1 passed (13.6s)
```

Required deterministic serial command, run once after focused iteration:

```powershell
pnpm exec playwright test e2e/multiplayer-room.spec.ts e2e/degraded-network.spec.ts --workers=1
```

```text
Running 5 tests using 1 worker
5 passed (1.4m)
```

## Matrix executed

| Row                                   | Participants / viewport | Observable acceptance evidence                                                                                                                                                                                                                     | Result |
| ------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Presence and controls                 | 5 fresh contexts        | Every People badge reached 5; viewer played before leadership; Friend 2 became leader; Friend 5 received exact `NOT_PERMITTED`; leader pause and moderator play reached all clients; media time advanced                                           | Pass   |
| Reconnect / late join / owner handoff | 3, then 4 contexts      | 800 ms pulse and 3.5 s in-grace pulse preserved roles and cardinality; late join mounted current media while playing; permanent owner close produced one owner, released departed leader, and surviving media kept advancing                       | Pass   |
| Multiple degraded clients             | 5 fresh contexts        | Friend 3 had 1500 ms HTTP latency plus a held media range; Friend 4 alternated 200/1200 ms HTTP latency and experienced a real 1800 ms offline Socket.IO pulse; the other three stayed visibly `playing` and each advanced by more than one second | Pass   |
| Recovery convergence                  | Same 5 contexts         | Held ranges released, jitter stopped/reset, offline client reconnected, buffering overlay cleared, every client stayed `playing`, and physical player spread converged below 4 seconds                                                             | Pass   |
| Composer desktop                      | 1280x720                | Exactly one visible composer when empty and after media was added                                                                                                                                                                                  | Pass   |
| Composer mobile                       | 390x844                 | Exactly one visible composer when empty and after media was added                                                                                                                                                                                  | Pass   |

## Deterministic provider adapter boundary

`installDeterministicMedia()` is entirely test-owned. It intercepts only:

1. metadata for `https://media.syncwatch.test/e2e-deterministic.wav`; and
2. HTTP byte-range requests for that same URL.

It generates a 15-minute, mono 8 kHz PCM WAV and serves finite 8000-byte
ranges. Holding those range responses makes Chromium's actual media element
emit `waiting`; releasing them lets the normal player health and sync logic
recover. The adapter does not write Zustand state, emit provider callbacks,
expose a production hook, replace application services, or fabricate a JWT.

The room page, accessible controls, `/api/auth/session`, HTTP-only cookie,
Socket.IO service, server command service, repository, permission checks,
compact playback events, ACK reconciliation, canonical reducer, HTML media
element, and player synchronization hooks remain real. The exact rejection
check opens a short auxiliary Socket.IO connection using the participant ID and
HTTP-only token already issued to that browser context; it joins the same real
room/session and observes the matching nonce ACK before closing.

## Network helper scope

`setLatency()` uses public Chromium CDP with the required values:

- requested latency (1500 ms for the slow client);
- 1,500,000-byte/s download throughput;
- 750,000-byte/s upload throughput; and
- `cellular3g` connection type.

`alternateLatency()` changes one CDP session between 200 and 1200 ms and
restores zero before detaching. This HTTP emulation is evidence for provider
range degradation, not an assertion that an established WebSocket was delayed.
`pulseOffline()` separately toggles the browser context offline and proves the
Socket.IO disconnect/reconnect path. Delayed/dropped/duplicated/reordered
canonical delivery remains covered below the browser layer.

## Cleanup

- Every context created by the N-client harness is closed in `finally`.
- Held provider range handlers are released before context teardown.
- Jitter timers are stopped, CDP latency is reset, and the jitter CDP session is
  detached.
- The auxiliary exact-ACK socket closes in its own `finally` block.
- Playwright owns and terminates the dedicated port-3001 server.
- Unique UUID room IDs prevent cross-test room reuse.

## Stale coverage repaired or removed

- Replaced fabricated JWTs, private `context._options`, fixed hydration sleeps,
  and the obsolete `Entities` selector in the shared room helper with the real
  join form, server session route, People surface, and condition polling.
- Replaced `player.spec.ts` with current People/composer and deterministic media
  volume regressions.
- Removed `high_latency_sync.spec.ts`, `network_resilience.spec.ts`,
  `playback_sync.spec.ts`, and `sync_recovery.spec.ts`. Their distinguishing
  assertions were hidden-store/socket checks, fixed timing values, invalid
  mocked media, or behaviors now exercised through observable product state in
  the deterministic matrix.

## Live YouTube smoke

`e2e/live-youtube-smoke.spec.ts` is gated by `LIVE_YOUTUBE_SMOKE=1`, uses the
known embeddable IFrame API demo video `M7lc1UVf-VE`, requires headed execution,
and includes at least three fresh contexts plus add/play/pause/seek/late join/
reconnect/degraded-continuation steps. It was intentionally not executed here;
Task 9 owns opt-in live execution. No live-provider pass is claimed.

## Files changed

- `playwright.config.ts`
- `e2e/helpers/room.ts`
- `e2e/helpers/network.ts`
- `e2e/multiplayer-room.spec.ts`
- `e2e/degraded-network.spec.ts`
- `e2e/live-youtube-smoke.spec.ts`
- `e2e/player.spec.ts`
- `e2e/README.md`
- removed four stale E2E specs listed above

## Static checks and self-review

Commands:

```powershell
pnpm exec prettier --write playwright.config.ts e2e/helpers/room.ts e2e/helpers/network.ts e2e/multiplayer-room.spec.ts e2e/degraded-network.spec.ts e2e/live-youtube-smoke.spec.ts e2e/player.spec.ts e2e/README.md
pnpm exec eslint playwright.config.ts e2e
pnpm exec tsc --noEmit --pretty false
pnpm exec playwright test e2e/live-youtube-smoke.spec.ts e2e/player.spec.ts --workers=1 --list
git diff --check
```

Prettier completed, scoped ESLint and TypeScript exited 0 with no findings, and
diff checking found no whitespace errors (Git only reported the repository's
LF-to-CRLF checkout warning). Playwright discovery listed the opt-in live smoke
and two repaired player regressions without running the live test. A final scan
found no `_options`, `SignJWT`, hidden store or socket globals, fixed
`waitForTimeout`, `Entities`, or obsolete join selectors in the remaining
E2E/config files. The framework-generated `next-env.d.ts` content was restored
and is not part of Task 7.

Self-review confirmed fresh contexts, exact-nonce ACK matching, canonical status
labels, physical media progression, provider-local buffering, healthy-client
advancement, recovery tolerance, cardinality, role visibility, and cleanup.

## Concerns / environment notes

- The deterministic run used the repository's safe ephemeral no-Redis mode;
  real Redis parity execution remains Task 9.
- Test output contains pre-existing environment/tooling warnings for missing
  Redis/Supabase configuration, npm config keys, `NO_COLOR`/`FORCE_COLOR`, and
  stale `caniuse-lite`. They did not produce test failures.
- The live YouTube smoke is implemented but unexecuted, so external provider
  availability and current iframe labels are not claimed as verified here.
