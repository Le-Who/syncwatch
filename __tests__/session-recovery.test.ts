import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { useStore } from "../lib/store";
import { roomSocketService } from "../lib/socket";
import { roomWithParticipants } from "./helpers/room-fixtures";
import type {
  CommandAcknowledgement,
  RoomCommandEnvelope,
} from "../lib/room-command-contract";
import { InMemoryRoomRepository } from "../lib/room-repository";
import { RoomCommandService } from "../lib/room-command-service";
import { RoomEventBus } from "../lib/room-event-bus";
import { joinParticipant } from "../lib/participant-lifecycle";
import { COMMAND_REJECTION_MESSAGES } from "../lib/room-command-service";

// Only the network transport is replaced: store handlers, join correlation,
// command construction, queue ownership, and recovery sequencing stay real.
const transport = vi.hoisted(() => {
  const handlers = new Map<string, Set<(data?: any) => void>>();
  const sent: Array<{ event: string; data: any }> = [];
  return {
    connected: true,
    sent,
    on(event: string, handler: (data?: any) => void) {
      const listeners = handlers.get(event) ?? new Set();
      listeners.add(handler);
      handlers.set(event, listeners);
    },
    off(event: string, handler: (data?: any) => void) {
      handlers.get(event)?.delete(handler);
    },
    emit(event: string, data: any) {
      sent.push({ event, data: structuredClone(data) });
    },
    connect() {
      this.connected = true;
    },
    disconnect() {
      this.connected = false;
    },
    receive(event: string, data?: any) {
      if (event === "disconnect") this.connected = false;
      if (event === "connect") this.connected = true;
      for (const handler of handlers.get(event) ?? []) handler(data);
    },
  };
});
vi.mock("socket.io-client", () => ({ io: () => transport }));

function commands(type?: string): RoomCommandEnvelope[] {
  return transport.sent
    .filter(
      ({ event, data }) =>
        event === "command" && (!type || data.command.type === type),
    )
    .map(({ data }) => data);
}

function acknowledge(ack: CommandAcknowledgement) {
  // Match emitAcknowledgement's ordering and compatibility event exactly.
  transport.receive("command_ack", ack);
  if (ack.status === "rejected")
    transport.receive("error", { message: ack.message });
}

function finishJoin(room = useStore.getState().room!) {
  const join = transport.sent
    .filter(({ event }) => event === "join_room")
    .at(-1)!.data;
  transport.receive("room_state", {
    room,
    serverTime: Date.now(),
    snapshotRequestId: join.snapshotRequestId,
  });
}

function queueSeek() {
  useStore.getState().sendCommand("seek", { position: 42 });
  const original = commands("seek").at(-1)!;
  // This is the exact envelope retained by the unauthorized-command handler.
  roomSocketService.commandQueue.push(roomSocketService.lastCommand);
  roomSocketService.lastCommand = null;
  transport.sent.length = 0;
  return original;
}

