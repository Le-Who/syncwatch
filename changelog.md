# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Architecture Refactoring**: Extracted core media synchronization mathematics and Intent Masking out of `Player.tsx` and into a dedicated `usePlaybackSync` hook.
- **Provider Adapters**: Isolated Twitch-specific DOM manipulation into `lib/player-adapters.ts` (`applyTwitchEventProxy`) to decouple it from React's rendering lifecycle.
- **QA Architecture**: Established strict AAA (Arrange-Act-Assert) conventions across all E2E and integration tests. Added `fast_path.test.ts` to independently verify Lua mutations without DB locks.
- **Test Infrastructure (`server.test.ts`)**: Implemented `waitForSocketEvent` utility for integration tests to enforce strict AAA (Arrange-Act-Assert) patterns and eliminate race conditions within Socket.io callbacks. Added Test Case 304 (`worker_resilience.test.ts`) to verify database write-behind queue recovery.
- **E2E Playwright Resilience**: Added TC-303 (`high_latency_sync.spec.ts`) utilizing CDP to simulate 500ms network latency to mathematically prove the drift-math algorithms compensate for network chaos correctly.

### Fixed

- **Player Sync Loop:** Removed arbitrary `timeSinceMediaStart` limits from `handleNativePlay` and `handleNativePause` in `Player.tsx`. This fixes an aggressive rubber-banding issue when rapidly scrubbing Native YouTube components that emit successive stop/seek/play events.
- **Twitch Embed Initialization:** Conditioned the `ReactPlayer` `controls` prop to include `Twitch`. By explicitly rendering native Twitch controls, the embedded iframe complies with strict browser/Twitch autoplay rules and requires manual user initialization before syncing successfully.
- **E2E Playwright Tests:** Fixed a minor TypeScript error accessing `_options.baseURL` within `e2e/helpers/room.ts`.
- **E2E Playwright Tests:** Fixed a flaky locator within `e2e/network_resilience.spec.ts` where the test attempted to interact with the center Player overlay initialization bar after mistakenly switching to the Queue sidebar.
- **Database Write-Behind Timeouts Data Loss**: Fixed a critical bug in `lib/redis-queue-worker.ts` where the worker used `lpop` to destroy queued commands before successful Database insertion. Replaced with atomic `lrange` and `ltrim` to ensure queues safely preserve data on DB 500/timeout errors.
- **Intent Mask Locator Drift**: Fixed E2E test locator instability by replacing brittle CSS class locators (`.react-player-wrapper`) with concrete `data-testid="player-interaction-layer"` data attributes.

### Changed

- **Backend Code Testability**: Exported `workerInterval` in `server.ts` to allow test suites to cleanly shut down write-behind background loops, preventing event loop leaks.
