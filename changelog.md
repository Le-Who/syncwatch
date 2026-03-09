# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

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

- **Player Sync Loop:** Removed arbitrary `timeSinceMediaStart` limits from `handleNativePlay` and `handleNativePause` in `Player.tsx`. This fixes an aggressive rubber-banding issue when rapidly scrubbing Native YouTube components that emit successive stop/seek/play events.
- **Twitch Embed Initialization:** Conditioned the `ReactPlayer` `controls` prop to include `Twitch`. By explicitly rendering native Twitch controls, the embedded iframe complies with strict browser/Twitch autoplay rules and requires manual user initialization before syncing successfully.
- **E2E Playwright Tests:** Fixed a minor TypeScript error accessing `_options.baseURL` within `e2e/helpers/room.ts`.
- **E2E Playwright Tests:** Fixed a flaky locator within `e2e/network_resilience.spec.ts` where the test attempted to interact with the center Player overlay initialization bar after mistakenly switching to the Queue sidebar.
- **Database Write-Behind Timeouts Data Loss**: Fixed a critical bug in `lib/redis-queue-worker.ts` where the worker used `lpop` to destroy queued commands before successful Database insertion. Replaced with atomic `lrange` and `ltrim` to ensure queues safely preserve data on DB 500/timeout errors.
- **Queue Worker Data Loss**: Fixed a critical persistence hole where slow-path operations in `lib/redis-queue-worker.ts` modified Redis state but failed to enqueue the room for Supabase synchronization. Extracted queueing to `markRoomForSync` to decouple it from the DB client.
- **Intent Mask Locator Drift**: Fixed E2E test locator instability by replacing brittle CSS class locators (`.react-player-wrapper`) with concrete `data-testid="player-interaction-layer"` data attributes.

### Changed

- **Backend Code Testability**: Exported `workerInterval` in `server.ts` to allow test suites to cleanly shut down write-behind background loops, preventing event loop leaks.
