import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { executeFastMutation } from "./lib/redis-lua";
import { createEmptyRoom } from "./lib/room-handler";
import { setRedisRoom } from "./lib/redis-actor";

async function runTest() {
  const roomId = "test-sync-room-" + Date.now();
  const room = createEmptyRoom(roomId, "Test");
  room.participants["user-1"] = {
    id: "user-1",
    role: "owner",
    nickname: "Alice",
    lastSeen: Date.now(),
  };
  room.settings.controlMode = "open";
  room.playback.status = "paused";
  room.playback.basePosition = 0;

  await setRedisRoom(roomId, room);

  console.log("Initial state saved.");

  // Test playing
  const playRes = await executeFastMutation(
    roomId,
    -1,
    "play",
    { position: 10, nonce: "123" },
    "user-1",
    "Alice",
  );
  console.log("Play Result:", JSON.stringify(playRes, null, 2));

  // Test pausing
  const pauseRes = await executeFastMutation(
    roomId,
    -1,
    "pause",
    { position: 15, nonce: "456" },
    "user-1",
    "Alice",
  );
  console.log("Pause Result:", JSON.stringify(pauseRes, null, 2));

  // Test pausing again (should return NO_CHANGE)
  const pauseRes2 = await executeFastMutation(
    roomId,
    -1,
    "pause",
    { position: 15, nonce: "789" },
    "user-1",
    "Alice",
  );
  console.log("Pause Again Result:", JSON.stringify(pauseRes2, null, 2));
}

runTest()
  .catch(console.error)
  .then(() => process.exit(0));
