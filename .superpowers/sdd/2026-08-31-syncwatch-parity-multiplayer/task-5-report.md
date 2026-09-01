# Task 5 report — participant-local buffering and reconciliation

Status: DONE

Base: `c2775fa246e2b27f50f9ec0ca97627601269feb7`

## TDD evidence

Observable RED was captured before each implementation group:

- the new playback-health suite could not resolve `lib/playback-health`;
- provider `waiting` emitted a canonical `buffering` room command, stale media and reconnect callbacks still changed current local state, and the UI exposed raw drift instead of the required human states;
- long-stall, reconnect, media-change, and provider-reinitialization recovery had no monotonic coordinator to force reconciliation to current canonical time;
- `PlaybackIntentManager` did not dispose its owned guards/timers;
- legacy in-memory and Redis `buffering` commands mutated canonical playback instead of remaining compatibility no-ops;
- compact duplicates, older sequences, wrong-media events, and older room snapshots could overwrite newer client state;
- participant-health transport did not exist, and a real Socket.IO health event timed out;
- Twitch proxy listeners and the delayed recovery timer survived cleanup/remount;
- the real `usePlaybackSync` harness initially demonstrated that recovery must target the advancing canonical position, including elapsed server time, rather than the stale base position.

Each failure was then made GREEN with deterministic clocks, provider callbacks, real hook/component harnesses, and the existing Socket.IO test seam.

## Implemented behavior

- Canonical playback remains `playing | paused | ended`. Provider waiting, stalls, readiness, reconnects, and errors are participant-local and never mutate the room timeline.
- Added a pure `PlaybackHealthController` with local health, stall duration, recovery mode, latest-value telemetry coalescing (at most one effective update per second), and exact timer disposal.
- Added a monotonic `PlaybackCoordinator` that rejects duplicates, older sequences, and wrong-media events; media changes establish a new epoch. It computes the current canonical target with server-clock offset and selects provider-aware rate nudges or hard seeks.
- Long stalls, reconnects, media switches, and provider reinitialization recover only the affected player to current canonical time. Paused/ended rooms remain non-playing during recovery.
- Provider callbacks are guarded by media ID, canonical sequence, and provider epoch, so delayed events cannot win after a switch or reconnect. Twitch listeners and recovery timers now have identity-exact cleanup.
- `Player` owns its health controller and intent manager, publishes coalesced participant telemetry outside the command timeline, and keeps Task 4 exact nonce ACK/event completion intact. Reconciliation is not held behind obsolete optimistic intent.
- Server participant-health updates are identity/room-bound ephemeral state. They do not increment canonical playback sequence or publish a playback command.
- Legacy `buffering` command input is an authorized compatibility no-op in both in-memory and Redis paths. Legacy persisted canonical `buffering` still hydrates deterministically to `paused`.
- Client room/compact reducers now preserve monotonic sequence and media identity while allowing same-sequence presence/health updates.
- The player presents `Synced`, `Catching up`, `Local buffering`, and `Reconnecting`; raw drift is secondary detail. The local overlay explicitly says friends continue watching and catch-up is automatic.
- Matrix tests cover 1, 3, 5, and 25 participants with arbitrary buffering/reconnecting subsets. Healthy peers continue to observe an advancing canonical timeline.

## Files changed

Core production changes:

- `lib/playback-health.ts`
- `hooks/usePlaybackSync.ts`
- `hooks/usePlayerEvents.ts`
- `lib/playback-intent-manager.ts`
- `lib/player-adapters.ts`
- `lib/store.ts`
- `lib/socket.ts`
- `lib/socket/connection.ts`
- `lib/room-logic.ts`
- `lib/redis-lua.ts`
- `lib/zod-schemas.ts`
- `components/Player.tsx`
- `components/SyncStatusBadge.tsx`
- `components/overlays/BufferingOverlay.tsx`
- `README.md`
- `changelog.md`

Tests and harnesses:

- `__tests__/playback-health.test.ts`
- `components/__tests__/player-test-harness.tsx`
- `hooks/__tests__/usePlaybackSync.test.tsx`
- `components/__tests__/Player.test.tsx`
- `lib/__tests__/playback-intent-manager.test.ts`
- `lib/__tests__/player-adapters.test.ts`
- `lib/__tests__/store.test.ts`
- `__tests__/room-command-service.test.ts`
- `__tests__/fast_path.test.ts`
- `__tests__/helpers/redis-mock.ts`
- `__tests__/server.test.ts`
- `hooks/__tests__/usePlaybackIntentAcknowledgement.test.tsx`

## Verification

