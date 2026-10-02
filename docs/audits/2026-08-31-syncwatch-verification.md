# SyncWatch parity and multiplayer verification

Current controller verdict (2026-10-02): **not ready for unconditional UX
acceptance or integration**. The human-authorized targeted queue follow-up at
`95520786a37a7d6adeb229e5481d2f8910e8e5a6` closes F4/N1 with six real-service
regressions and an independent focused PASS. All original final-review findings
are addressed. However, fresh live verification subsequently exposed a separate
**native YouTube Pause intent loss**: an actual click pauses the actor's iframe,
but no Pause command leaves that browser and reconciliation resumes it. A
subsequent read-only guard trace identifies the rejecting recent-programmatic-
seek guard: the genuine Pause arrived 1308 ms after a programmatic seek, inside
the 1500 ms suppression window. The final follow-up section and native-pause
boundary summary below are current. No native-intent correction is implemented.

Fresh full unit, lint, typecheck, production build, dependency audit and serial
browser gates pass. A complete live attempt failed at pause propagation, a
trace-enabled complete replay passed unchanged, and a bounded socket diagnostic
reproduced the real intent loss. A passing replay does not erase that failure.
Primary main and its user-owned staged deletion remain untouched. Earlier
Round 1/Round 2/final-wave passes and failures are dated historical evidence.

Initial record: 2026-09-05. The sections through "Initial assessment" preserve
that earlier verification snapshot and its failed live attempt.

Initial verdict: **not fully accepted**. The deterministic, real Redis-compatible,
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

## Initial-revision acceptance-criteria mapping

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

## Initial assessment

The branch has fresh deterministic, real Redis Lua/pub-sub, security audit, and
serial browser evidence. It is not an all-criteria acceptance candidate yet:
criterion 3 requires a successful complete live-provider run, and criterion 10
requires the controller's independent review with all critical/important
findings resolved. Those gaps are explicit stopping conditions, not waived
risks.

## Round 1 recovery update — 2026-09-26

Product-code revision: `a855ff99f44c78c90999a6292b117c3454a316b2`
(`fix: make room pause and redis startup reliable`). The prior audit revision
was `b007ddeb8dae0a3a4ce7c085f44f42fd8ab3c28e`. This document update is a
separate evidence-only commit, so the product-code SHA and evidence SHA are
distinct. The initial failed live result and 441-test count above describe the
older revisions; they are retained as history, not the current verdict.

The final committed-tree checks on `b007ddeb`, previously present only in the
ignored Task 9 report, were:

| Check                                                 | Exact result on `b007ddeb`                                      |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm test`                                           | exit 0; 49 files / 441 tests; 32.20 s                           |
| `pnpm lint` / `pnpm typecheck`                        | both exit 0                                                     |
| `pnpm build`                                          | exit 0; Next.js 16.3.4 compiled and server TypeScript completed |
| `pnpm exec playwright test --workers=1`               | exit 0; 7 passed / 1 opt-in live skip; 1.3 min                  |
| `pnpm audit --prod --json`                            | exit 0; 315 production dependencies / 0 advisories              |
| `git diff --check main...HEAD` / `git status --short` | exit 0 / empty after generated `next-env.d.ts` restoration      |

Round 1 found and repaired three Important gaps. The preserved readiness RED
test failed because `setupPubSubListeners` returned `undefined`, subscribed
before attaching its message listener, and startup did not await Redis's
subscription acknowledgement. It now attaches the listener first, returns an
awaitable boundary, and the server awaits it before listening. The real Redis
test now uses two production `RoomEventBus` instances, production
`RoomEventBus.publish`, real Redis transport, production subscriber dispatch,
and source-node echo suppression. It does not manually pre-subscribe or
raw-publish the asserted event.

The interrupted live trace showed a successful native YouTube Pause click
without canonical room pause. In a diagnostic run, the current-provider pause
callback entered with permission, ready health, and no transition/seek guard,
but its 150 ms debounce callback did not run. `handleNativePlay` could clear
that pending pause when the still-playing canonical frame echoed back to the
local provider. A focused Player regression was RED (0 pause commands) when a
YouTube native Play followed a valid Pause within the debounce. The fix keeps
the YouTube pause pending while retaining the debounce and waiting-chain
safety rules. Player plus degraded integration passed 38/38 after the fix.
The stale native Play minor remains outside this regression's scope.

The live harness now uses YouTube's documented IFrame `getPlayerState()` values
1 (playing) and 2 (paused), plus `getCurrentTime()`, to observe real provider
state. It still requires the canonical SyncWatch Play overlay after native
Pause and real multi-client position convergence. [YouTube's IFrame API
reference](https://developers.google.com/youtube/iframe_api_reference)
documents these methods and values. The final headed run, with
`LIVE_YOUTUBE_SMOKE=1` and `--headed --workers=1`, passed **1/1 in 34.8 s**:
three independent real iframes initialized, all played, Friend 2 natively
paused and all saw canonical Play, all resumed, an owner seek exceeded 40 s
and peers converged, a fourth late client joined and converged, one client was
delayed while another disconnected and reconnected, healthy clients continued,
and the recovered client advanced. The separate Node metadata lookup still
warned `queryA ECONNREFUSED www.youtube.com`; Chrome's real iframes worked.
The original interrupted failure trace remains in
`playwright-report/data/9171f70f219d1d891ff94bf16fe69d73cc8784b0.zip`,
with three earlier screenshots under `output/playwright/task9-round1-trace1/`.

The deferred paused-overlay UX issue was resolved in the touched Player path:
a viewer lacking playback control now sees a disabled Play button with a
permission explanation. The approved leaderless and leader/owner/moderator
permissions are unchanged. A focused test was RED before the change and GREEN
after it.

Round 1 verification on product-code revision `a855ff99`:

| Check                                                   | Exact result                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm test`                                             | exit 0; 49 files / 444 tests; 32.77 s                         |
| `pnpm lint`                                             | exit 0                                                        |
| `pnpm typecheck`                                        | exit 0                                                        |
| `pnpm build`                                            | exit 0; Next.js 16.3.4 production build and server TypeScript |
| `pnpm exec playwright test --workers=1 --reporter=line` | exit 0; 7 passed / 1 opt-in live skip; 1.4 min                |
| headed live YouTube command above                       | exit 0; 1/1 passed; 34.8 s                                    |
| real Redis integration                                  | exit 0; 5/5 passed; real two-bus publisher/subscriber path    |
| real Redis Lua fast path                                | exit 0; 18/18 passed                                          |
| Redis-backed reconnect lifecycle E2E                    | exit 0; 1/1 passed; 38.2 s                                    |
| `pnpm audit --prod --json`                              | exit 0; 314 production dependencies; 0 advisories             |
| scoped Prettier check / `git diff --check`              | exit 0 / exit 0                                               |

The Redis checks used a new disposable Memurai Developer runtime at
`127.0.0.1:51613`; it was stopped without a flush and the loopback port was
confirmed closed. The initial lint rerun found 78 errors in a pre-existing
generated `playwright-report/trace` bundle, not product source. ESLint now
ignores only `playwright-report/**`; a later full `pnpm lint` exited 0. Audit
initially reported one newly published moderate advisory,
`GHSA-w5vr-8v7q-w6rv`, through `next > baseline-browser-mapping@2.10.8`
(315 production dependencies). The scoped override to patched `2.11.26`,
lockfile update, and `pnpm install --frozen-lockfile` succeeded; the new audit
is zero advisories across 314 production dependencies.

Current criterion 3 is **Pass** on the complete headed live run. Criteria 1,
2, 4–9 remain Pass on the results above. Criterion 10 remains **Partial**:
the controller still owns the independent whole-branch review and integration
decision. No merge, push, deployment, primary-checkout/index change, shared
Redis flush, or system-service installation occurred.

The evidence-only commits before this current-verdict clarification are
`e464c72554ba767336bb05d0a0380e0cfc371de7` and
`d08b7cc369959eb0c80d35a540285ddfadfcc908`. On both exact committed
trees, `pnpm lint`, `pnpm typecheck`, `pnpm audit --prod --json` (314 production
dependencies, zero advisories), the scoped audit-document Prettier check, and
`git diff --check main...HEAD` all exited 0. `git status --short` showed only
the preserved pre-existing untracked `output/` trace screenshots. This
clarification requires one final document-only commit, so its own SHA cannot be
written into its contents without changing that SHA. The final evidence SHA is
the revision containing this paragraph, recorded in the ignored working
report and handoff; lightweight clean-tree checks are repeated after it.

