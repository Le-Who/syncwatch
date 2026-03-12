# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Keyboard Shortcuts**: Arrow Left/Right (seek ±5s, Shift for ±10s), Arrow Up/Down (volume ±5%), F (fullscreen), T (theater mode). Guards against firing when typing in inputs.
- **Double-Click Fullscreen**: Double-clicking the player area toggles fullscreen mode.
- **ReconnectingOverlay**: New component shown when WebSocket disconnects, featuring auto-retry countdown, attempt counter, and manual retry button.
- **Toast Notifications**: Participant join/leave events now show toast notifications via sonner (👋 joined / 🚪 left).
- **Drift Hysteresis Tests**: Three new unit tests (TC-09, TC-10, TC-11) validating the hysteresis boundary behavior.

### Changed

- **SyncStatusBadge Redesign**: Replaced the old inline drift indicator with a 5-state floating badge (synced/syncing/drift/lost/offline) that shows smooth color transitions and auto-hides an "In Sync ✓" pulse when perfectly synced.
- **Buffering Overlay**: Now resolves the raw `updatedBy` participant ID to a human-readable nickname ("Waiting for Alice...").
- **Drift Hysteresis (drift-math.ts)**: `calculatePlaybackRate` now uses hysteresis (start correction at 0.6s, stop at 0.3s) to prevent audible pitch oscillation on YouTube when drift hovers near the correction boundary. Returns `{ rate, isAdjusting }` object.
- **Playlist Animations**: Playlist items now have smooth enter (fade+scale), exit (slide+fade), and layout reorder animations via motion/react.

### Fixed

- **Media Transition Guard Deadlock**: `PlaybackIntentManager.setMediaTransition()` now includes an active 8-second auto-expiry `setTimeout` to prevent permanent event blocking if `onReady` never fires or fires out of order.
- **Twitch Phantom Pause**: Added a 500ms `isRecentSeek()` guard in `handleNativePause` that blocks Twitch's asynchronous ghost PAUSE events fired after seek operations.
- **OCC Rollback Flicker on Owner**: Owner's `sync_correction` emissions in `usePlaybackSync.ts` now include a nonce via `intentManager.markCommandEmitted()`, preventing the broadcast echo-back from triggering a visible UI rollback.

- **Universal Sync Status Badge**: Added a floating drift indicator visible on all provider types (YouTube, Twitch, Vimeo, direct) showing real-time drift in milliseconds/seconds.
- **UpNext Overlay Dismissal**: Added an explicit dismiss button to the UpNext overlay that tracks dismissal state per media item.
- **Twitch Duration Polling**: Implemented an interval-based duration polling mechanism for Twitch VODs since the native embed API lacks reliable duration-change events.
- **Continuous Clock Sync**: Implemented dynamic `setInterval` daemon utilizing exponential backoff (1s→30s) and trimmed mean RTT offset calculations for ultra-stable clock parity.

### Changed

- **Sync Media Transition Guard**: Replaced the blunt 3-second `ignoreEventsFor(3000)` timer in `PlaybackIntentManager` with a precise state-based guard that blocks native events until `onReady` fires with the matching media ID.
- **YouTube Soft Rate Correction**: Added gentle ±3% playback rate adjustments specifically for YouTube iframes in `drift-math.ts` to allow smooth drift correction without noticeable audio distortion.
- **Player Overlay Interactions**: Redesigned the paused overlay to use `pointer-events: none` on the backdrop and `pointer-events: auto` only on the play button, allowing users to interact with underlying YouTube/Twitch native controls.
- **Mobile Room Layout**: Optimized mobile responsiveness by reducing player minimum height to 35vh and capping the sidebar at 45vh. Widened the theater mode reveal area for better discoverability.
- Global refactor: Removed the legacy `guest` terminology and replaced it with `viewer` across the TypeScript interfaces, Socket.io connection logic, and React UI to accurately reflect permission structures.
### Added

