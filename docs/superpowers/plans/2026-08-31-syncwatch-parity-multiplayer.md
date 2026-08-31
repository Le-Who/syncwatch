# SyncWatch Parity Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the useful SyncTube parity work into `main` and deliver a coherent YouTube watch-together experience for N participants, including independent degraded connections.

**Architecture:** Keep the server-authoritative room model, but route commands and events through shared contracts, a room command service, and a room event bus with equivalent Redis and in-memory adapters. Canonical playback contains only playing/paused/ended; buffering, readiness, drift, and provider errors remain participant-local and recover by reconciling to the latest server timeline.

**Tech Stack:** Node.js 24+, pnpm 10.28.2, Next.js 16, React 19, Zustand, Socket.IO, Redis/Lua, Supabase, Vitest, Testing Library, Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-08-31-syncwatch-parity-multiplayer-design.md`

## Global Constraints

- Room semantics must be independent of participant count; automated coverage uses 1, 3, 5, and 25 participants, while browser E2E uses five independent contexts.
- Canonical playback states are exactly `playing`, `paused`, and `ended`; buffering is local participant health.
- One or more degraded clients must never pause, rewind, or block healthy clients.
- Redis and no-Redis modes must enforce the same permissions and emit the same observable events.
- Before an active leader exists, every participant may control playback; afterward, the leader, owner, and moderators may control it.
- Every participant may append queue entries; only owner/moderators manage ordering and removal; only owner changes roles or ownership.
- Readiness is advisory and never an automatic playback gate.
- Exactly one media composer is visible in desktop and mobile room layouts.
- Every production behavior change follows red-green-refactor and keeps unrelated user changes outside the worktree.
- Multi-room E2E runs serially with a unique room ID per test.
- Functional and UX work precedes security hardening, but known token logging, identity claiming, 60-millisecond rate windows, and dependency patch floors must be addressed before completion.

## Planned File Structure

- `lib/room-command-contract.ts`: shared command envelope, command inference, acknowledgements, and stable rejection codes.
- `lib/permissions.ts`: the only runtime room-permission policy.
- `lib/room-events.ts`: exhaustive room event union and compact playback/presence payloads.
- `lib/room-event-bus.ts`: local delivery plus Redis propagation without self-echo duplication.
- `lib/room-repository.ts`: Redis and in-memory access boundary, including serialized in-memory mutations.
- `lib/room-command-service.ts`: room binding, permissions, mutation, acknowledgement, persistence, and publication.
- `lib/participant-lifecycle.ts`: pure join/reconnect/disconnect/leave/owner-handoff transitions.
- `lib/playback-health.ts`: participant-local health transitions and coalesced telemetry.
- `lib/socket/{commands,connection,pubsub,setup}.ts`: thin Socket.IO adapters around the boundaries above.
- `lib/{store,socket,types,room-handler,room-logic,redis-lua,redis-actor}.ts`: consume the shared contracts and normalized state.
- `hooks/{usePlayerEvents,usePlaybackSync}.ts`: provider events and reconciliation without shared buffering.
- `components/{Player,AwaitingSignal,MediaComposer,Playlist,Participants,SyncStatusBadge}.tsx`: player-first responsive UX with one composer.
- `components/overlays/ErrorOverlay.tsx`: local retry/reinitialize and authorized skip recovery.
- `__tests__/helpers/room-fixtures.ts`: count-agnostic room and participant builders shared by contract, lifecycle, and service tests.
- `components/__tests__/player-test-harness.tsx`: real-store player harness exposing provider callbacks without asserting on mocks alone.
- `e2e/helpers/{room,network}.ts`: N-client room harness and deterministic Chromium degradation controls.
- `e2e/{multiplayer-room,degraded-network,live-youtube-smoke}.spec.ts`: product-level acceptance flows.

---

### Task 1: Merge Parity as a Traceable Integration Checkpoint

**Files:**
- Merge: `codex/synctube-parity`
- Preserve: `docs/superpowers/specs/2026-08-31-syncwatch-parity-multiplayer-design.md`
- Preserve: `docs/superpowers/plans/2026-08-31-syncwatch-parity-multiplayer.md`

**Interfaces:**
- Consumes: audited parity commits `9e2bfa7` and `bcd16ed`.
- Produces: one merge commit containing the parity product surface, followed by a recorded green parity baseline.

- [ ] **Step 1: Confirm the worktree and branch are isolated**

Run:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

Expected: root ends in `.worktrees/syncwatch-ux-audit`, branch is `codex/syncwatch-ux-audit`, and only the plan document is uncommitted.

- [ ] **Step 2: Commit this implementation plan**

```powershell
git add docs/superpowers/plans/2026-08-31-syncwatch-parity-multiplayer.md
git commit -m "docs: plan multiplayer parity integration"
```

- [ ] **Step 3: Merge parity without flattening its history**

```powershell
git merge --no-ff codex/synctube-parity -m "merge: integrate synctube parity baseline"
```

Expected: merge succeeds without including the staged deletion from the primary checkout.

- [ ] **Step 4: Verify the parity baseline before repairs**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
```

Expected: 216 tests pass, lint exits 0, and build exits 0. Record any changed count rather than weakening assertions.

---

### Task 2: Canonical Types, Command Contract, and N-Participant Permission Policy

**Files:**
- Create: `lib/room-command-contract.ts`
- Modify: `lib/types.ts`
- Modify: `lib/zod-schemas.ts`
- Modify: `lib/permissions.ts`
- Modify: `lib/room-handler.ts`
- Modify: `lib/db-sync.ts`
- Test: `__tests__/room-command-contract.test.ts`
- Test: `__tests__/permissions.test.ts`
- Test: `__tests__/room-handler.test.ts`
- Create: `__tests__/helpers/room-fixtures.ts`