## Round 2 — quick native resume and delayed-ACK verification (2026-09-26)

Verified product revision: `8e82ed56384dac30c1dc09093fb33d406a3f64a0`.
The independent scoped re-review found that Round 1 retained the 150 ms
YouTube pause debounce across every `onPlay`, including a genuine rapid
Pause→Play. A RED authoritative integration test reproduced an unwanted Pause
command after quick resume both before and after React committed the pause;
another RED scenario showed a canonical sync tick could restart the local
provider and generate the stale Play echo. The correction keeps the local
provider paused while its native Pause debounce is pending. A subsequent
native Play therefore represents a fresh local resume and cancels the timer.
It does not rely on a possibly stale React `playing` closure. After the timer
sends Pause, the existing pending-nonce canonical-frame guard suppresses old
playing frames until ACK; a delayed-ACK integration scenario holds the actual
`RoomCommandService` invocation across the next 300 ms sync retry and checks
that the provider stays paused, exactly one Pause escapes, and eventual
canonical state is paused. The approved 150 ms debounce and YouTube/Twitch/raw
waiting→pause suppression remain intact. The focused Player and authoritative
degraded-integration suites passed 42/42 after this additional scenario.

The real Redis source self-echo test now waits for the source subscriber's
actual `pmessage` for its unique room channel before asserting one source
delivery. This is an event barrier, not a delay or production hook. A fresh
disposable Memurai Developer instance at `127.0.0.1:54763` produced 5/5 real
Redis integration tests, 18/18 Lua fast-path tests, and 1/1 Redis-backed
reconnect lifecycle browser test (45.4 s). It was stopped without flushing,
and the port was verified closed.

| Product-tree check                                           | Exact Round 2 result                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                  | exit 0; 49 files / 448 tests (33.05 s)                                                                        |
| `pnpm lint` / `pnpm typecheck`                               | both exit 0                                                                                                   |
| `pnpm build`                                                 | exit 0; Next.js 16.3.4 production build and server TypeScript                                                 |
| `pnpm exec playwright test --workers=1 --reporter=line`      | exit 0; 7 passed / 1 intentional opt-in live skip (1.7 min)                                                   |
| `LIVE_YOUTUBE_SMOKE=1` headed live YouTube smoke, one worker | exit 0; 1/1 passed (50.9 s); full three-client play/pause/seek/reconnect/late-join/degraded-continuation flow |
| Real Redis integration / Lua / reconnect lifecycle           | exit 0; 5/5, 18/18, 1/1 respectively                                                                          |
| `pnpm audit --prod --json`                                   | exit 0; 314 production dependencies, 0 advisories at every severity                                           |
| Scoped Prettier / `git diff --check`                         | both exit 0                                                                                                   |