- **Continuous Clock Sync**: Implemented dynamic `setInterval` daemon utilizing exponential backoff (1s→30s) and trimmed mean RTT offset calculations for ultra-stable clock parity.
- **Adaptive Polling Intervals**: Client UI polling now dynamically shifts from 250ms to 2000ms based on measured drift magnitude.
- **PID-Style Correction**: Drift mathematical heuristics now gradually shift player framerates (±5%/±10%/±15% steps) between 0.5x and 2.0x depending on severity.
- **Network Buffering Propagation**: Plumbed the video player's raw `onWaiting` trigger out to the global DB room sequence to emit real-time buffering statuses to connected peers.
- **Centralized Rate Limiting**: Moved all endpoints (`/api/metadata`, `/api/youtube/*`) to an enterprise leaky-bucket `ioredis` rate limiter.
- **Architecture Refactoring (Intent Management)**: Extracted all timeout and boolean "intent masking" state variables from the `Player.tsx` god-component into a dedicated `PlaybackIntentManager` class, standardizing programmatic vs. native event precedence.
- **UI Modularization**: Extracted raw UI elements (`AwaitingSignal`, `UpNextOverlay`) from `Player.tsx` into standalone functional components.
- **Architecture Refactoring**: Extracted core media synchronization mathematics and Intent Masking out of `Player.tsx` and into a dedicated vanilla JS `SyncEngine`.
- **System Resilience (OOM Protection)**: Implemented strict backpressure mechanics and array limits (max 3000 items) on the Redis write-behind queue to prevent Node.js Out-of-Memory crashes during Supabase outages.
- **Native Twitch API Integration**: Replaced the `react-player` wrapper for Twitch streams with a dedicated `TwitchPlayer.tsx` component using the official `Twitch.Player` embed API, fixing unmount bugs and Autoplay Policy violations.
- **State & Network Decoupling**: Broke the cyclic dependency between `socket.ts` and `store.ts` by introducing an `EventEmitter` pattern. The store now subscribes to socket events passively.
- **Monolith Splitting**: Refactored the 1000+ line `server.ts` monolith by extracting routing/Zod validation into `lib/room-handler.ts` and background worker logic into `lib/db-sync.ts`. Further abstracted Socket.IO connections, commands, and PubSub logic into isolated files within `lib/socket/*` to achieve single-responsibility and protect the Next.js start lifecycle.
- **Provider Adapters**: Isolated Twitch-specific DOM manipulation into `lib/player-adapters.ts` (`applyTwitchEventProxy`) to decouple it from React's rendering lifecycle (Note: Partially deprecated by Native Twitch API).
- **QA Architecture**: Established strict AAA (Arrange-Act-Assert) conventions across all E2E and integration tests. Added `fast_path.test.ts` to independently verify Lua mutations without DB locks.
- **Test Infrastructure (`server.test.ts`)**: Implemented `waitForSocketEvent` utility for integration tests to enforce strict AAA (Arrange-Act-Assert) patterns and eliminate race conditions within Socket.io callbacks. Added Test Case 304 (`worker_resilience.test.ts`) to verify database write-behind queue recovery.
- **E2E Playwright Resilience**: Added TC-303 (`high_latency_sync.spec.ts`) utilizing CDP to simulate 500ms network latency to mathematically prove the drift-math algorithms compensate for network chaos correctly.
- **QA & Testing Strategy Finalization**: Completed comprehensive system audit and enforced strict Arrange-Act-Assert (AAA) compliance across all E2E boundaries. Refactored `playback_sync.spec.ts` and `high_latency_sync.spec.ts` for deterministic state validations.
- **Auth Boundary Unit Testing**: Implemented fully isolated unit tests in `room-handler.test.ts` to definitively verify guest privilege isolation logic beneath the Redis queue.

### Fixed

