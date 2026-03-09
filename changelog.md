# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- **Player Sync Loop:** Removed arbitrary `timeSinceMediaStart` limits from `handleNativePlay` and `handleNativePause` in `Player.tsx`. This fixes an aggressive rubber-banding issue when rapidly scrubbing Native YouTube components that emit successive stop/seek/play events.
- **Twitch Embed Initialization:** Conditioned the `ReactPlayer` `controls` prop to include `Twitch`. By explicitly rendering native Twitch controls, the embedded iframe complies with strict browser/Twitch autoplay rules and requires manual user initialization before syncing successfully.
- **E2E Playwright Tests:** Fixed a minor TypeScript error accessing `_options.baseURL` within `e2e/helpers/room.ts`.
- **E2E Playwright Tests:** Fixed a flaky locator within `e2e/network_resilience.spec.ts` where the test attempted to interact with the center Player overlay initialization bar after mistakenly switching to the Queue sidebar.