The live run's Node metadata lookup again warned `queryA ECONNREFUSED
www.youtube.com`, but the real Chrome iframes and complete assertion flow
passed. Generated `next-env.d.ts` was restored after the build. Pre-existing
untracked `output/` screenshots were preserved. No primary checkout/index,
shared Redis data, merge, push, deployment, or system-service state was
changed. This Round 2 evidence commit follows the product SHA above, so its
own SHA is recorded in the ignored task report and handoff; lightweight checks
are repeated against the final committed tree. Criterion 10 remains pending
the controller-owned independent whole-branch review.

## Final correction wave — evidence before queue follow-up (2026-10-02)

Product revision: `4d8773391ebfabe237802564ddfbb5f9b75a9bf4`. This section supersedes the
earlier verification verdicts for the corrected product. The controller-owned
single scoped re-review remains pending; no merge, push, deployment, primary
checkout/index mutation, live Supabase change, or shared Redis flush occurred.

### Correction and regression matrix

| Finding        | Implemented boundary and evidence                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1             | Required generation + media-run binding at schemas, client emission, every local CAS attempt and atomic Redis Lua; stale exact nonce rejects. A→B→A, same-item new run, atomic switch race and same-run arrival-LWW covered.                                                                                                                                                                                                                       |
| F2             | Independent full-state watermark and compact playback merge; highest unknown-media compact requests one bounded read-only snapshot. Real Zustand/two service instances and real Redis pub/sub prove metadata convergence without timeline rollback.                                                                                                                                                                                                |
| F2/F6 recovery | Cache-lifetime generation changes only on creation/hydration; stable `legacy` normalization across nodes. Current room/transport/request-correlated snapshots authorize seq100→restored seq12; retired full/compact/commands and old request responses reject. Player coordinator and provider key include generation/run, restoring same-media lower sequence and causing fresh metadata/readiness events.                                        |
| F3             | Valid JWT reuse precedes creation quota. New identity/coarse IP joins: 1000/minute; participant joins: 50/minute; commands unchanged at 60/10 seconds. Real route, local limiter and actual Socket.IO server admit 25 same-NAT sessions and 100 group joins; one noisy identity does not block the other 24. Separate three-context browser test checks nonempty distinct identity preconditions and four reload rounds.                           |
| F4             | Shared explicit Next/natural-end traversal implements shuffle cycles, one-use next override, temporary consumption, natural autoplay-off stop even with loop, explicit Next precedence and valid selection pointers. Thirteen policy regressions cover hand-derived queue results.                                                                                                                                                                 |
| F5             | Semantic rename and focus return, visible tab focus, keyboard slider with permission-disabled policy; focused interactive controls retain Space. Actual-room keyboard-only workflow exercises rename, tabs and media seeking.                                                                                                                                                                                                                      |
| F6             | Forward JSONB snapshot migration/backfill, real writer/reloader and synchronized relational compatibility rows preserve promised queue/settings/chat/playback fields and clear empty media. Durable participant identity/role history excludes connection IDs, readiness and health; hydration has no active leader/socket and uses existing 15-second grace/handoff. Viewer-first and moderator-return tests prevent escalation/duplicate owners. |
| F7             | OS lookup validates every IPv4/IPv6 candidate as public unicast, native HTTP pins the selected address while preserving hostname/SNI, rejects credentials/redirects and bounds response to 5 seconds/50 KiB. Dial-boundary regressions and a final public native YouTube/Example Domain probe pass.                                                                                                                                                |
| F8             | Exact `public.sync_room_state(uuid, uuid, jsonb)` ACL revokes PUBLIC/anon/authenticated after function replacement and grants service_role; hardened search_path retained, no callable old overload. Actual applied PostgreSQL SQL verifies privileges and role calls, not only string assertions.                                                                                                                                                 |
| M1–M5          | Old provider-epoch native Play callbacks covered; duplicate-permitting listener fake proves exact cleanup; clipboard rejection offers manual-copy fallback; player error names the failed item; pure-mutation viewer fixture follows owner/mod queue policy.                                                                                                                                                                                       |

The Supabase/Postgres skills informed migration creation through CLI, explicit
function ACLs after replacement, schema-faithful round-trip tests and preserving
durable roles separately from live connections. Current references used:
[Supabase database functions](https://supabase.com/docs/guides/database/functions),
[table privileges](https://supabase.com/docs/guides/database/tables), and
[PGlite API](https://pglite.dev/docs/api). Pinned dev-only PGlite 0.5.8 runs all
checked-in migrations and the real RPC; it is not a deployed Supabase/PostgREST
stack and no live database evidence is claimed.

### Final-source verification

All final-source commands below run in the isolated correction worktree. Redis
commands target only the owned disposable instance at `127.0.0.1:54950`; the
integration tests clean their unique keys, never shared Redis data.

| Command / evidence                                                                                                                                                                                              | Result                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                                                                                                                                     | exit 0; 58 files / 501 tests passed, 1 opt-in Redis file / 9 tests skipped; 33.58 s. The nine execute in the real Redis gate. |
| `pnpm lint`; `pnpm typecheck`; `pnpm build`                                                                                                                                                                     | each exit 0; Next.js 16.3.8 production build and server TypeScript.                                                           |
| `REDIS_URL=redis://127.0.0.1:54950 pnpm exec vitest run __tests__/integration/final-wave-redis.test.ts __tests__/integration/redis.test.ts __tests__/fast_path.test.ts __tests__/participant-lifecycle.test.ts` | exit 0; 4 files / 49 tests (32 Redis/Lua, 17 pure lifecycle), 1.63 s.                                                         |
| `pnpm exec vitest run __tests__/persistence-migrations.test.ts`                                                                                                                                                 | exit 0; 3 actual-SQL migration/RPC/backfill/ACL/production round-trip tests, 1.68 s.                                          |
| `pnpm exec playwright test e2e/final-wave.spec.ts --workers=1 --reporter=line`                                                                                                                                  | exit 0; 3 tests, 24.1 s; same-item provider readiness/seek, keyboard flow, three-context same-NAT retention.                  |
| `pnpm exec playwright test --workers=1 --reporter=line`                                                                                                                                                         | exit 0; 10 passed / 1 intentional live opt-in skip, 1.9 min.                                                                  |
| `LIVE_YOUTUBE_SMOKE=1 pnpm exec playwright test e2e/live-youtube-smoke.spec.ts --headed --workers=1 --reporter=line`                                                                                            | exit 0; 1 passed, 37.9 s; complete add/play/pause/seek/reconnect/late-join/degraded-continuation live flow.                   |
| `REDIS_URL=redis://127.0.0.1:54950 pnpm exec playwright test e2e/multiplayer-room.spec.ts -g "reconnects without duplicates" --workers=1 --reporter=line`                                                       | exit 0; 1 passed, 44.8 s; actual Redis-backed reconnect, late join and departed-owner handoff.                                |
| Scoped Prettier and `git diff --check`                                                                                                                                                                          | exit 0; Next-generated declaration noise restored after browser shutdown.                                                     |
| `pnpm audit --prod --json`                                                                                                                                                                                      | exit 0; 312 production dependencies, zero advisories at every severity.                                                       |
| Final native metadata probe                                                                                                                                                                                     | exit 0; public YouTube oEmbed title (862 bytes) and Example Domain HTML (713 bytes), using the production pinned HTTP helper. |