**Interfaces:**
- Consumes: parity `commandSchema`, `RoomState`, `getParticipantPermissions()`.
- Produces: `RoomCommand`, `RoomCommandEnvelope`, `CommandAcknowledgement`, `CommandRejectionCode`, `CanonicalPlaybackStatus`, `normalizeRoomState()`, count-agnostic room fixtures, and one permission matrix used by server and UI.

- [ ] **Step 1: Write failing contract tests**

Create tests equivalent to:

```ts
import { describe, expect, it } from "vitest";
import { roomCommandEnvelopeSchema } from "@/lib/room-command-contract";

describe("room command envelope", () => {
  it("accepts a bounded command bound to one room", () => {
    expect(roomCommandEnvelopeSchema.parse({
      roomId: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
      clientSequence: 7,
      command: { type: "play", payload: { position: 12.5 } },
    }).command.type).toBe("play");
  });

  it("rejects an oversized room id", () => {
    expect(() => roomCommandEnvelopeSchema.parse({
      roomId: "x".repeat(129),
      nonce: crypto.randomUUID(),
      clientSequence: 1,
      command: { type: "pause", payload: { position: 0 } },
    })).toThrow();
  });
});
```

Run:

```powershell
pnpm vitest run __tests__/room-command-contract.test.ts
```

Expected: FAIL because `room-command-contract.ts` does not exist.

- [ ] **Step 2: Write failing N-participant permission tests**

```ts
export function roomWithParticipants(
  participantCount: number,
  options: { leaderId?: string | null; ownerId?: string; moderatorIds?: string[] } = {},
): RoomState {
  const room = createEmptyRoom("room-test", "Test Room");
  const ownerId = options.ownerId ?? "p0";
  room.participants = Object.fromEntries(
    Array.from({ length: participantCount }, (_, index) => {
      const id = `p${index}`;
      const role = id === ownerId
        ? "owner"
        : options.moderatorIds?.includes(id)
          ? "moderator"
          : "viewer";
      return [id, { id, nickname: `Friend ${index + 1}`, role, joinedAt: index, lastSeen: index }];
    }),
  );
  room.leaderId = options.leaderId ?? null;
  return room;
}

export function participant(
  id: string,
  role: Participant["role"] = "viewer",
  joinedAt = 0,
): Participant {
  return {
    id,
    nickname: id,
    role,
    joinedAt,
    lastSeen: joinedAt,
    connection: "connected",
    playbackHealth: "idle",
    readyMediaId: null,
  };
}

export function roomWithOwnerAndFourFriends(): RoomState {
  return roomWithParticipants(5, {
    ownerId: "p0",
    moderatorIds: ["p1", "p2"],
    leaderId: null,
  });
}

for (const participantCount of [1, 3, 5, 25]) {
  it(`keeps leaderless playback open for ${participantCount} participants`, () => {
    const room = roomWithParticipants(participantCount, { leaderId: null });
    for (const id of Object.keys(room.participants)) {
      expect(getParticipantPermissions(room, id).canControlPlayback).toBe(true);
    }
  });
}

it("restricts viewers only while an active leader exists", () => {
  const room = roomWithParticipants(5, { leaderId: "p2", ownerId: "p0", moderatorIds: ["p1"] });
  expect(getParticipantPermissions(room, "p0").canControlPlayback).toBe(true);
  expect(getParticipantPermissions(room, "p1").canControlPlayback).toBe(true);
  expect(getParticipantPermissions(room, "p2").canControlPlayback).toBe(true);
  expect(getParticipantPermissions(room, "p3").canControlPlayback).toBe(false);
  expect(getParticipantPermissions(room, "p4").canControlPlayback).toBe(false);
});
```

Run:

```powershell
pnpm vitest run __tests__/permissions.test.ts
```

Expected: FAIL until the shared fixture and final policy exist.

- [ ] **Step 3: Implement the command contract and canonical types**

Use this public shape:

```ts
import { z } from "zod";
import { commandSchema } from "./zod-schemas";

export const roomCommandEnvelopeSchema = z.object({
  roomId: z.string().min(1).max(128),
  nonce: z.string().uuid(),
  clientSequence: z.number().int().nonnegative(),
  command: commandSchema,
});

export type RoomCommand = z.infer<typeof commandSchema>;
export type RoomCommandEnvelope = z.infer<typeof roomCommandEnvelopeSchema>;
export type CommandRejectionCode =
  | "INVALID_COMMAND"
  | "ROOM_MISMATCH"
  | "NOT_JOINED"
  | "NOT_PARTICIPANT"
  | "NOT_PERMITTED"
  | "STALE_MEDIA"
  | "DUPLICATE"
  | "QUEUE_FULL";

export interface CommandAcknowledgement {
  nonce: string;
  status: "applied" | "ignored" | "rejected";
  code?: CommandRejectionCode;
  message?: string;
  roomSequence?: number;
}
```

Define `PlaybackStatus` as `"playing" | "paused" | "ended"`, and add participant-local `ConnectionState` and `PlaybackHealth` fields. Keep parsing support for legacy persisted `buffering`, but normalize it to `paused` at hydration.

- [ ] **Step 4: Implement and centralize permissions**

`getParticipantPermissions(room, participantId)` must return:

