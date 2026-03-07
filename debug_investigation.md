# Investigating Player Disappearance Bug

## Phase 1: Root Cause

- [ ] Launch `browser_subagent` to hit `localhost:3000/room/testroom`
- [ ] Connect with name `DebugBot`
- [ ] Attempt to add a YouTube video `https://www.youtube.com/watch?v=aqz-KE-bpKQ`
- [ ] Read the console logs for React key/hydration/runtime errors
- [ ] Execute `document.querySelector('iframe')` to see if the DOM actually has the player mounted
- [ ] Check if `currentMedia` state is correctly distributed to clients

## Next Steps

- TBD based on Phase 1 output