function authResponse(participantId = "p0") {
  return new Response(
    JSON.stringify({ participantId, token: "renewed-session" }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

beforeAll(() => useStore.getState().init());
beforeEach(() => {
  vi.useFakeTimers();
  roomSocketService.disconnect();
  roomSocketService.commandQueue = [];
  roomSocketService.lastCommand = null;
  localStorage.clear();
  const room = {
    ...roomWithParticipants(2),
    generation: "room-lifetime",
    mediaRun: 7,
  };
  useStore.setState({
    room,
    isConnected: true,
    participantId: "p0",
    sessionToken: "old-session",
    isResyncing: false,
    commandSequence: 10,
    canonicalDeliveryVersion: 0,
    fullRoomSequence: undefined,
    pendingPlayback: undefined,
    commandError: null,
    lastCommandAcknowledgement: null,
  });
  roomSocketService.connect(room.id, "p0", "p0", "old-session");
  finishJoin();
  transport.sent.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => authResponse()),
  );
});
afterEach(() => {
  roomSocketService.disconnect();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => roomSocketService.disconnect());

it("retires an emitted upgrade when another join for the same room begins", async () => {
  const original = queueSeek();
  await useStore.getState().resyncSession();
  const retiredUpgrade = commands("upgrade_session")[0];
  roomSocketService.joinRoom(original.roomId, "p0", "p0");
  acknowledge({ nonce: retiredUpgrade.nonce, status: "applied" });
  expect(commands("seek")).toEqual([]);
  expect(roomSocketService.commandQueue).toHaveLength(1);
  expect(commands("upgrade_session")).toHaveLength(1);
  finishJoin();
  const upgrade = commands("upgrade_session").at(-1)!;
  expect(upgrade.nonce).not.toBe(retiredUpgrade.nonce);
  acknowledge({ nonce: retiredUpgrade.nonce, status: "applied" });
  expect(commands("seek")).toEqual([]);
  acknowledge({ nonce: upgrade.nonce, status: "applied" });
  expect(commands("seek")).toEqual([original]);
});

it.each(["NOT_JOINED", "NOT_PARTICIPANT"] as const)(
  "recovers a real %s ACK/error pair with one rejoin, auth and upgrade before applying the intended seek once",
  async (code) => {
    const clientRoom = useStore.getState().room!;
    const serverRoom = {
      ...clientRoom,
      participants: code === "NOT_PARTICIPANT" ? {} : clientRoom.participants,
    };
    const repository = new InMemoryRoomRepository([serverRoom]);
    const service = new RoomCommandService({
      repository,
      eventBus: new RoomEventBus(() => {}),
    });
    const context = {
      currentRoomId: code === "NOT_JOINED" ? null : clientRoom.id,
      currentParticipantId: "p0",
    };
    let resolveAuth!: (response: Response) => void;
    let authRequests = 0;
    vi.stubGlobal("fetch", () => {
      authRequests++;
      return new Promise<Response>((resolve) => {
        resolveAuth = resolve;
      });
    });
    useStore.getState().sendCommand("seek", { position: 31 });
    const original = commands("seek")[0];
    const rejection = await service.execute(context, original);
    expect(rejection).toMatchObject({
      nonce: original.nonce,
      status: "rejected",
      code,
    });
    acknowledge(rejection);
    acknowledge(rejection);
    expect(
      transport.sent.filter(({ event }) => event === "request_room_state"),
    ).toEqual([]);
    expect(
      transport.sent.filter(({ event }) => event === "join_room"),
    ).toHaveLength(1);
    expect(authRequests).toBe(1);
    expect(roomSocketService.commandQueue).toHaveLength(1);
    expect(commands("seek")).toEqual([original]);
    resolveAuth(authResponse());
    await vi.advanceTimersByTimeAsync(0);
    expect(commands("upgrade_session")).toEqual([]);
    const beforeJoin = (await repository.get(clientRoom.id))!;
    const joined = joinParticipant(
      beforeJoin,
      clientRoom.participants.p0,
      Date.now(),
      "recovered-socket",
    );
    expect(
      await repository.compareAndSet(clientRoom.id, beforeJoin.version, joined),
    ).toBe(true);
    context.currentRoomId = clientRoom.id;
    finishJoin(joined);
    const upgrade = commands("upgrade_session")[0];
    expect(upgrade).toBeDefined();
    transport.receive("session_upgraded", { participantId: "p0" });
    acknowledge({ nonce: upgrade.nonce, status: "applied" });
    expect(commands("seek")).toEqual([original, original]);
    const applied = await service.execute(context, commands("seek")[1]);
    expect(applied).toMatchObject({ nonce: original.nonce, status: "applied" });
    acknowledge(applied);
    const result = (await repository.get(clientRoom.id))!;
    expect(result.playback.basePosition).toBe(31);
    expect(result.sequence).toBe(joined.sequence + 1);
    expect(result.processedCommandNonces).toEqual([original.nonce]);
    expect(authRequests).toBe(1);
    expect(commands("upgrade_session")).toHaveLength(1);
    expect(
      transport.sent.filter(({ event }) => event === "join_room"),
    ).toHaveLength(1);
    expect(roomSocketService.commandQueue).toEqual([]);
  },
);

it("keeps membership rejoin correlation when duplicate rejection pairs precede a replaced room generation", async () => {
  const originalRoom = {
    ...useStore.getState().room!,
    sequence: 100,
    version: 100,
  };
  useStore.setState({ room: originalRoom, commandSequence: 100 });
  const repository = new InMemoryRoomRepository([originalRoom]);
  const service = new RoomCommandService({
    repository,
    eventBus: new RoomEventBus(() => {}),
  });
  useStore.getState().sendCommand("seek", { position: 31 });
  const original = commands("seek")[0];
  const rejection = await service.execute(
    { currentRoomId: null, currentParticipantId: "p0" },
    original,
  );
  acknowledge(rejection);
  acknowledge(rejection);
  await vi.advanceTimersByTimeAsync(0);
  const replacement = {
    ...originalRoom,
    generation: "replacement-lifetime",
    sequence: 12,
    version: 12,
  };
  expect(
    await repository.compareAndSet(
      originalRoom.id,
      originalRoom.version,
      replacement,
    ),
  ).toBe(true);
  finishJoin(replacement);
  expect(useStore.getState().room?.generation).toBe("replacement-lifetime");
  expect(useStore.getState().room?.sequence).toBe(12);
  expect(useStore.getState().commandSequence).toBe(12);
  const upgrade = commands("upgrade_session")[0];
  acknowledge({ nonce: upgrade.nonce, status: "applied" });
  expect(commands("seek")).toEqual([original, original]);
  const stale = await service.execute(
    { currentRoomId: replacement.id, currentParticipantId: "p0" },
    commands("seek")[1],
  );
  expect(stale).toMatchObject({
    nonce: original.nonce,
    status: "rejected",
    code: "STALE_MEDIA",
  });
  acknowledge(stale);
  expect(await repository.get(replacement.id)).toEqual(replacement);
  expect(commands("upgrade_session")).toHaveLength(1);
});

it.each(["NOT_PERMITTED", "RATE_LIMITED", "STALE_MEDIA"] as const)(
  "does not authorize or replay a %s command rejection",
  async (code) => {
    let authRequests = 0;
    vi.stubGlobal("fetch", async () => {
      authRequests++;
      return authResponse();
    });
    useStore.getState().sendCommand("seek", { position: 31 });
    const original = commands("seek")[0];
    acknowledge({
      nonce: original.nonce,
      status: "rejected",
      code,
      message: COMMAND_REJECTION_MESSAGES[code],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(authRequests).toBe(0);
    expect(commands()).toEqual([original]);
    expect(roomSocketService.commandQueue).toEqual([]);
    expect(transport.sent.filter(({ event }) => event === "join_room")).toEqual(
      [],
    );
  },
);

it("does not loop authorization or rejoin when the current upgrade is rejected for missing membership", async () => {
  queueSeek();
  let authRequests = 0;
  vi.stubGlobal("fetch", async () => {
    authRequests++;
    return authResponse();
  });
  await useStore.getState().resyncSession();
  const upgrade = commands("upgrade_session")[0];
  acknowledge({
    nonce: upgrade.nonce,
    status: "rejected",
    code: "NOT_JOINED",
    message: COMMAND_REJECTION_MESSAGES.NOT_JOINED,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(authRequests).toBe(1);
  expect(commands("upgrade_session")).toHaveLength(1);
  expect(commands("seek")).toEqual([]);
  expect(roomSocketService.commandQueue).toHaveLength(1);
  expect(transport.sent.filter(({ event }) => event === "join_room")).toEqual(
    [],
  );
});

it.each(["unrelated-nonce", "inactive-room"])(
  "ignores a membership rejection for %s",
  async (kind) => {
    useStore.getState().sendCommand("seek", { position: 31 });
    const original = commands("seek")[0];
    if (kind === "inactive-room") {
      roomSocketService.connect("other-room", "Other", "p0", "other-session");
      // A stale surface still targets the old room; it must not authorize this socket.
      useStore.getState().sendCommand("seek", { position: 32 });
    }
    let authRequests = 0;
    vi.stubGlobal("fetch", async () => {
      authRequests++;
      return authResponse();
    });
    const nonce =
      kind === "unrelated-nonce"
        ? "unrelated-command"
        : commands("seek").at(-1)!.nonce;
    const joinsBefore = transport.sent.filter(
      ({ event }) => event === "join_room",
    ).length;
    acknowledge({
      nonce,
      status: "rejected",
      code: "NOT_PARTICIPANT",
      message: COMMAND_REJECTION_MESSAGES.NOT_PARTICIPANT,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(authRequests).toBe(0);
    expect(
      transport.sent.filter(({ event }) => event === "join_room"),
    ).toHaveLength(joinsBefore);
    expect(roomSocketService.commandQueue).toEqual([]);
    expect(commands("seek")[0]).toEqual(original);
  },
);

it("ignores a late membership rejection after the command already received its terminal acknowledgement", async () => {
  useStore.getState().sendCommand("seek", { position: 31 });
  const original = commands("seek")[0];
  acknowledge({ nonce: original.nonce, status: "applied" });
  let authRequests = 0;
  vi.stubGlobal("fetch", async () => {
    authRequests++;
    return authResponse();
  });
  acknowledge({
    nonce: original.nonce,
    status: "rejected",
    code: "NOT_PARTICIPANT",
    message: COMMAND_REJECTION_MESSAGES.NOT_PARTICIPANT,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(authRequests).toBe(0);
  expect(transport.sent.filter(({ event }) => event === "join_room")).toEqual(
    [],
  );
  expect(roomSocketService.commandQueue).toEqual([]);
});

it("recovers an unauthorized command through real store error handlers and the renewed identity", async () => {
  useStore.getState().sendCommand("seek", { position: 23 });
  const original = commands("seek")[0];
  let resolveAuth!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        resolveAuth = resolve;
      }),
  );
  transport.receive("error", { message: "Guest commands blocked" });
  transport.receive("error", { message: "Guest commands blocked" });
  expect(roomSocketService.commandQueue).toHaveLength(1);
  expect(useStore.getState().isResyncing).toBe(true);
  expect(commands("seek")).toEqual([original]);
  resolveAuth(authResponse("renewed-participant"));
  await vi.advanceTimersByTimeAsync(0);
  const upgrade = commands("upgrade_session")[0];
  transport.receive("session_upgraded", {
    participantId: "renewed-participant",
  });
  transport.receive("command_ack", { nonce: upgrade.nonce, status: "applied" });
  expect(commands("seek")).toEqual([original, original]);
  expect(roomSocketService.commandQueue).toEqual([]);
  expect(useStore.getState().participantId).toBe("renewed-participant");
  expect(localStorage.getItem("participantId")).toBe("renewed-participant");
});

it("waits for the current upgrade acknowledgement even when authorization takes more than 600ms", async () => {
  queueSeek();
  await useStore.getState().resyncSession();
  const upgrade = commands("upgrade_session")[0];
  expect(upgrade).toBeDefined();
  await vi.advanceTimersByTimeAsync(5000);
  expect(commands("seek")).toEqual([]);
  transport.receive("session_upgraded", { participantId: "p0" });
  expect(commands("seek")).toEqual([]);
  transport.receive("command_ack", { nonce: upgrade.nonce, status: "applied" });
  expect(commands("seek")).toHaveLength(1);
  transport.receive("command_ack", { nonce: upgrade.nonce, status: "applied" });
  expect(commands("seek")).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("replays the original nonce, sequence and media epoch without moving its nonce into the payload", async () => {
  const original = queueSeek();
  const room = useStore.getState().room!;
  const repository = new InMemoryRoomRepository([room]);
  const service = new RoomCommandService({
    repository,
    eventBus: new RoomEventBus(() => {}),
  });
  const context = { currentRoomId: room.id, currentParticipantId: "p0" };
  expect(await service.execute(context, original)).toMatchObject({
    status: "applied",
  });
  const committed = await repository.get(room.id);
  expect(original.command.payload).not.toHaveProperty("nonce");
  await useStore.getState().resyncSession();
  const upgrade = commands("upgrade_session")[0];
  transport.receive("command_ack", { nonce: upgrade.nonce, status: "applied" });
  await vi.advanceTimersByTimeAsync(600);
  expect(commands("seek")).toEqual([original]);
  expect(original.command.payload).toEqual({
    position: 42,
    mediaRun: 7,
    roomGeneration: "room-lifetime",
  });
  expect(roomSocketService.commandQueue).toEqual([]);
  expect(await service.execute(context, commands("seek")[0])).toMatchObject({
    nonce: original.nonce,
    status: "ignored",
    code: "DUPLICATE",
  });
  expect(await repository.get(room.id)).toEqual(committed);
});

it.each([
  { generation: "room-lifetime", mediaRun: 8 },
  { generation: "replacement-lifetime", mediaRun: 7 },
])(
  "keeps a queued command fenced from a changed room/media epoch: %j",
  async (changedEpoch) => {
    const original = queueSeek();
    await useStore.getState().resyncSession();
    const upgradedRoom = { ...useStore.getState().room!, ...changedEpoch };
    transport.receive("room_state", {
      room: upgradedRoom,
      serverTime: Date.now(),
    });
    const upgrade = commands("upgrade_session")[0];
    transport.receive("command_ack", {
      nonce: upgrade.nonce,
      status: "applied",
    });
    expect(commands("seek")).toEqual([original]);
    const repository = new InMemoryRoomRepository([upgradedRoom]);
    const service = new RoomCommandService({
      repository,
      eventBus: new RoomEventBus(() => {}),
    });
    expect(
      await service.execute(
        { currentRoomId: upgradedRoom.id, currentParticipantId: "p0" },
        commands("seek")[0],
      ),
    ).toMatchObject({
      nonce: original.nonce,
      status: "rejected",
      code: "STALE_MEDIA",
    });
    expect(await repository.get(upgradedRoom.id)).toEqual(upgradedRoom);
  },
);

it("waits for the matching rejoin snapshot before upgrading a reconnected session", () => {
  const room = useStore.getState().room!;
  transport.receive("disconnect");
  transport.receive("connect");
  expect(
    transport.sent.filter(({ event }) => event === "join_room"),
  ).toHaveLength(1);
  expect(commands("upgrade_session")).toEqual([]);
  transport.receive("room_state", {
    room,
    serverTime: Date.now(),
    snapshotRequestId: "old-join",
  });
  expect(commands("upgrade_session")).toEqual([]);
  finishJoin();
  expect(commands("upgrade_session")).toHaveLength(1);
});

it("retains queued commands across a dropped upgrade and ignores its late acknowledgement", async () => {
  const original = queueSeek();
  await useStore.getState().resyncSession();
  const droppedUpgrade = commands("upgrade_session")[0];
  transport.receive("disconnect");
  await vi.advanceTimersByTimeAsync(1000);
  expect(roomSocketService.commandQueue).toHaveLength(1);
  transport.receive("connect");
  finishJoin();
  const currentUpgrade = commands("upgrade_session").at(-1)!;
  expect(currentUpgrade.nonce).not.toBe(droppedUpgrade.nonce);
  transport.receive("command_ack", {
    nonce: droppedUpgrade.nonce,
    status: "applied",
  });
  expect(commands("seek")).toEqual([]);
  transport.receive("command_ack", {
    nonce: currentUpgrade.nonce,
    status: "applied",
  });
  expect(commands("seek")).toEqual([original]);
});

it("retains failed-auth commands and releases recovery immediately so a later attempt can succeed", async () => {
  const original = queueSeek();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  await useStore.getState().resyncSession();
  expect(roomSocketService.commandQueue).toHaveLength(1);
  expect(useStore.getState().isResyncing).toBe(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => authResponse()),
  );
  await useStore.getState().resyncSession();
  const upgrade = commands("upgrade_session")[0];
  transport.receive("command_ack", { nonce: upgrade.nonce, status: "applied" });
  expect(commands("seek")).toEqual([original]);
});

it("does not replay after a rejected or unrelated upgrade acknowledgement", async () => {
  queueSeek();
  await useStore.getState().resyncSession();
  const upgrade = commands("upgrade_session")[0];
  transport.receive("command_ack", {
    nonce: "unrelated-command",
    status: "applied",
  });
  transport.receive("command_ack", {
    nonce: upgrade.nonce,
    status: "rejected",
    code: "INVALID_COMMAND",
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(commands("seek")).toEqual([]);
  expect(roomSocketService.commandQueue).toHaveLength(1);
});

it.each([503, 200])(
  "keeps the recovery queue when auth returns no usable token (HTTP %i)",
  async (status) => {
    queueSeek();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status })),
    );
    await useStore.getState().resyncSession();
    expect(commands()).toEqual([]);
    expect(roomSocketService.commandQueue).toHaveLength(1);
    expect(useStore.getState().isResyncing).toBe(false);
  },
);

it("coalesces authorization while a session request is still pending", async () => {
  queueSeek();
  let resolveAuth!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveAuth = resolve;
        }),
    ),
  );
  const pending = useStore.getState().resyncSession();
  await useStore.getState().resyncSession();
  expect(commands()).toEqual([]);
  resolveAuth(authResponse());
  await pending;
  expect(commands("upgrade_session")).toHaveLength(1);
  expect(useStore.getState().isResyncing).toBe(false);
});

it("coalesces repeated legacy authorization errors until the pending upgrade settles", async () => {
  queueSeek();
  let authRequests = 0;
  vi.stubGlobal("fetch", async () => {
    authRequests++;
    return authResponse();
  });
  await useStore.getState().resyncSession();
  const upgrade = commands("upgrade_session")[0];
  transport.receive("error", { message: "Guest commands blocked" });
  transport.receive("error", { message: "Guest commands blocked" });
  await useStore.getState().resyncSession();
  await vi.advanceTimersByTimeAsync(0);
  expect(authRequests).toBe(1);
  expect(commands("upgrade_session")).toEqual([upgrade]);
  transport.receive("command_ack", {
    nonce: upgrade.nonce,
    status: "rejected",
    code: "INVALID_COMMAND",
  });
  await useStore.getState().resyncSession();
  expect(authRequests).toBe(2);
  expect(commands("upgrade_session")).toHaveLength(2);
});

it("expires a stalled authorization request without losing its queue or accepting a late identity", async () => {
  const original = queueSeek();
  let resolveAuth!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        resolveAuth = resolve;
      }),
  );
  const stalled = useStore.getState().resyncSession();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(useStore.getState().isResyncing).toBe(false);
  expect(roomSocketService.commandQueue).toHaveLength(1);
  expect(commands()).toEqual([]);
  vi.stubGlobal("fetch", async () => authResponse());
  await useStore.getState().resyncSession();
  const upgrade = commands("upgrade_session")[0];
  resolveAuth(authResponse("expired-auth-participant"));
  await stalled;
  expect(useStore.getState().participantId).toBe("p0");
  transport.receive("command_ack", { nonce: upgrade.nonce, status: "applied" });
  expect(commands("seek")).toEqual([original]);
});