```ts
return {
  canAddPlaylist: Boolean(participant),
  canEditPlaylist: isOwnerOrMod,
  canControlPlayback: Boolean(participant && (!hasActiveLeader || isLeader || isOwnerOrMod)),
  canManageRoom: isOwnerOrMod,
  isOwner,
  isOwnerOrMod,
  isLeader,
  hasActiveLeader,
};
```

Remove independent client-only interpretations of `controlMode`; retain the field only when reading legacy state.

- [ ] **Step 5: Normalize all room entry points**

Add a single `normalizeRoomState(room)` boundary that supplies `chat: []`, `leaderId: null`, `flashbacks: {}`, participant runtime defaults, and canonical playback. Call it from Redis reads, DB hydration, room creation, and snapshot sanitization.

- [ ] **Step 6: Verify contracts and regression suite**

Run:

```powershell
pnpm vitest run __tests__/room-command-contract.test.ts __tests__/permissions.test.ts __tests__/room-handler.test.ts __tests__/zod-boundary.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit the contract boundary**

```powershell
git add lib/room-command-contract.ts lib/types.ts lib/zod-schemas.ts lib/permissions.ts lib/room-handler.ts lib/db-sync.ts __tests__/helpers/room-fixtures.ts __tests__/room-command-contract.test.ts __tests__/permissions.test.ts __tests__/room-handler.test.ts
git commit -m "refactor: unify room command and permission contracts"
```

---

### Task 3: Event Bus and Participant Lifecycle for Redis and In-Memory Rooms

**Files:**
- Create: `lib/room-events.ts`
- Create: `lib/room-event-bus.ts`
- Create: `lib/participant-lifecycle.ts`
- Modify: `lib/socket/connection.ts`
- Modify: `lib/socket/pubsub.ts`
- Modify: `lib/socket.ts`
- Modify: `server.ts`
- Modify: `lib/store.ts`
- Test: `lib/__tests__/store.test.ts`
- Test: `__tests__/room-event-bus.test.ts`
- Test: `__tests__/participant-lifecycle.test.ts`
- Test: `__tests__/server.test.ts`

**Interfaces:**
- Consumes: normalized `RoomState`, Socket.IO `Server`, Redis publish/subscribe clients.
- Produces: exhaustive `RoomEvent`, `RoomEventBus.publish()`, `joinParticipant()`, `markParticipantDisconnected()`, and `removeParticipantAfterGrace()`.

- [ ] **Step 1: Write failing event-bus parity tests**

```ts
const event = { type: "participant_joined", participant: participant("p4") } as const;
await inMemoryBus.publish("room-a", event);
expect(localEmit).toHaveBeenCalledOnce();

await redisBus.publish("room-a", event);
expect(localEmit).toHaveBeenCalledOnce();
expect(redisPublish).toHaveBeenCalledOnce();

redisBus.handleRemote({ sourceNodeId: redisBus.nodeId, roomId: "room-a", event });
expect(localEmit).toHaveBeenCalledOnce();
```

Run:

```powershell
pnpm vitest run __tests__/room-event-bus.test.ts
```

Expected: FAIL because the event bus does not exist.

- [ ] **Step 2: Write failing five-participant lifecycle tests**

```ts
it("broadcasts every join and converges to five participants", () => {
  let room = createRoom("room-a");
  for (let index = 0; index < 5; index++) {
    room = joinParticipant(room, participant(`p${index}`, index === 0 ? "owner" : "viewer"), index);
  }
  expect(Object.keys(room.participants)).toHaveLength(5);
});

it("elects the oldest connected moderator after owner grace expires", () => {
  const next = removeParticipantAfterGrace(roomWithOwnerAndFourFriends(), "owner", 20_000);
  expect(Object.values(next.participants).filter((p) => p.role === "owner")).toHaveLength(1);
  expect(next.participants.moderator0.role).toBe("owner");
});
```

Run:

```powershell
pnpm vitest run __tests__/participant-lifecycle.test.ts
```

Expected: FAIL because lifecycle transitions are still embedded in the socket handler.

- [ ] **Step 3: Define the exhaustive room-event union**

```ts
export type RoomEvent =
  | { type: "room_state"; room: RoomState; serverTime: number }
  | { type: "playback_updated"; playback: CanonicalPlayback; serverTime: number }
  | { type: "participant_joined"; participant: Participant }
  | { type: "participant_reconnected"; participant: Participant }
  | { type: "participant_disconnected"; participantId: string }
  | { type: "participant_left"; participantId: string; ownerId: string | null }
  | { type: "participant_health"; participantId: string; health: PlaybackHealth };