- **YouTube Playlist Expansion**: `AwaitingSignal` now automatically detects YouTube playlist URLs (`list=...`), fetches the full sequence via API, and enqueues all items instead of failing with a single broken 'direct media' record.
- **Playlist Auto-Switching**: Implemented server-side `video_ended` processing within the Redis queue worker. The room correctly auto-advances to the next video, pauses on the last frame, or loops back to the start in compliance with room `autoplayNext` and `looping` settings.
- **Auto-Pause on Queue Advancement**: Fixed an issue where the second video in a queue would automatically pause immediately after starting. Root cause: `handleNativePause` set local `playing=false` unconditionally before the `intentManager` guard, corrupting React state even when the event was supposed to be blocked. Fix: moved `setPlaying(false)` after the guard and added a 3-second event mask during media transitions.
- **Twitch Native Seek Quirks**: Mitigated an Embed API v1 flaw where native timeline scrubs forced sequential `PAUSE` events. An `intentManager` micro-debounce now ignores the ghost pause and automatically fires `.play()` to seamlessly maintain sync.

- **Redundant WebSocket Egress**: Eliminated double network bursts on programmatic seeks by replacing standalone `seek` and `play` socket loops with packaged `forceSeek: true` flags.
- **State Race Conditions**: Closed a closure leakage bug in `handleNativePause` by pulling state immutably from Zustand.
- **Follower Rubber-banding**: Re-tuned controlled mode followers so the UI doesn't visually stutter through constant hard programmatic rewinds within an acceptable tolerance.
- **Circuit Breaker Routing**: Fixed the YouTube Search circuit breaker which previously dead-ended requests natively instead of properly funneling closed pipes into the fallback Worker scraper.
- **Twitch VOD Playback**: Fixed an issue where the native Twitch embedded player would vertically compress to 150px. Further stabilized integration by disabling conflicting generic custom UI controls over Twitch iframes and resolving a `_.current.play is not a function` error during active synchronization pauses.
- **YouTube Playback Sync**: Fixed iframe origin mismatch issues during rapid scrub/pause actions by explicitly enforcing `enablejsapi: 1` and fallback target origins mapping.
- **UI Layout Overflow**: Resolved parasitic scrolling and infinite reflow cycles on both mobile and desktop views by migrating to `100dvh` and enforcing a hard root-level `overflow: hidden`.
- **Player Sync Loop:** Removed arbitrary `timeSinceMediaStart` limits from `handleNativePlay` and `handleNativePause` in `Player.tsx`. This fixes an aggressive rubber-banding issue when rapidly scrubbing Native YouTube components that emit successive stop/seek/play events.
- **Twitch Embed Initialization:** Conditioned the `ReactPlayer` `controls` prop to include `Twitch`. By explicitly rendering native Twitch controls, the embedded iframe complies with strict browser/Twitch autoplay rules and requires manual user initialization before syncing successfully.
- **E2E Playwright Tests:** Fixed a minor TypeScript error accessing `_options.baseURL` within `e2e/helpers/room.ts`.
- **E2E Playwright Tests:** Fixed a flaky locator within `e2e/network_resilience.spec.ts` where the test attempted to interact with the center Player overlay initialization bar after mistakenly switching to the Queue sidebar.
- **Database Write-Behind Timeouts Data Loss**: Fixed a critical bug in `lib/redis-queue-worker.ts` where the worker used `lpop` to destroy queued commands before successful Database insertion. Replaced with atomic `lrange` and `ltrim` to ensure queues safely preserve data on DB 500/timeout errors.
- **Queue Worker Data Loss**: Fixed a critical persistence hole where slow-path operations in `lib/redis-queue-worker.ts` modified Redis state but failed to enqueue the room for Supabase synchronization. Extracted queueing to `markRoomForSync` to decouple it from the DB client.
- **Intent Mask Locator Drift**: Fixed E2E test locator instability by replacing brittle CSS class locators (`.react-player-wrapper`) with concrete `data-testid="player-interaction-layer"` data attributes.

### Changed

- **Optimistic Sync Firewall**: Redesigned socket authentication to fall back to an unconditionally trusted client-provided UUID string. Completely removed the lethal `guest_` firewall block that caused degraded sessions to silently drop valid playback commands.
- **Package Identity**: Renamed `package.json` package identifier from `ai-studio-applet` to `syncwatch`.
- **API Mocks**: Updated Vitest to mock centralized Redis-based rate limiters with 503 expectations.
- **Backend Code Testability**: Exported `workerInterval` in `server.ts` to allow test suites to cleanly shut down write-behind background loops, preventing event loop leaks.