it("also bounds a stalled authorization response body", async () => {
  queueSeek();
  const response = authResponse();
  let resolveBody!: (body: unknown) => void;
  vi.spyOn(response, "json").mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveBody = resolve;
      }),
  );
  vi.stubGlobal("fetch", async () => response);
  const stalled = useStore.getState().resyncSession();
  await vi.advanceTimersByTimeAsync(15_000);
  await stalled;
  expect(useStore.getState().isResyncing).toBe(false);
  expect(roomSocketService.commandQueue).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  resolveBody({
    participantId: "late-body-participant",
    token: "late-body-session",
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(useStore.getState().participantId).toBe("p0");
  expect(commands()).toEqual([]);
});

it("expires a lost upgrade acknowledgement so manual retry can recover the retained envelope", async () => {
  const original = queueSeek();
  await useStore.getState().resyncSession();
  const expiredUpgrade = commands("upgrade_session")[0];
  await vi.advanceTimersByTimeAsync(15_000);
  expect(roomSocketService.isSessionUpgradePending(original.roomId)).toBe(
    false,
  );
  expect(roomSocketService.commandQueue).toHaveLength(1);
  expect(commands("seek")).toEqual([]);
  await useStore.getState().resyncSession();
  const upgrade = commands("upgrade_session").at(-1)!;
  expect(upgrade.nonce).not.toBe(expiredUpgrade.nonce);
  transport.receive("command_ack", {
    nonce: expiredUpgrade.nonce,
    status: "applied",
  });
  expect(commands("seek")).toEqual([]);
  transport.receive("command_ack", { nonce: upgrade.nonce, status: "applied" });
  expect(commands("seek")).toEqual([original]);
});