```

Use an exhaustive `switch` with a `never` default in the Socket.IO emitter and Zustand reducer.

- [ ] **Step 4: Implement local-first event publication**

`RoomEventBus.publish(roomId, event)` must emit locally once, then publish `{ sourceNodeId, roomId, event }` to Redis when configured. Remote messages with the same `sourceNodeId` are ignored; other-node messages are emitted locally once.

- [ ] **Step 5: Extract pure lifecycle transitions**

Use `joinedAt` and connection state instead of object-order side effects. Owner election order is: oldest connected moderator, then oldest connected viewer. Reconnect within 15 seconds cancels departure and preserves role/leader.

- [ ] **Step 6: Replace direct presence publication in the socket handler**

`join_room`, disconnect, reconnect, grace expiry, and owner/leader departure call the lifecycle functions and publish through `RoomEventBus`. Remove the unreachable post-promotion condition that previously suppressed `room_state`.

- [ ] **Step 7: Give one owner responsibility for socket listener lifecycle**

`RoomSocketService.connect()` registers each global event once and `disconnect()` unregisters the same function references. A remount test calls connect/disconnect/connect and asserts one state reduction for one incoming event.

```ts
service.connect("room-a", "Friend", "p0", token);
service.disconnect();
service.connect("room-a", "Friend", "p0", token);
fakeSocket.serverEmit("participant_joined", participant("p1"));
expect(onRoomEvent).toHaveBeenCalledTimes(1);
```

- [ ] **Step 8: Verify both adapters and socket behavior**

```powershell
pnpm vitest run __tests__/room-event-bus.test.ts __tests__/participant-lifecycle.test.ts __tests__/server.test.ts lib/__tests__/store.test.ts
```

Expected: all selected tests pass with no duplicate events.

- [ ] **Step 9: Commit lifecycle convergence**

```powershell
git add lib/room-events.ts lib/room-event-bus.ts lib/participant-lifecycle.ts lib/socket/connection.ts lib/socket/pubsub.ts lib/socket.ts lib/store.ts server.ts __tests__/room-event-bus.test.ts __tests__/participant-lifecycle.test.ts __tests__/server.test.ts lib/__tests__/store.test.ts
git commit -m "fix: converge multiplayer presence across room backends"
```

---

### Task 4: Room Repository and Command Service with Compact Playback Updates

**Files:**
- Create: `lib/room-repository.ts`
- Create: `lib/room-command-service.ts`
- Modify: `lib/socket/commands.ts`
- Modify: `lib/room-logic.ts`
- Modify: `lib/redis-lua.ts`
- Modify: `lib/redis-actor.ts`
- Modify: `lib/socket.ts`
- Modify: `lib/store.ts`
- Test: `__tests__/room-command-service.test.ts`
- Test: `__tests__/fast_path.test.ts`
- Test: `__tests__/occ_thrashing.test.ts`

**Interfaces:**
- Consumes: `RoomCommandEnvelope`, `RoomEventBus`, permissions, pure room mutations, persistence scheduler.
- Produces: `RoomRepository`, `RoomCommandService.execute(context, envelope)`, command acknowledgements, atomic playback updates, and serialized no-Redis behavior.

- [ ] **Step 1: Write failing no-Redis playback and room-binding tests**

```ts
function contextFor(roomId: string, participantId: string): SocketContext {
  return { currentRoomId: roomId, currentParticipantId: participantId };
}

function envelope<T extends RoomCommand["type"]>(
  roomId: string,
  type: T,
  payload: Extract<RoomCommand, { type: T }>["payload"],
): RoomCommandEnvelope {
  return {
    roomId,
    nonce: crypto.randomUUID(),
    clientSequence: 1,
    command: { type, payload } as RoomCommand,
  };
}

it("applies play in memory and emits only compact playback", async () => {
  const result = await service.execute(contextFor("room-a", "p0"), envelope("room-a", "play", { position: 8 }));
  expect(result.status).toBe("applied");
  expect(events).toEqual([expect.objectContaining({ type: "playback_updated" })]);
  expect((await repository.get("room-a"))?.playback.status).toBe("playing");
});

it("rejects a command targeting a room the socket did not join", async () => {
  const result = await service.execute(contextFor("room-a", "p0"), envelope("room-b", "pause", { position: 3 }));
  expect(result).toMatchObject({ status: "rejected", code: "ROOM_MISMATCH" });
});
```

Run:

```powershell
pnpm vitest run __tests__/room-command-service.test.ts
```

Expected: FAIL because the service and repository boundary do not exist.

- [ ] **Step 2: Write failing idempotency and stale-media tests**

Assert that the same nonce is applied once, and that `video_ended` or `next` carrying an old `currentMediaId` is rejected without changing the queue.

```ts
expect(await service.execute(ctx, command)).toMatchObject({ status: "applied" });
expect(await service.execute(ctx, command)).toMatchObject({ status: "ignored", code: "DUPLICATE" });
expect(room.sequence).toBe(sequenceAfterFirstApply);
```

- [ ] **Step 3: Implement the repository interface**

```ts
export interface RoomRepository {
  get(roomId: string): Promise<RoomState | null>;
  compareAndSet(roomId: string, expectedVersion: number, next: RoomState): Promise<boolean>;
  mutatePlayback(roomId: string, command: PlaybackCommand, actor: Participant): Promise<PlaybackMutationResult>;
  expire(roomId: string, ttlSeconds: number): Promise<void>;
}

export type PlaybackCommand = Extract<
  RoomCommand,
  { type: "play" | "pause" | "seek" | "update_rate" | "sync_correction" }
>;

export type PlaybackMutationResult =
  | { status: "applied"; room: RoomState; playback: CanonicalPlayback }
  | { status: "ignored"; code: "DUPLICATE" }
  | { status: "rejected"; code: CommandRejectionCode };
