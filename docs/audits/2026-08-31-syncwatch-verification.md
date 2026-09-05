# SyncWatch parity and multiplayer verification

Date: 2026-09-05
Verdict: **not fully accepted**. The deterministic, real Redis-compatible,
security, build, and browser suites pass. Acceptance criterion 3 remains
unmet because the opt-in headed live YouTube run did not complete its full
three-client play/pause/seek/reconnect/late-join/degraded-continuation path.
The independent whole-branch review required by criterion 10 is owned by the
controller and was still pending when this evidence was recorded. Integration
must not be offered as complete on this record alone.

## Revisions and environment

| Item                                    | Exact value                                                      |
| --------------------------------------- | ---------------------------------------------------------------- |
| Merge-base / `main` at verification     | `7cf98bf41c273728982a16acdb65b60038f1b683`                       |
| Task 9 starting revision                | `b9406aad4884e3b806af5e48be98892f7f8141e9`                       |
| Verified Task 9 implementation revision | `8fe21745e6c1b76355472cab2d6ad644ec5ba419`                       |
| Branch                                  | `codex/syncwatch-ux-audit`                                       |
| Host                                    | Windows, Europe/Kiev                                             |
| Node / pnpm / Playwright                | Node `v24.13.0`; pnpm `10.28.2`; Playwright `1.58.2`             |
| Browser project                         | Playwright `chromium` project using the installed Chrome channel |

The primary checkout and its user-owned staged deletion were not touched.
All commands below ran in the isolated integration worktree. Nothing was
merged, pushed, deployed, or installed as a system service.

## Deterministic verification

The complete deterministic product suite was first run before Task 9 changes
and again after the focused corrections. The authoritative implementation-tree
results are:

| Command                                 | Exit | Result                                                                                    |
| --------------------------------------- | ---: | ----------------------------------------------------------------------------------------- |
| `pnpm test`                             |    0 | 49 files, 441 tests passed (31.81 s)                                                      |
| `pnpm lint`                             |    0 | no lint errors                                                                            |
| `pnpm typecheck`                        |    0 | no TypeScript errors                                                                      |
| `pnpm build`                            |    0 | Next.js 16.3.4 production build completed                                                 |
| `pnpm exec playwright test --workers=1` |    0 | 7 passed, 1 gated live test skipped (1.3 min)                                             |
| `pnpm audit --prod --json`              |    0 | 315 production dependencies; 0 critical, high, moderate, low, or informational advisories |
| `git diff --check main...HEAD`          |    0 | no whitespace errors                                                                      |

Before the Task 9 regressions were added, `pnpm test` passed 49 files / 439
tests (33.77 s). The count increase is two focused player-event/paused-overlay
regressions, not a change in discovery. The full browser result includes the
opt-in live spec as an intentional skip when `LIVE_YOUTUBE_SMOKE` is absent.

The test server truthfully reported that `SUPABASE_SERVICE_ROLE_KEY` was absent
and it was running in ephemeral-memory mode, that no Redis URL was configured
for this no-Redis matrix, and that the development-only JWT fallback was in
use. These are expected verification-environment states, not production-ready
configuration.

The build remained green while npm printed non-fatal warnings for pnpm-only
configuration keys: `cache-dir`, `node-linker`, `npm-globalconfig`,
`state-dir`, `store-dir`, `verify-deps-before-run`, and `_jsr-registry`.

## Real Redis-compatible lifecycle

The host had no usable `docker`, `redis-server`, `memurai`, or `podman`
executable. `wsl.exe --list --quiet` exited 1 and reported that WSL was not
installed. A safe ignored, disposable runtime was therefore installed under
the integration worktree with:

```powershell
npm install --prefix '.superpowers/sdd/2026-08-31-syncwatch-parity-multiplayer/task-9-runtime' --no-save redis-memory-server@0.17.1
```

It launched a Windows-native Memurai Developer process only for this evidence,
on loopback port 61502. `INFO server` reported:

```text
memurai_edition:Memurai Developer
memurai_version:4.2.3
redis_version:7.4.9
redis_mode:standalone
process_supervised:no
tcp_port:61502
```

This is a real Redis-compatible server process, not the repository's fake
adapter. It executed production Redis commands, Lua scripts, optimistic CAS,
and publisher/subscriber connections.