- Required focused command: 3 files, 61 tests passed.
- Additional transport/reducer/hook/adapter focused command: 7 files, 94 tests passed.
- `pnpm test`: 43 files, 369 tests passed.
- `pnpm lint`: exit 0.
- `pnpm exec tsc --noEmit --pretty false`: exit 0, no diagnostics.
- `pnpm build`: exit 0; Next production build and server TypeScript build completed. Existing Browserslist-age and npm configuration notices remain informational.
- Scoped Prettier and `git diff --check`: exit 0.

## Self-review and concerns

- Task 3 lifecycle/connection ownership is preserved. Health updates use the authenticated participant context and cannot become playback authorization or canonical ordering input.
- Task 4 nonce semantics remain Player-instance scoped and event-driven. Exact playback events and acknowledgements retain their existing idempotent completion behavior.
- Same-sequence full room snapshots remain admissible so health/presence can update without manufacturing playback sequence changes; older snapshots and compact duplicates are rejected.
- Health telemetry is intentionally best-effort and ephemeral. A dropped health update can make another participant's badge briefly stale, but it cannot affect playback; the latest local transition is coalesced and eventually sent while connected.
- The build still prints the pre-existing Browserslist database age and npm configuration deprecation warnings.

## Review Fix Round 1

Status: DONE

### Verified RED findings

The review scenarios were reproduced before production changes. The focused RED run reported 11 failures:

- stalled YouTube, Twitch, and HTML5 chains emitted native seek/end and, for YouTube, the deferred native pause command;
- paused and ended canonical frames did not stop a locally stalled provider because `waiting` reconciliation returned too early;
- a same-sequence paused poll rolled back an optimistic exact play intent;
- health telemetry had no success contract or reconnect resend path;
- provider recovery eligibility and intent-baseline APIs did not exist;
- the reconnect badge disappeared as soon as transport connectivity returned and had no accessible name.

### Implemented fixes

- Provider-native pause, seek, end, and play callbacks now cross a shared eligibility boundary based on current media, sequence, provider epoch, local health, and recovery completion. The 150 ms pause callback repeats the checks with captured epoch/media/sequence, closing the delayed YouTube bypass. Explicit app controls still issue deliberate commands.
- `onSeeked` no longer treats a seek completion as proof that buffering recovered. Ready/playing signals update health, and canonical reconciliation decides playback before provider-native commands become eligible.
- Playback intents now record their media/sequence baseline. Polling defers only nonmatching same-epoch frames at or below that baseline; exact frames complete normally, while a genuinely newer unrelated canonical frame wins immediately.
- Paused/ended canonical decisions stop local playback even when target seek/rate reconciliation remains deferred by buffering or provider error. Recovery never transiently autoplays those states.
- Health telemetry reports send success. Failed/offline delivery retains the latest state without advancing the success timestamp; reconnect resends the actual current health, successful duplicates are suppressed within the one-second budget, and disposal removes pending timers.
- Player reconnect presentation remains `Reconnecting` after transport return until a fresh canonical frame is accepted and ready reconciliation completes. The status exposes an explicit accessible label.
- The product harness drives `waiting → pause/seek/ended` through the real Player/provider boundary for YouTube, Twitch, and HTML5. Two independent healthy coordinators consume the same three-participant canonical store and continue at 25 seconds while sequence 41 and playing state remain unchanged and no room command is captured.

### Verification

- Required focused command: 3 files, 69 tests passed.
- Hook/ACK/adapter focused command: 3 files, 30 tests passed.
- `pnpm test`: 43 files, 380 tests passed.
- `pnpm lint`: exit 0.
- `pnpm exec tsc --noEmit --pretty false`: exit 0, no diagnostics.
- `pnpm build`: exit 0; Next production and server TypeScript builds completed with only the pre-existing informational warnings.
- Scoped Prettier and `git diff --check`: exit 0.

### Boundaries and concerns

- Task 4 exact nonce ACK/event handling remains unchanged: the new baseline affects only stale polling reconciliation and never substitutes for nonce completion.
- Task 3 lifecycle and server health storage are unchanged. Redis/no-Redis legacy `buffering` remains an authorized canonical no-op.
- Health telemetry remains deliberately best-effort. Failed sends are retried on reconnect/current-state resend rather than by an unbounded background retry loop.
- Provider metadata/duration callbacks remain current-epoch operations; only playback-transition callbacks require ready recovery eligibility.

## Review Fix Round 2

Status: DONE

### Verified RED findings

The first focused RED run reported eight behavioral failures:

- a sequence-13 unrelated pause and a media epoch change did not clear a sequence-12 optimistic play intent;
- slow command-ack intents could still inherit a playback baseline and defer a same-sequence pause;
- force health resynchronization and connection-generation deduplication did not exist;
- the coordinator accepted a polled pre-disconnect snapshot as reconnect evidence;
- the sync hook cleared reconnect recovery before a newly delivered frame.

The authoritative multiplayer harness then failed to load because the production canonical reducer was not independently reusable. After extracting the exact reducer used by the app store, the real service/repository scenarios exercised the callback invariant end to end.

### Implemented fixes

- A strictly newer nonmatching canonical frame or media epoch now atomically supersedes the pending playback intent, clearing nonce, baseline, recent optimistic state, and expected status before reconciliation. Same/older same-media frames remain deferred; exact nonce frames retain normal Task 4 completion.
- Playback baselines are recorded only for `playback_update` intents. Player passes `null` for slow `command_ack` operations, and the manager enforces the same invariant defensively.
- `PlaybackHealthController.resyncCurrent(connectionGeneration)` force-publishes the actual current health once per generation even when it equals the previous successful value. It retains interval coalescing, latest-state semantics, send-success accounting, and exact disposal.
- Added canonical delivery versions to the client store and extracted `reduceCanonicalRoomEvent`, shared by production Zustand handling and independent test consumers. Equal-sequence full room frames count as fresh delivery; older rooms and duplicate/older compact playback remain rejected.
- `PlaybackCoordinator` now owns a reconnect delivery floor. Polling the same in-memory snapshot cannot satisfy it; a newly delivered frame above the floor is required, an older sequence remains invalid, and equal canonical sequence is accepted exactly once for reconnect hydration.
- `usePlaybackSync` marks the coordinator epoch while disconnected, waits while the fresh-frame gate remains closed, and lets accepted-frame state govern recovery completion. `onReconciled` fires only for an actual pending recovery, not every steady poll.
- Player health resend is keyed by connection generation. Its reconnect badge stays accessible and visible through transport recovery and stale polling, then changes to synced/catching-up only after a fresh authoritative frame reconciles.

### Authoritative multiplayer evidence

The new seven-test integration file uses:

- the real `Player` and `usePlayerEvents` provider boundary;
- real YouTube, Twitch, and HTML5 callback shapes;
- a real `RoomCommandService`, `InMemoryRoomRepository`, and `RoomEventBus`;
- the production canonical reducer feeding three independent client consumers.

For every provider it drives both `waiting → pause/seek/ended` and `pause schedules debounce → waiting before 150 ms → timer fires`. Any escaped command is executed by the real service and therefore can mutate/publish. The tests assert zero escaped commands/events, unchanged authoritative sequence/status/base position, and healthy B/C advancing to the hand-derived 25-second canonical target.

### Verification

- Required plus reconnect/intent/store focused command: 7 files, 121 tests passed.
- Authoritative multiplayer integration: 1 file, 7 tests passed.
- `pnpm test`: 44 files, 395 tests passed.
- `pnpm lint`: exit 0.
- `pnpm exec tsc --noEmit --pretty false`: exit 0, no diagnostics.
- `pnpm build`: exit 0; Next production and server TypeScript builds completed with only the pre-existing informational warnings.
- Scoped Prettier and `git diff --check`: exit 0.

### Boundaries and concerns

- Task 4 exact ACK/event subscriptions are unchanged. Supersession applies only when a different strictly newer authoritative frame or media epoch makes the local intent obsolete.
- Task 3 lifecycle and server connection ownership are unchanged. The delivery counter is local client metadata and does not enter room state, persistence, authorization, or Redis ordering.
- Equal-sequence reconnect hydration is limited to a strictly newer local delivery version inside an explicit connection epoch; ordinary compact duplicate rejection remains monotonic.
- Legacy buffering compatibility paths remain canonical no-ops in both Redis and no-Redis repositories.

## Review Fix Round 3

Status: DONE

### Verified RED findings

- The authoritative provider test originally invoked native pause only 500 ms after readiness. Its new eligible-pause control failed for Twitch and HTML5 (`[]` instead of `['pause']`), proving those cases were returning through Player's initialization/native guard rather than arming the 150 ms debounce.
- The healthy peers were previously handed `currentPosition: 25`, so their claimed advancement was an input assumption rather than an observed player action.
- The store's first duplicate disconnect test left transport generation at 4 instead of the expected 5, and the sub-interval sync test observed zero reconnect callbacks after a false-to-true pulse. Polling `isConnected` could not see a disconnect that completed between sync intervals.
- A strengthened pulse then exposed that a pre-disconnect delivery arriving between sync ticks could be mistaken for reconnect evidence. The store had to capture the exact delivery floor synchronously with the disconnect epoch rather than infer it from the hook's last poll.
- Once generation tracking was added, the duplicate-connect control initially called `joinRoom` twice, exposing a reconnect-notification flood until the connected handler was made idempotent.
- Review of the strengthened harness found that its sequence-changing control reset left a cached provider callback behind. The callback failed the production sequence guard before reaching pause/waiting behavior; an explicit local-buffering/player-state assertion reproduced the false positive.
- A media switch between sync ticks initially cleared the just-opened connection delivery floor because the coordinator reset media state after starting the connection epoch. Mounting a Player after the pulse also initialized its refs at the current epoch and incorrectly showed `Synced`, skipped health resend, and accepted the stale snapshot.