```

The in-memory implementation uses a per-room promise chain or mutex so concurrent mutations serialize. The Redis implementation delegates atomic playback mutation to Lua and CAS for slow state.

- [ ] **Step 4: Implement the command service**

Order execution as: parse envelope, verify joined-room binding, load participant, check nonce, enforce `getParticipantPermissions`, apply command, persist/schedule, publish one event, return acknowledgement. Keep stable rejection messages in one map keyed by `CommandRejectionCode`.

- [ ] **Step 5: Make playback ordering explicit**

The Redis Lua result and in-memory pure mutation both increment the canonical sequence and set server time. Do not pass an ignored expected version while claiming OCC. Playback is documented and tested as server-ordered last-writer-wins.

- [ ] **Step 6: Wire thin Socket.IO adapters and client acknowledgements**

`lib/socket/commands.ts` validates size and delegates to the service. `lib/socket.ts` emits the new envelope and resolves the matching `command_ack`; `lib/store.ts` surfaces rejected acknowledgements instead of silently waiting for a snapshot.

- [ ] **Step 7: Bound queue and chat state through acknowledged commands**

Add failing service tests for a 501st queue entry, duplicate URL, empty/oversized chat text, and chat history beyond the configured cap. The service returns `QUEUE_FULL` or `INVALID_COMMAND`; accepted chat uses server time and retains only the newest 200 messages.

```ts
expect(await service.execute(ctx, addItemTo(roomWithQueueLength(500)))).toMatchObject({
  status: "rejected",
  code: "QUEUE_FULL",
});
expect(room.chat).toHaveLength(200);
expect(room.chat.at(-1)?.message).toBe("newest");
```

Also assert that an unready or locally buffering participant does not reject an otherwise authorized `play` command.

- [ ] **Step 8: Verify command behavior and concurrency**

```powershell
pnpm vitest run __tests__/room-command-service.test.ts __tests__/fast_path.test.ts __tests__/occ_thrashing.test.ts __tests__/video_ended.test.ts
```

Expected: selected tests pass, including concurrent in-memory commands and stale media rejection.

- [ ] **Step 9: Commit the command boundary**

```powershell
git add lib/room-repository.ts lib/room-command-service.ts lib/socket/commands.ts lib/room-logic.ts lib/redis-lua.ts lib/redis-actor.ts lib/socket.ts lib/store.ts __tests__/room-command-service.test.ts __tests__/fast_path.test.ts __tests__/occ_thrashing.test.ts __tests__/video_ended.test.ts
git commit -m "refactor: centralize authoritative room commands"
```

---

### Task 5: Participant-Local Buffering and Playback Reconciliation

**Files:**
- Create: `lib/playback-health.ts`
- Modify: `hooks/usePlayerEvents.ts`
- Modify: `hooks/usePlaybackSync.ts`
- Modify: `lib/playback-intent-manager.ts`
- Modify: `lib/store.ts`
- Modify: `components/SyncStatusBadge.tsx`
- Modify: `components/overlays/BufferingOverlay.tsx`
- Create: `components/__tests__/player-test-harness.tsx`
- Test: `__tests__/playback-health.test.ts`
- Test: `lib/__tests__/playback-intent-manager.test.ts`
- Test: `components/__tests__/Player.test.tsx`

**Interfaces:**
- Consumes: canonical compact playback updates and provider callbacks.
- Produces: `PlaybackHealthController`, coalesced health events, local buffering UI, monotonic reconciliation, and recovery-to-current-time behavior.

- [ ] **Step 1: Write the failing shared-buffering regression test**

```ts
it("does not send a room playback command when one provider buffers", () => {
  const { result } = renderPlayerEvents({ canonicalStatus: "playing" });
  act(() => result.current.handleWaiting());
  expect(sendCommand).not.toHaveBeenCalledWith("buffering", expect.anything());
  expect(setPlaybackHealth).toHaveBeenCalledWith("buffering");
});
```

Run:

```powershell
pnpm vitest run components/__tests__/Player.test.tsx
```

Expected: FAIL because `handleWaiting()` currently emits canonical buffering.

- [ ] **Step 2: Write failing recovery and stale-event tests**

```ts
it("hard-seeks to the current canonical position after a long local stall", () => {
  controller.waiting(10_000);
  controller.playing(18_000, canonicalPlaying({ basePosition: 10, baseTimestamp: 10_000 }));
  expect(player.seekTo).toHaveBeenCalledWith(18, "seconds");
});

it("ignores a delayed playback update older than the last applied sequence", () => {
  coordinator.apply(playback({ sequence: 12, basePosition: 40 }));
  coordinator.apply(playback({ sequence: 11, basePosition: 5 }));
  expect(player.seekTo).not.toHaveBeenLastCalledWith(5, "seconds");
});
```

- [ ] **Step 3: Implement local health transitions**

```ts
export class PlaybackHealthController {
  private health: PlaybackHealth = "idle";
  set(next: PlaybackHealth): boolean {
    if (next === this.health) return false;
    this.health = next;
    return true;
  }
  current(): PlaybackHealth { return this.health; }
}
```

Coalesce telemetry to at most one update per participant per second. Telemetry updates People UI only.

- [ ] **Step 4: Remove canonical buffering mutations**

`handleWaiting` marks local health. `handlePlaying` clears local health and invokes normal reconciliation. The server rejects or ignores legacy `buffering` commands without changing room playback. Persisted legacy buffering normalizes to paused only during hydration.

- [ ] **Step 5: Apply compact playback updates monotonically**

Track last applied sequence and media ID in the playback coordinator. Compute target position using measured server clock offset. Use centralized provider thresholds for rate nudge versus hard seek; late join and long-stall recovery force reconciliation.

- [ ] **Step 6: Present human sync states**

Map coordinator/health state to `Synced`, `Catching up`, `Local buffering`, and `Reconnecting`; raw drift may appear as secondary diagnostic text, not the sole status.

- [ ] **Step 7: Verify playback recovery**

```powershell
pnpm vitest run __tests__/playback-health.test.ts lib/__tests__/playback-intent-manager.test.ts components/__tests__/Player.test.tsx
```

Expected: selected tests pass and no test expects canonical buffering.

- [ ] **Step 8: Commit local buffering semantics**

```powershell
git add lib/playback-health.ts hooks/usePlayerEvents.ts hooks/usePlaybackSync.ts lib/playback-intent-manager.ts lib/store.ts components/SyncStatusBadge.tsx components/overlays/BufferingOverlay.tsx components/__tests__/player-test-harness.tsx __tests__/playback-health.test.ts lib/__tests__/playback-intent-manager.test.ts components/__tests__/Player.test.tsx
git commit -m "fix: isolate buffering from the room timeline"
```

---

### Task 6: Player Recovery, One Composer, and Coherent Room UX

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/room/[id]/page.tsx`
- Modify: `components/Player.tsx`
- Modify: `components/AwaitingSignal.tsx`
- Modify: `components/MediaComposer.tsx`
- Modify: `components/Playlist.tsx`
- Modify: `components/Participants.tsx`
- Modify: `components/RoomSettingsDialog.tsx`
- Modify: `components/overlays/ErrorOverlay.tsx`
- Modify: `lib/player-adapters.ts`
- Test: `__tests__/components/AwaitingSignal.test.tsx`
- Test: `__tests__/components/Playlist.test.tsx`
- Test: `__tests__/components/Participants.test.tsx`
- Test: `components/__tests__/Player.test.tsx`