| Command                                                                                                                                               | Exit | Authoritative evidence                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ----------------------------------------------------------------------------------------------------------------------------- |
| `$env:REDIS_URL='redis://127.0.0.1:61502'; pnpm vitest run __tests__/integration/redis.test.ts --reporter=verbose`                                    |    0 | 5/5: real connection, queue/state persistence, CAS, legacy normalization, slow command, and cross-node Redis pub/sub (2.02 s) |
| `$env:REDIS_URL='redis://127.0.0.1:61502'; pnpm vitest run __tests__/fast_path.test.ts --reporter=verbose`                                            |    0 | 18/18: actual Lua play/pause/seek, stale media/version handling, idempotency, permission, and contention paths (2.31 s)       |
| `$env:REDIS_URL='redis://127.0.0.1:61502'; pnpm exec playwright test e2e/multiplayer-room.spec.ts --workers=1 --grep 'reconnects without duplicates'` |    0 | 1/1: real join/state, 3-to-4-to-3 participants, reconnect within grace, late join, and owner/leader handoff (50.9 s)          |

The first connected integration run was deliberately treated as a failure:
one dormant CAS assertion used an ad-hoc `data` field that the production
`RoomState` normalization boundary correctly strips. History showed that this
was stale test data, not a Redis defect. The regression fixture was changed to
a valid `RoomState` and now asserts the domain `name` field. A new test also
proves production `RoomEventBus` / `setupPubSubListeners` delivery through a
real duplicated subscriber and Redis `PUBLISH`; the corrected run passed 5/5.

The disposable server reached `DBSIZE` 1 with only a generated
`room_state:e2e-*` key. No shared Redis data was inspected or flushed. The
process was stopped after evidence collection, and the loopback port refused
connections afterward. The ignored runtime is not part of the product diff.

## Browser and participant matrix

| Scenario                                    | Participants / network / viewport                                                                                         | Result and observable evidence                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Presence and permissions                    | 5 independent fresh contexts, desktop                                                                                     | Pass: all People counts reached 5; viewer/leader/owner/moderator policy exercised; exact rejected action was visible; all clients converged on play/pause                                    |
| Reconnect, late join, handoff without Redis | 3 initial, fourth late/reconnected, then 3 survivors; desktop                                                             | Pass: positive observer-visible rename round trip, no duplicate participant, symmetric position convergence, departing owner was leader, then exactly one owner and zero leaders after grace |
| Same lifecycle with Redis                   | 3 initial, fourth late/reconnected, then 3 survivors; desktop; Memurai port 61502                                         | Pass: production Redis room state/Lua/pub-sub path and deterministic owner handoff                                                                                                           |
| Independently degraded clients              | 5 contexts: Friend 3 at 1500 ms plus held ranges; Friend 4 alternating 200/1200 ms and 1800 ms offline; 3 healthy clients | Pass: healthy media continued without rewind or canonical buffering; both degraded clients later converged and physically advanced                                                           |
| Desktop composer                            | 1280 x 720                                                                                                                | Pass: exactly one composer before and after media is added                                                                                                                                   |
| Mobile composer                             | 390 x 844                                                                                                                 | Pass: exactly one composer before and after media is added                                                                                                                                   |
| Current room-player regressions             | desktop Chrome                                                                                                            | Pass: current People surface, one empty-room composer, continuous native deterministic-media volume control                                                                                  |
| Health cardinalities                        | unit/integration N = 1, 3, 5, 25; browser N = 5; production admission N = 25                                              | Pass: no two-person assumption; independent health and current server admission are covered                                                                                                  |

The deterministic browser media/provider boundary uses its documented
test-owned metadata and byte-range adapter. It is not described as real
YouTube evidence.

## Headed live YouTube smoke

Exact opt-in command:

```powershell
$env:LIVE_YOUTUBE_SMOKE='1'
pnpm exec playwright test e2e/live-youtube-smoke.spec.ts --headed --workers=1
Remove-Item Env:LIVE_YOUTUBE_SMOKE
```

**Result: failed; acceptance criterion 3 is unmet.** No single headed run
completed the full required three-client path.

The browser did initialize real YouTube iframes and expose their native
controls. Across the bounded diagnostic runs, direct evidence included initial
real play and pause, provider time progression, successful resume in some
runs, and an owner seek of more than 40 seconds measured through the YouTube
IFrame player's `getCurrentTime()` API. This is partial provider evidence only.
The final bounded run stopped during the second resume: after the native pause,
the test had observed a transient iframe Play state rather than waiting for
canonical room pause; by the time it attempted the product Play control, that
control was absent. It therefore did not reach seek, late join, reconnect, and
degraded continuation in one successful run.