### Implemented fixes

- The degraded multiplayer harness now supplies a realistic provider clock and waits 3.1 seconds after metadata, beyond Player's 1.5-second initialization/native guard and Twitch's 2.5-second phantom-pause guard. For YouTube, Twitch, and HTML5, an eligible native pause is first proven to emit through the real `RoomCommandService` after 150 ms; the room is then authoritatively reset before the `pause -> waiting -> timer` chain proves zero escaped commands, events, or sequence/status changes.
- After the authoritative reset, the harness waits out Task 4's post-ack cooldown and reacquires the current-sequence provider callbacks. It asserts the pause really changed the provider's `playing` prop before waiting and that local buffering presentation appeared, closing both early-return false positives.
- Healthy B and C are separate `usePlaybackSync` consumers with independent local player state. Both begin at position 20, consume the shared production canonical store, and observably perform a hard seek to position 25 while stalled A remains participant-local.
- `AppState.connectionEpoch` now increments synchronously and exactly once for each connected-to-disconnected socket transition, alongside the exact `connectionDeliveryFloor` from that moment. Duplicate disconnects are ignored, and duplicate connected notifications no longer rejoin or re-upgrade the room.
- Player provider epochs, reconnect presentation, and force health resend are keyed to the store epoch. A batched disconnect/reconnect therefore invalidates retained provider callbacks and force-resends current health once even if React never renders the intermediate disconnected state.
- `usePlaybackSync` detects connection-epoch changes independently of connectivity polling. It opens the coordinator's fresh-delivery gate at the store-captured disconnect floor, so a fresh frame that arrived after the pulse can be accepted while both the old in-memory snapshot and a pre-disconnect frame unseen by the sleeping sync interval remain ineligible.
- Media and connection epochs are now orthogonal: switching media clears media canonical state without clearing an unresolved reconnect delivery floor, and the hook establishes the media epoch before applying the transport floor. A pre-drop media change cannot masquerade as a post-reconnect frame.
- Player and `usePlaybackSync` initialize directly into recovery when mounted after transport has returned but `canonicalDeliveryVersion` has not passed `connectionDeliveryFloor`. The badge starts as `Reconnecting`, current health is force-resend once, retained native callbacks are invalidated, and reconciliation still waits for a fresh delivery.
- The real store/socket integration pulse covers duplicate disconnect/connect notifications, one health resend, a rejected older room snapshot, an accepted freshly delivered equal-sequence `room_state`, the accessible `Reconnecting` badge, and exactly-once reconciliation completion.

### Verification

- Strengthened authoritative multiplayer integration: 1 file, 7 tests passed across YouTube, Twitch, and HTML5.
- Final focused Player/sync/store/health/intent/integration command: 6 files, 110 tests passed.
- `pnpm test`: 44 files, 399 tests passed.
- `pnpm lint`: exit 0.
- `pnpm exec tsc --noEmit --pretty false`: exit 0, no diagnostics.
- `pnpm build`: exit 0; Next production and server TypeScript builds completed with only the pre-existing Browserslist-age and npm configuration notices.
- Scoped Prettier and `git diff --check`: exit 0.
- Independent read-only re-review found no remaining Critical, Important, or Minor findings; its focused regression set passed 5 files / 73 tests, plus TypeScript and diff checks.

### Boundaries and concerns

- Task 4 exact nonce completion, pending-intent supersession, and compact-only baselines are unchanged. Connection generation is local transport metadata and never enters canonical ordering or authorization.
- Task 3 socket ownership remains in `RoomSocketService`/the app store. The connected/disconnected handlers only deduplicate transport notifications; they do not introduce a second socket lifecycle.
- Prior participant-local waiting/error guards, paused/ended stall handling, success-aware health coalescing, and Redis/no-Redis legacy buffering no-ops are preserved.
- The test socket emits duplicate connect notifications deliberately; production Socket.IO normally emits one, but the store and health paths are now idempotent if a duplicate is observed.