**Interfaces:**
- Consumes: permission policy, command acknowledgement, participant health, media composer services, ReactPlayer v3 adapters.
- Produces: one responsive composer, touch/keyboard-operable playback, actionable local error recovery, and server-consistent role/leader actions.

- [ ] **Step 1: Write the failing one-composer layout test**

```ts
it.each([
  { hasMedia: false, viewport: "desktop" },
  { hasMedia: true, viewport: "desktop" },
  { hasMedia: false, viewport: "mobile" },
  { hasMedia: true, viewport: "mobile" },
])("renders one media composer for $viewport with media=$hasMedia", ({ hasMedia }) => {
  renderRoom({ hasMedia });
  expect(screen.getAllByRole("textbox", { name: /youtube url or search/i })).toHaveLength(1);
});
```

Expected: FAIL on parity because multiple composers are visible.

- [ ] **Step 2: Write failing provider-error recovery tests**

```ts
it("keeps a provider error local and exposes retry", async () => {
  renderPlayer({ providerError: true, role: "viewer" });
  expect(screen.getByRole("button", { name: /retry video/i })).toBeVisible();
  expect(sendCommand).not.toHaveBeenCalledWith("next", expect.anything());
});

it.each(["owner", "moderator"] as const)("allows %s to skip an unavailable item", (role) => {
  renderPlayer({ providerError: true, role });
  expect(screen.getByRole("button", { name: /skip unavailable video/i })).toBeVisible();
});
```

- [ ] **Step 3: Render one logical composer conditionally**

Empty room: render `MediaComposer` in `AwaitingSignal`. Non-empty room: render it in the queue surface/drawer. Remove the always-on header instance and ensure hidden responsive copies are not mounted.

- [ ] **Step 4: Make room controls follow server permissions**

Participants uses `targetParticipantId`, explicit `transfer_owner`, and only roles accepted by the schema. Disabled/hidden actions derive from `getParticipantPermissions`; an acknowledgement rejection produces a toast and refreshes state.

- [ ] **Step 5: Implement local provider recovery**

`ErrorOverlay` receives `onRetry`, `onReinitializeSync`, and optional `onSkip`. Retry remounts the provider adapter without altering room state. Skip sends `next` with `currentMediaId` and is visible to leader/owner/moderator only.

- [ ] **Step 6: Complete ReactPlayer v3 and input accessibility**

Use supported callbacks such as `onSeeked`; remove unknown DOM `onSeek`. Direct-media custom controls remain visible on touch/focus, all icon buttons have accessible names, and YouTube native controls remain enabled.

- [ ] **Step 7: Replace machine-oriented critical copy**

Home and room primary actions use clear create/join/add/retry language. Diagnostic styling may remain, but connection and provider failures explain what the friend can do next.

- [ ] **Step 8: Verify component behavior**

```powershell
pnpm vitest run __tests__/components/AwaitingSignal.test.tsx __tests__/components/Playlist.test.tsx __tests__/components/Participants.test.tsx components/__tests__/Player.test.tsx
```

Expected: selected tests pass with one composer and actionable recovery.

- [ ] **Step 9: Commit room UX repairs**

```powershell
git add app/page.tsx 'app/room/[id]/page.tsx' components/Player.tsx components/AwaitingSignal.tsx components/MediaComposer.tsx components/Playlist.tsx components/Participants.tsx components/RoomSettingsDialog.tsx components/overlays/ErrorOverlay.tsx lib/player-adapters.ts __tests__/components/AwaitingSignal.test.tsx __tests__/components/Playlist.test.tsx __tests__/components/Participants.test.tsx components/__tests__/Player.test.tsx
git commit -m "fix: make multiplayer room controls coherent"
```

---

### Task 7: Deterministic N-Client and Degraded-Network E2E

**Files:**
- Modify: `playwright.config.ts`
- Modify: `e2e/helpers/room.ts`
- Create: `e2e/helpers/network.ts`
- Create: `e2e/multiplayer-room.spec.ts`
- Create: `e2e/degraded-network.spec.ts`
- Create: `e2e/live-youtube-smoke.spec.ts`
- Modify or remove stale assertions in: `e2e/*.spec.ts`
- Modify: `e2e/README.md`

**Interfaces:**
- Consumes: accessible room UI, Socket.IO reconnect, compact playback events, Chromium CDP.
- Produces: reusable `createRoomClients(count)`, `setLatency()`, `pulseOffline()`, and serial product-level acceptance tests.