Fresh registry evidence found 15 advisories (3 low, 6 moderate, 5 high, 1 critical),
so historical zero-advisory results above were not reused. Compatible maintained
patch updates set Next/@next/env/eslint-config-next floor 16.3.6 (resolved 16.3.8)
and engine.io 6.6.10, undici 7.29.1, brace-expansion 1.1.21 overrides. The
[before summary](2026-10-02-final-wave-audit-before.json) preserves actual audit
IDs, severity, installed/fixed ranges and URLs; the
[after artifact](2026-10-02-final-wave-audit-after.json) retains exact final JSON.
Primary range checks used the [Next advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j),
[Socket.IO advisory](https://github.com/socketio/socket.io/security/advisories/GHSA-2gc4-cqfq-p2gv),
[brace-expansion advisory](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr),
and [Undici release](https://github.com/nodejs/undici/releases/tag/v7.29.1).
Engine.IO is reachable through Socket.IO; no application next/og or ImageResponse
use was found, but the affected package was patched regardless. No major framework
migration or unrelated lockfile churn was introduced.

### Self-review and limits

Focused RED→GREEN evidence is preserved in the ignored final-correction-wave
report. Self-review additionally found and repaired direct selection retaining a
next pointer, special-use IPv6 destinations, hydrated owner grace expiry, compact
metadata advancing the reconnect floor, and the downstream Player's media-ID-only
sequence/readiness epoch. Final regression coverage follows those failures.

Legacy storage cannot recover historical queue metadata/moderator roles it never
recorded; only reconstructable owner_id is backfilled. Durable role records now
retain friend IDs/nicknames/roles with the room snapshot (privacy/storage cost),
not active sockets. Write-behind still permits loss of unflushed changes on crash;
generation recovery makes that lower durable authority usable without accepting
retired frames. Old clients missing required generation/run bindings must refresh.
For M1, a same-provider native Play arriving 200 ms after Pause is intentionally
treated as a fresh local resume; provider events do not expose enough provenance
to distinguish that from a delayed echo. Old media/retry epochs are rejected.
External providers, actual deployed PostgREST, inherited npm configuration warnings,
and deferred reduced-motion/skip-navigation/dark-color-scheme polish retain their
documented limits. Existing output screenshots and ignored runtime evidence are
preserved. The owned Redis runtime was stopped (SIGINT), and port 54950 was
confirmed closed. The independent final acceptance decision belongs to the controller.

## Controller prior final-wave scoped-review disposition — 2026-10-02

The completed correction package spans `49b3558..e05f6b6`, both product and
evidence commits. The sole scoped reviewer examined that fix diff, the covering
test/evidence reports, SQL/role boundaries and dependency ranges. It did not
rerun broad suites, alter source/index/HEAD or spawn reviewers.

| Finding | Scoped verdict |
| --- | --- |
| F1 delayed wrong-video playback commands | ADDRESSED |
| F2 full/compact event reordering and read-only recovery | ADDRESSED |
| F3 shared-NAT admission/reconnect | ADDRESSED |
| F4 advertised queue advancement | NOT ADDRESSED — one Important residual, N1 |
| F5 keyboard workflow | ADDRESSED |
| F6 migration-backed persistence/hydration | ADDRESSED, local-engine boundary retained |
| F7 pinned metadata egress | ADDRESSED |
| F8 exact persistence RPC execution privileges | ADDRESSED, not a deployed-ACL claim |
| M1–M5 useful UX/test-fidelity minors | ADDRESSED, provider provenance limit retained |
| Lifetime/role/coordinator/provider recovery refinement | ADDRESSED |

### The one remaining defect

With queue A/B/C and current A, Set as next B then remove A. Removal selects
B but retains `nextMediaId=B` (`lib/room-logic.ts:331`, `:337`). The subsequent
bound Next accepts that pointer before ordinary/shuffled traversal (`:440`),
acknowledges applied, keeps B and increments mediaRun from 1 to 2 despite C
being available. Natural end uses the same branch. The scoped reviewer
reproduced this through production RoomCommandService/InMemoryRoomRepository
with shuffle enabled, in-process state only, without persistence/publication
or filesystem writes. Controller read the full report and the exact affected
code. F4 and N1 describe this same issue, not two independent blockers.

The smallest proposed follow-up is to consume an override fulfilled by
removal-driven selection and cover subsequent Next/natural end through the
authoritative service, preserving the existing one-use queue policy. This
has **not** been implemented after the final-wave cap. Integration/full-goal
acceptance is withheld and further direction is requested from the user.

### Independent controller evidence and preserved state

At unchanged `e05f6b64113643e5eccc102cc85c5833a07da889`, controller ran:

```powershell
pnpm test --reporter=json --outputFile=.superpowers/sdd/2026-08-31-syncwatch-parity-multiplayer/controller-final-unit.json
```

Exit 0. The complete retained JSON was parsed, not an incomplete console
headline: success true, 510 total tests, 501 passed, zero failed, nine pending,
zero todo, 59 file results and no failed file. All nine non-passed assertions
are intentional opt-in skips in `__tests__/integration/final-wave-redis.test.ts`;
the implementer's real owned Redis gate executed those tests separately.
Controller also reran `pnpm audit --prod --json`: exit 0, 312 production
dependencies and zero advisories in every severity; the complete output was read.
The other complete final-source browser/build/Redis/SQL gates above were inspected as implementer
evidence and checked against changed tests by the scoped reviewer; they are
not claimed as a second controller/reviewer execution.

Controller confirmed the owned Redis port54950 had zero listening sockets,
integration status contained only preserved pre-existing `output/`, and the
primary main/index still contained its original staged deletion. No merge,
push, deployment, live Supabase mutation or plan-workspace cleanup occurred.
The ignored ledger/review/evidence workspace remains preserved while the
Important residual is open. The goal is not marked complete.

### Rulings I made — chronological controller record

1. Reuse Task 1's existing plan commit `a01ded3`, not a duplicate checkpoint.
   Why: the step was already satisfied. Cost if wrong: a redundant commit is
   absent, but no implementation/history is lost.
2. Introduce canonical playing/paused/ended in Task 2 while temporarily keeping
   separately named legacy buffering input until Task 5 removed its mutation
   path. Why: preserve integration and meaningful RED coverage. Cost if wrong:
   temporary type/compatibility complexity.
3. Initially retain Task 8 auth10/60s and distributed-context browser fixtures
   through the trusted proxy, with no limiter bypass. Why: follow the plan's
   then-binding numbers and verify integration. Cost if wrong: fixture
   complexity and underrepresentation of same-NAT bursts. This was superseded
   by ruling 5 when the final review confirmed the actual shared-IP defect.
4. Accept N25 real server/unit/integration plus five browser contexts, not 25
   simultaneous Chromium contexts. Why: that is the approved matrix. Cost if
   wrong: browser-only scale interactions above five are not directly observed.
5. Replace the old IP policy with valid-session reuse outside creation charging,
   coarse IP creation/join1000/60000ms, participant join50/60000ms and unchanged
   command60/10000ms. Why: arbitrary-N/reconnect UX outranks contradicted old
   plan numbers. Cost if wrong: more anonymous/shared-IP traffic before
   throttling; public deployment may need a different abuse policy.
6. Keep and implement advertised Shuffle/Temporary behavior: explicit Next
   overrides autoplay; autoplay-off natural end never loops; shuffled cycles
   avoid immediate repeats; Set as next wins once; temporary entries are
   consumed on Next/end and never resurrected by looping. Why: controls need
   coherent behavior. Cost if wrong: users may prefer other precedence; the
   policy is reversible. The remaining F4 defect violates, not waives, it.
7. Retain durable Supabase restore and align schema/write/read with a forward
   snapshot migration and meaningful applied-SQL round trip. Why: disabling it
   would narrow an existing product claim. Cost if wrong: storage/compatibility
   cost; fields that old versions never stored cannot be reconstructed.
8. Declare the exact persistence RPC service-only via explicit EXECUTE revocation
   for PUBLIC/anon/authenticated and service_role grant, not Supabase end-user
   auth.uid(). Why: this app uses independent friend JWTs and a server writer.
   No live mutation authorized. Cost if wrong: an undocumented browser RPC
   caller loses access.
9. Distinguish cache lifetimes by generation, accept lower-sequence restore only
   through current room/transport/request correlation, and reject retired
   frames/commands, with stable legacy normalization across nodes. Why:
   write-behind/ephemeral restart can reset sequence/mediaRun. Preserve friend
   identity, valid roles and same-generation/run arrival-LWW. Cost if wrong:
   wire/recovery complexity and older-client reload.
10. Persist durable identity/role records separately from ephemeral presence;
    restore no sockets/health/readiness/active leader and preserve grace/handoff.
    Why: an empty restored participant map let the first viewer replace a valid
    owner. Preserve reconstructable owner_id, not invented historic moderator
    roles. Cost if wrong: retained friend IDs/nicknames and storage/compatibility.
11. Accept F4/N1 as real and load-bearing; withhold merge-ready/full-goal
    acceptance and surface it at the final-wave cap. Why: fulfilled forced-next
    state is retained and the production reproduction confirms unintended
    replay. Proposed smallest follow-up consumes that override and tests both
    Next/end. Cost if wrong: integration is delayed for an edge case.
12. Retain provider-provenance, write-behind, legacy reconstruction, old-client
    reload and local-engine/not-live-REST boundaries as explicit limitations,
    not repaired/deployed guarantees. Why: no additional current Important
    defect was established and live deployment was not authorized. Cost if
    wrong: stronger provider/flush/staging verification work will be needed.
    None of these boundaries waives the concrete F4 defect.
13. After the authorized queue correction, withhold unconditional UX acceptance
    for the newly observed native-Pause intent loss; do not relabel the failed
    complete live attempt as success because a traced replay passed. Why:
    browser/provider state and filtered socket traffic establish a real lost
    user intent, not only a brittle overlay assertion. The approved extra
    iteration was limited to the queue defect, so preserve the result and ask
    for a separately scoped native-intent correction. Cost if wrong: integration
    is delayed for a provider/timing edge; the exact rejecting guard still needs
    a deterministic regression. No source fix is guessed or started.

## Human-authorized queue follow-up and current controller verification

The human explicitly authorized one extra targeted iteration after the preceding
final-wave cap. Product commit `9552078` changes one line in `applyRemoveItem`:
an override fulfilled by the newly selected current item is consumed. It adds
six tests through real RoomCommandService/InMemoryRoomRepository/EventBus:
Next/end × shuffle on/off, unrelated future target preservation, and scheduled
target removal. Existing queue policy/direct-selection cases remain intact.
The focused implementer reported RED4/15 then GREEN19/19. The independent scoped
review accepted F4/N1, spec compliance and task quality, and found no introduced
Critical/Important breakage. Historical RED execution is reported evidence;
baseline logic and literal null-pointer assertions corroborate sensitivity.

Controller independently verified the committed product tree:

| Gate | Current result |
| --- | --- |
| Full unit with retained JSON | exit0; 507 passed, 0 failed, 9 intentionally skipped Redis cases; 59 actual test-file results, queue19/19 |
| `pnpm lint`; `pnpm typecheck`; `pnpm build` | each exit0; Next16.3.8 and custom-server TypeScript |
| `pnpm audit --prod --json` | exit0; 312 production dependencies, zero all severities |
| Serial `pnpm exec playwright test --workers=1 --reporter=line,json` | exit0; 10 passed, 1 gated live skip, zero unexpected/flaky/global errors; 90.658s |
| Headed complete live YouTube, first fresh run | exit1; native actor reaches paused but Play overlay does not converge within30s; 45.840s total |
| Same complete live spec, unchanged code, `--trace=on` | exit0; entire add/play/pause/seek/late/reconnect/degraded flow passes; 46.048s |
| Bounded read-only real-YouTube/socket pause diagnostic | exit1; first two native pause cycles converge, third loses the intent before transmission; 34.759s |
| Same bounded diagnostic with read-only guard logpoints | exit1; third cycle lost again; current hook accepts, Player rejects at recent-seek guard (1308 ms < 1500 ms); 34.072s |

The default nine opt-in Redis cases previously ran against the owned real Redis
instance in the final-wave gate. That adapter/Lua/persistence/provider source is
unchanged by the one-line queue correction; this follow-up did not claim a new
real-Redis execution. The full current unit run includes the actual-SQL migration
tests. Local PostgreSQL-engine proof remains distinct from a deployed Supabase
or PostgREST check.

### New remaining UX finding: native Pause never reaches the room

The failed complete live test and passing traced replay used the same product
revision and physical WAN. Neither failed at auth, metadata, video initialization
or an observed quota rejection. Because the first run had no trace, controller
ran one bounded diagnostic with a filtered Socket.IO event capture, real three
browser contexts and real YouTube controls. It recorded no authentication
packets/tokens, changed no checked-in product/test source, and made no external writes
beyond the owned local test rooms and ordinary provider requests.

Positive controls captured native Pause commands from client2 in the first two
cycles and verified all three iframe states become paused. In cycle3 all three
iframes were playing. Client2 clicked native Pause and reached YouTube state2 at
position5.124, while clients1/3 remained playing. No outgoing Pause or subsequent
native Play command was recorded in that failed cycle; the room's last canonical
frame remained playing at sequence21. Eight seconds later client2 had resumed
itself and all three players advanced. This is lost user intent, not only a
missing test button or a server-rejected command. The capture had also observed
unrequested `fromNative` Seek emissions after owner Play, before this pause.

The [boundary summary](2026-10-02-native-pause-boundary.json) preserves literal
states/times/counts from this initial boundary capture and the later guard trace.
Full filtered events, screenshots and traces remain in the ignored plan/output
evidence workspace. The initial capture identified candidate epoch/health,
recent-programmatic-seek and deferred-validation boundaries, but did not yet
identify which rejected the intent.

One subsequent bounded observation installed always-false conditional logpoints
on the actual loaded local browser script, without replacing product source or
intentionally pausing execution. The first two native Pause cycles again passed;
cycle3 again lost the intent. Client2's hook accepted Pause with ready health,
no pending reconciliation and the current provider epoch4/sequence21. At the
Player hard guard, YouTube control permission was true, media transition was
null, scrubber dragging was false, and the programmatic-seek age was **1308 ms**.
The sole true rejecting condition was
`intentManager.isRecentProgrammaticSeek(1500)` in `components/Player.tsx:488`;
its predicate in `lib/playback-intent-manager.ts:269` is a simple elapsed-time
comparison. No deferred-Pause callback or outgoing Pause followed. The actor
then resumed while canonical sequence21 remained playing.

All four observation points were installed for each of the three clients;
there were zero observer scope errors and zero actual debugger pauses. This
establishes the rejecting branch for this observed failure, not a deterministic
regression or a correction. Debugger instrumentation can still affect timing;
the unchanged initial boundary capture independently established the same lost
intent without these logpoints. Same-WAN timing may influence provider ordering,
but this is client-side user intent filtered before transmission, not an observed
shared-IP quota or server-permission rejection. No fix is guessed, and the
buffering/stale-event safeguards remain unchanged.

F4/N1 is closed; this separate live UX finding keeps the goal and full acceptance
open. The agreed post-cap queue iteration is complete. A new production change
requires a separately scoped user decision, not a silent second correction wave.
Generated Next declarations were restored after all owned browser servers
stopped. Primary main/index, prior output and new diagnostic evidence are
preserved; no merge, push, deploy, live database mutation or cleanup occurred.
