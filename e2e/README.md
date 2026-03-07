# Testing Strategy Document

## Coverage Goals

- **Unit Tests (Jest):** Focus on `store.ts` (Zustand state consistency) and `/api/metadata` (URL/thumbnail parsing).
- **Integration Tests (Socket.io):** Target `server.ts` Command Handling to ensure optimistic UI isn't rejected, and global buffering isn't forced.
- **E2E Tests (Playwright):** Critical user flows (Playback sync, Pause enforcement, seeking, UI bounds for volume).

## Test Execution

- **Unit:** Run on every pull request (`npm run test:unit`)
- **E2E:** Run before deployment to verify video sync mechanisms (`npm run test:e2e`)

## Tools

- **Unit:** Vitest / Jest
- **E2E:** Playwright
- **Coverage:** Istanbul/nyc

## Test Cases for Recent Regressions

### 1. E2E: Volume Slider Native Range

**Scenario:** Ensure volume slider allows continuous partial volume values, not just 0 or 100.
**Test:** Playwright injects value `0.5`, reads the DOM `HTMLAudioElement.volume` property.

### 2. E2E: Thumbnails in Playlist

**Scenario:** Ensure fetching a YouTube URL populates the thumbnail img tag correctly in the playlist UI.
**Test:** Paste YouTube URL into the search/init box. Wait for UI, verify `<img src="...">` exists.

### 3. Unit: Server Handling of Pause (Optimistic UI)

**Scenario:** The server must respect a manual play/pause and broadcast it, without immediate bounce.
**Test:** Jest spies on Zustand `set` within `syncPlayback`, ensuring that if `lastCommandEmitTime` is < 1500ms, it skips local overwrite.

### 4. Integration: Buffering Deadlock Avoidance

**Scenario:** A joining user emitting an `onBuffer` native event must NOT trigger a global `buffering` state change on the server.
**Test:** Connect multiple clients. Client 2 emits `buffering`. Verify `room_state` broadcast does NOT change `playback.status` for all clients.

### 5. E2E: Timer Overflow & Video End

**Scenario:** ensure the elapsed timer doesn't continue ticking and loop back when a video reaches duration limit without looping.
**Test:** Playwright mocks video duration to 5s. Wait 6s. Assert `room.playback.status === "ended"` and timer `< duration`.