- [ ] **Step 1: Build an N-client room harness**

```ts
export async function createRoomClients(browser: Browser, count: number, roomId = crypto.randomUUID()) {
  const clients: RoomClient[] = [];
  for (let index = 0; index < count; index++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await joinRoom(page, roomId, `Friend ${index + 1}`);
    clients.push({ context, page, nickname: `Friend ${index + 1}` });
  }
  return { roomId, clients };
}
```

Use public browser/context APIs only; remove access to private `_options` fields. Give tabs and controls stable accessible names or `data-testid` values.

- [ ] **Step 2: Add deterministic degradation helpers**

```ts
export async function setLatency(page: Page, latencyMs: number) {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: latencyMs,
    downloadThroughput: 1_500_000,
    uploadThroughput: 750_000,
    connectionType: "cellular3g",
  });
  return session;
}

export async function pulseOffline(context: BrowserContext, milliseconds: number) {
  await context.setOffline(true);
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  await context.setOffline(false);
}
```

Jitter alternates latency values on one or two selected contexts. Lower-level event-bus tests cover deliberate drop, duplication, and reordering.

- [ ] **Step 3: Write the five-client presence and control test**

Create five contexts, assert every People badge reaches 5, verify leaderless play from a viewer, activate a leader, assert another viewer receives `NOT_PERMITTED`, then verify leader and moderator controls reach all healthy clients.

- [ ] **Step 4: Write the degraded-client isolation test**

Start playback with five contexts. Apply 1500 ms latency to one and alternating 200/1200 ms latency to another. Trigger local waiting in the degraded context through the player test hook or deterministic adapter. Assert the other three remain canonically `playing` and advance. Restore the two clients and assert they converge within provider-aware tolerance.

- [ ] **Step 5: Write reconnect, late join, and owner-handoff tests**

Use a short offline pulse, a reconnect longer than one heartbeat but shorter than the grace period, and a permanent owner close. Assert no duplicate participants, preserved roles inside grace, one deterministic new owner after grace, released missing leader, and continued playback.

- [ ] **Step 6: Repair or replace stale parity E2E**

Replace the obsolete `Entities` selector with the current People surface through the shared page object. Remove tests whose only distinction is timing constants already covered by the new deterministic suite.

Add 1280×720 and 390×844 room checks that count visible composer inputs and require exactly one in empty and non-empty states.

- [ ] **Step 7: Add an opt-in real YouTube smoke**

Gate the headed external-provider test with `LIVE_YOUTUBE_SMOKE=1`. Use at least three contexts and a known embeddable URL supplied by the test constant. Perform user gesture initialization in every context; verify add, play, pause, seek, late/reconnect convergence, and healthy-client continuation during one degraded context.

- [ ] **Step 8: Run deterministic browser tests serially**

```powershell
pnpm exec playwright test e2e/multiplayer-room.spec.ts e2e/degraded-network.spec.ts --workers=1
```

Expected: all deterministic tests pass without arbitrary fixed sleeps for state convergence; helpers poll observable conditions.

- [ ] **Step 9: Commit the network acceptance suite**

```powershell
git add playwright.config.ts e2e
git commit -m "test: cover n-client rooms and degraded connections"
```

---

### Task 8: Focused Session, Rate-Limit, Dependency, and Documentation Hardening

**Files:**
- Modify: `app/api/auth/session/route.ts`
- Modify: `lib/jwt-config.ts`
- Modify: `lib/socket/setup.ts`
- Modify: `lib/redis-rate-limit.ts`
- Modify: `lib/rate-limit.ts`
- Modify: `lib/socket/commands.ts`
- Modify: `app/api/metadata/route.ts`
- Modify: `app/api/youtube/search/route.ts`
- Modify: `app/api/youtube/playlist/route.ts`
- Modify: `server.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`
- Modify: `README.md`
- Test: `__tests__/session-auth.test.ts`
- Test: `__tests__/rate-limit.test.ts`
- Test: `__tests__/server.test.ts`

**Interfaces:**
- Consumes: reconnectable HttpOnly session, Redis/local rate-limit adapter, current dependency audit.
- Produces: server-issued participant identity, production JWT-secret enforcement, bounded local rate limiting, corrected 60-second windows, restored command limits, and documented dependency risk.

- [ ] **Step 1: Write failing identity and log-safety tests**

```ts
it("does not sign an arbitrary participant id from the request body", async () => {
  const response = await POST(request({ participantId: "known-owner-id" }));
  const body = await response.json();
  expect(body.participantId).not.toBe("known-owner-id");
  expect(body.participantId).toMatch(/^[0-9a-f-]{36}$/i);
});

it("requires JWT_SECRET in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", "");
  expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
});
```

Run:

```powershell
pnpm vitest run __tests__/session-auth.test.ts
```

Expected: FAIL because arbitrary IDs are currently signed and a default secret is returned.

- [ ] **Step 2: Write failing local rate-limit tests**

```ts
it("allows exactly the configured number of events without Redis", async () => {
  const limiter = createRateLimiter({ redis: null, now: () => 1_000 });
  for (let index = 0; index < 20; index++) expect(await limiter.check("ip", 20, 60_000)).toBe(true);
  expect(await limiter.check("ip", 20, 60_000)).toBe(false);
});
```

Expected: FAIL because the Redis helper currently fails open.

- [ ] **Step 3: Issue and reuse server-owned identities**

If a valid session cookie exists, return its participant ID. Otherwise generate `crypto.randomUUID()`, sign it, and set the HttpOnly cookie. Reject malformed tokens without logging the token or complete handshake auth object.