Systematic debugging produced three narrow regressions/corrections:

1. The paused product overlay now has the accessible name `Play`, and remains
   available while a paused local provider reports buffering.
2. A native play from the current media/sequence/provider epoch can recover
   local buffering; stale media, sequence, and epoch callbacks remain blocked.
3. The live harness measures actual player time through the IFrame API and its
   checked-in final flow waits for the canonical SyncWatch pause surface before
   resuming, then requires all three real providers to show Pause before seek.

The first two corrections are covered by the Player unit suite (26/26) and the
complete 441-test suite. The final live harness stabilization was not declared
green and was not retried again after the bounded stopping decision.

Every live server attempt also logged `queryA ECONNREFUSED www.youtube.com` for
the server-side metadata lookup. The deterministic metadata fallback allowed
the browser iframe to initialize, so this DNS refusal does not explain away
the application/harness synchronization failure and does not turn the run into
a pass. It remains an external-environment limitation to reproduce on a host
with reliable YouTube DNS/network access.

## Dependency and production risk audit

Fresh `pnpm audit --prod --json` is green: 315 dependencies and zero current
advisories at every severity. Task 8's four initially observed advisories were
patched: minimatch ([GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74)),
UUID ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)),
esbuild ([GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)),
and Babel core ([GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8)).
There is no intentionally accepted current advisory.

Reachable residual risks and trade-offs remain:

- The session token is still held in browser JavaScript state as a Socket.IO
  auth fallback. This is reachable in a browser compromise/XSS and requires a
  larger cookie-only Socket.IO session redesign rather than a local patch.
- `yt-search` remains a production fallback. Its scrape runs inside a
  five-second worker boundary, which limits one stall but would not make a
  future dependency advisory unreachable. The Google API path remains the
  preferred production path.
- Without Redis, room state and rate limits are process-local. A multi-instance
  production deployment must provide Redis rather than relying on the bounded
  local fallback.
- Production must provide `JWT_SECRET`, a canonical `NEXT_PUBLIC_APP_URL`, TLS,
  and `TRUST_PROXY=true` only behind a proxy that sanitizes forwarded headers.

## Acceptance-criteria mapping

|   # | Criterion                                                                               | Status   | Authoritative evidence                                                                                                                                                 |
| --: | --------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Unit, lint, build, and type checks succeed                                              | Pass     | `pnpm test` 49/441; lint, typecheck, build all exit 0                                                                                                                  |
|   2 | Serial five-client E2E with current selectors                                           | Pass     | full serial Playwright 7 pass / 1 gated skip; five-client presence/permissions and recovery specs pass                                                                 |
|   3 | Live three-client YouTube play/pause/seek/late/reconnect/degraded continuation          | **Fail** | headed opt-in run initialized real providers and gave partial playback/seek evidence, but no run completed the required path                                           |
|   4 | Local buffering cannot change canonical playback or pause healthy clients               | Pass     | five-client degraded browser case plus playback-health and degraded integration suites; three healthy clients continued and recovered clients advanced                 |
|   5 | Redis and no-Redis presence convergence, reconnect, owner handoff                       | Pass     | serial no-Redis lifecycle test and the same 1/1 browser lifecycle against Memurai Redis API 7.4.9, plus real pub/sub and Lua suites                                    |
|   6 | Permission UI and server policy agree; rejection is visible                             | Pass     | five-client browser policy matrix plus shared permission/command-service and ACK tests in the 441-test suite                                                           |
|   7 | One composer on desktop and mobile                                                      | Pass     | explicit 1280x720 and 390x844 browser rows before/after media                                                                                                          |
|   8 | No two-person assumption; multiple N values                                             | Pass     | health N=1,3,5,25; browser N=5; production server admission N=25                                                                                                       |
|   9 | Audit and accepted advisories documented                                                | Pass     | fresh audit 0 advisories / 315 dependencies; reachable non-advisory residuals and trade-offs documented above                                                          |
|  10 | Preserve unrelated changes and independent critical/important review before integration | Partial  | isolated worktree and clean scoped diff preserve the primary checkout; controller-owned independent whole-branch review remains pending, so integration is not offered |

## Final assessment

The branch has fresh deterministic, real Redis Lua/pub-sub, security audit, and
serial browser evidence. It is not an all-criteria acceptance candidate yet:
criterion 3 requires a successful complete live-provider run, and criterion 10
requires the controller's independent review with all critical/important
findings resolved. Those gaps are explicit stopping conditions, not waived
risks.