it.each(["switch-room", "disconnect", "new-upgrade"])(
  "ignores stale uncorrelated identity events after %s",
  async (action) => {
    await useStore.getState().resyncSession();
    if (action === "disconnect") {
      transport.receive("disconnect");
    } else {
      const room = { ...roomWithParticipants(2), id: "second-room" };
      useStore.setState({
        room,
        participantId: "new-room-participant",
        sessionToken: "new-room-session",
      });
      roomSocketService.connect(
        room.id,
        "New",
        "new-room-participant",
        "new-room-session",
      );
      finishJoin(room);
      if (action === "new-upgrade")
        roomSocketService.upgradeSession(room.id, 20, "new-room-session");
    }
    transport.receive("session_upgraded", {
      participantId: "retired-session-participant",
    });
    expect(useStore.getState().participantId).toBe(
      action === "disconnect" ? "p0" : "new-room-participant",
    );
    expect(localStorage.getItem("participantId")).toBe("p0");
  },
);

it.each(["switch-room", "disconnect"])(
  "ignores auth completion after %s",
  async (action) => {
    queueSeek();
    let resolveAuth!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveAuth = resolve;
          }),
      ),
    );
    const resync = useStore.getState().resyncSession();
    if (action === "switch-room") {
      const room = { ...roomWithParticipants(2), id: "second-room" };
      useStore.setState({
        room,
        participantId: "new-room-participant",
        sessionToken: "new-room-session",
      });
      roomSocketService.connect(
        room.id,
        "New",
        "new-room-participant",
        "new-room-session",
      );
      finishJoin(room);
    } else {
      transport.receive("disconnect");
    }
    transport.sent.length = 0;
    await vi.advanceTimersByTimeAsync(0);
    expect(useStore.getState().isResyncing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    resolveAuth(authResponse("stale-participant"));
    await resync;
    await vi.advanceTimersByTimeAsync(1000);
    expect(commands()).toEqual([]);
    expect(useStore.getState().participantId).toBe(
      action === "switch-room" ? "new-room-participant" : "p0",
    );
    expect(useStore.getState().sessionToken).toBe(
      action === "switch-room" ? "new-room-session" : "old-session",
    );
    expect(localStorage.getItem("participantId")).toBeNull();
  },
);