- [ ] **Step 4: Enforce production secret and room-bound auth**

Use a development-only fallback with an explicit warning; production startup throws when `JWT_SECRET` is absent. Socket commands require the authenticated participant and current joined room established in context. Production Socket.IO CORS accepts only the normalized `NEXT_PUBLIC_APP_URL`; proxy-derived client IPs are used only when deployment configuration explicitly enables trusted forwarding.

- [ ] **Step 5: Provide exact Redis/local rate limits**

Use unique sorted-set members such as `${now}:${crypto.randomUUID()}` and reject when the pre-add count is `>= limit`. When Redis is unavailable, call the bounded in-memory limiter rather than returning true. Set metadata/search to `20, 60_000`, playlist to `10, 60_000`, auth to `10, 60_000`, join to `50, 60_000`, and commands to `60, 10_000`.

- [ ] **Step 6: Patch reachable dependency floors**

Use the registry to resolve maintained versions, requiring at least Next.js `16.2.11`, `socket.io-parser` `4.2.7`, `engine.io` `6.6.7`, PostCSS `8.5.23`, and Undici `7.29.0`. Place pnpm transitive overrides under the supported `pnpm.overrides` key, reinstall, and run `pnpm audit --prod`. Document residual `yt-search` advisories and its worker/timeout boundary if no compatible maintained replacement passes functional tests.

- [ ] **Step 7: Correct deployment documentation**

Set README to Node.js 24+, explain Redis-optional semantics accurately, document last-writer-wins playback, and ensure `.env.example` uses a clear placeholder rather than a publishable key under `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 8: Verify hardening**

```powershell
pnpm vitest run __tests__/session-auth.test.ts __tests__/rate-limit.test.ts __tests__/server.test.ts __tests__/metadata-api.test.ts app/api/youtube/search/__tests__/route.test.ts app/api/youtube/playlist/__tests__/route.test.ts
pnpm audit --prod
```

Expected: selected tests pass; audit output is captured and remaining advisories are documented rather than hidden.

- [ ] **Step 9: Commit operational hardening**

```powershell
git add app/api/auth/session/route.ts lib/jwt-config.ts lib/socket/setup.ts lib/redis-rate-limit.ts lib/rate-limit.ts lib/socket/commands.ts app/api/metadata/route.ts app/api/youtube/search/route.ts app/api/youtube/playlist/route.ts server.ts package.json pnpm-lock.yaml .env.example README.md __tests__/session-auth.test.ts __tests__/rate-limit.test.ts __tests__/server.test.ts
git commit -m "fix: harden friend-room session and runtime limits"
```

---

### Task 9: Real Redis Verification, Full Product Verification, and Audit Record

**Files:**
- Create: `docs/audits/2026-08-31-syncwatch-verification.md`
- Modify: implementation files only when a new failing regression test identifies a root cause.

**Interfaces:**
- Consumes: all prior tasks and the acceptance criteria in the design spec.
- Produces: fresh verification evidence, residual-risk record, reviewed diff, and a branch ready for the user's integration choice.

- [ ] **Step 1: Verify a real Redis lifecycle when available locally**

Start a disposable Redis instance on an unused local port, point the server/tests at its URL, and run join, pub/sub, Lua playback, reconnect, and owner-handoff integration tests. If the host cannot run Redis, record that exact environmental limitation and do not claim real-Redis acceptance from a fake adapter.

- [ ] **Step 2: Run the complete deterministic suite**

```powershell
pnpm test
pnpm lint
pnpm build
pnpm exec playwright test --workers=1
```

Expected: every command exits 0. A failure starts systematic debugging with a failing regression test; do not rerun blindly.

- [ ] **Step 3: Run the live three-client YouTube smoke**

```powershell
$env:LIVE_YOUTUBE_SMOKE='1'
pnpm exec playwright test e2e/live-youtube-smoke.spec.ts --headed --workers=1
Remove-Item Env:LIVE_YOUTUBE_SMOKE
```

Expected: play, pause, seek, late/reconnect convergence, and healthy-client continuation all pass. Metadata/ad-network failures alone are recorded but do not fail an initialized playable video.

- [ ] **Step 4: Inspect the actual final diff and requirements**

```powershell
git diff --check main...HEAD
git status --short
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
```

Map every design acceptance criterion to a test command, runtime observation, or exact file in the verification document.

- [ ] **Step 5: Request an independent code review**

Provide the reviewer with `BASE_SHA=$(git merge-base main HEAD)`, `HEAD_SHA=$(git rev-parse HEAD)`, the spec path, the plan path, and the requirement that all Critical and Important findings be fixed before proceeding. Re-run focused tests after each review fix.

- [ ] **Step 6: Write the verification and residual-risk record**

The document contains: branch SHAs, commands and exit codes, unit/E2E counts, browser matrix, Redis mode used, live YouTube result, audit summary, residual advisories with reachability, and any external-provider limitations actually observed.

- [ ] **Step 7: Commit the audit record and re-run final verification**

```powershell
git add docs/audits/2026-08-31-syncwatch-verification.md
git commit -m "docs: record syncwatch verification evidence"
pnpm test
pnpm lint
pnpm build
pnpm exec playwright test --workers=1
```

Expected: all final commands exit 0 on the committed tree.

- [ ] **Step 8: Present integration choices without modifying `main`**

Use the finishing-a-development-branch workflow and offer exactly: local merge into `main`, push and create a PR, or keep `codex/syncwatch-ux-audit` as-is. Preserve the worktree until the user chooses.
