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

## Round 1: Discriminating recovery evidence

Baseline: `13db5b3`. Final implementation commit: `2ac4a6b` (`test: harden
multiplayer recovery assertions`). No production code or production test hook
changed.

### RED and root-cause evidence

The first reconnect correction deliberately required the recovered owner to
pause the room after the offline pulse, with another context expected to see
`paused`:

```powershell
pnpm exec playwright test e2e/multiplayer-room.spec.ts --workers=1 --grep "reconnects without"
```

```text
1 failed
expectCanonicalStatus(..., "paused") timed out after 15000 ms waiting for the
Play control
```

The old hidden-`Retry Now` condition had passed immediately, but this server
round trip did not. That demonstrated that stale local UI was not reconnect
proof. After the reconnect helper accepted an explicit observed round trip, the
same command passed (`1 passed (45.3s)`).

An initial degraded-network GREEN attempt then failed its final `< 4` second
spread assertion with an approximately 29-second spread. Root-cause tracing
showed that the test itself used the recovered, stale-position client to issue
Pause/Play as its reconnect proof, legitimately making that stale position
canonical and rewinding the healthy clients. The correction uses a permitted
nickname update observed by another browser context. It proves a fresh server
round trip without perturbing playback state.

Focused final results:

```text
pnpm exec playwright test e2e/multiplayer-room.spec.ts --workers=1 --grep "five independent"
1 passed (30.5s)

pnpm exec playwright test e2e/multiplayer-room.spec.ts --workers=1 --grep "reconnects without"
1 passed (41.4s)

pnpm exec playwright test e2e/degraded-network.spec.ts --workers=1
1 passed (26.6s)
```

### Corrected matrix evidence

| Correction              | Observable evidence                                                                                                                                                                      | Regression made discriminating                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Healthy playback floors | Three healthy media elements are sampled continuously every 100 ms from pre-recovery floors through reconnect, network reset, convergence, and recovered advancement; tolerance is 0.5 s | Any transient or sustained rewind below a recorded floor is retained as a violation and fails even if the player later catches up |
| Recovered playback      | Both formerly degraded media elements must physically advance by more than 0.6 s after convergence                                                                                       | A client that only receives a `playing` label or stale canonical event fails                                                      |
| Positive reconnect      | Recovered clients rename themselves and a separate live context must observe the exact new participant card                                                                              | Hidden retry UI, cached presence, or disconnected local state cannot satisfy the assertion                                        |
| Owner/leader handoff    | All contexts first observe the departing owner as `LEADER`; after grace, every survivor observes exactly one owner, zero `LEADER` badges, and `No active leader`                         | A pre-existing empty-leader label alone cannot pass; duplicate ownership or retained leadership fails                             |
| Symmetric late join     | Absolute position delta between the late joiner and an existing player must be below 4 s                                                                                                 | A late joiner arbitrarily far behind or ahead fails                                                                               |
| Post-leader permissions | While Friend 2 is leader, the owner plays and pauses and all five contexts observe both transitions                                                                                      | A regression that accidentally restricts owner playback once another leader exists fails                                          |
| Live provider smoke     | Seek uses ten YouTube ArrowRight steps and requires a >40 s jump; reconnect requires an observer-confirmed rename, <6 s absolute convergence, and >1 s advancement                       | Natural playback cannot satisfy the seek; stale UI or a frozen recovered iframe cannot satisfy reconnect                          |

The deterministic media/provider boundary remains the test-owned metadata and
byte-range adapter described above. Round 1 did not add state injection or a
browser production global. The live smoke continues to use the real YouTube
iframe provider.

### Harness cleanup and network lifecycle

`createRoomClients()` now closes a newly created context in the same iteration
if page creation, adapter install, or room join fails, while the outer cleanup
closes all already joined clients. Network emulation now returns an idempotent
handle: one CDP session is enabled per lifecycle, latency can change on that
session, and `resetAndDispose()` resets to zero and detaches exactly once. The
deterministic degraded test and live smoke call it from `finally`; the
alternating-latency timer is stopped and its active update awaited before
disposal. No redundant reset session is created.

### Required deterministic and static verification

The required product command was run once after focused iteration:

```powershell
pnpm exec playwright test e2e/multiplayer-room.spec.ts e2e/degraded-network.spec.ts --workers=1
```

```text
Running 5 tests using 1 worker
5 passed (1.5m)
```

The opt-in external smoke was discovered, not executed:

```text
pnpm exec playwright test e2e/live-youtube-smoke.spec.ts --list
Total: 1 test in 1 file
```

Static checks:

```text
pnpm lint
exit 0, no findings

pnpm typecheck
tsc --noEmit; exit 0, no findings

pnpm exec prettier --check playwright.config.ts e2e
All matched files use Prettier code style!

git diff --check
exit 0; only Git's repository LF-to-CRLF checkout notices were printed
```

The missing project `typecheck` script was added so the required command maps
directly to `tsc --noEmit`. Framework-generated `next-env.d.ts` noise was
restored before committing.

### Warning-noise diagnosis

This diagnosis supersedes the project-controllable warning concern in the
original Task 7 section above.

Three project-controlled warning sources were removed without suppressing
runtime failures:

- the Playwright server command now uses `pnpm exec tsx server.ts`, avoiding
  nested npm interpreting pnpm-only `.npmrc` keys;
- the inherited host `NO_COLOR=1` is removed before Playwright installs its
  `FORCE_COLOR` setting, eliminating the conflicting-color warning; and
- the dedicated test server receives `BROWSERSLIST_IGNORE_OLD_DATA=true`,
  removing the stale `caniuse-lite` advisory from deterministic output.

The remaining server messages are intentional and material: the deterministic
run states that it is using ephemeral memory because
`SUPABASE_SERVICE_ROLE_KEY` is absent and operating without Redis because no
Redis URL is configured. Those are environment-state warnings, not hidden test
errors. Redis/live-environment execution remains Task 9.

### Round 1 concerns

- The external YouTube smoke was not run and is not claimed as passed; Task 9
  owns its opt-in execution.
- Deterministic recovery passed in the documented ephemeral no-Redis mode;
  Redis parity is outside this correction round.
