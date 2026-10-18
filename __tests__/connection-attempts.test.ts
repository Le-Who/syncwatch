import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../lib/store";
import { roomSocketService } from "../lib/socket";
import { roomWithParticipants } from "./helpers/room-fixtures";

vi.mock("../lib/socket", () => ({
  roomSocketService: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    upgradeSession: vi.fn(),
    isSessionUpgradePending: () => false,
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function response(token: string, participantId = "p0") {
  return { ok: true, json: async () => ({ token, participantId }) } as Response;
}

describe("connection attempt lifetime", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    useStore.getState().disconnect();
    useStore.setState({ participantId: "p0", sessionToken: "original-token" });
    localStorage.clear();
  });

  it.each(["response", "body", "failure"])(
    "does not resurrect a room or overwrite identity after disconnect and late %s",
    async (stage) => {
      const pending = deferred<any>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          stage === "body"
            ? Promise.resolve({ ok: true, json: () => pending.promise })
            : pending.promise,
        ),
      );
      const connection = useStore.getState().connect("room-a", "Alice");
      await Promise.resolve();
      useStore.getState().disconnect();
      if (stage === "failure") pending.reject(new Error("late network error"));
      else
        pending.resolve(
          stage === "body"
            ? { token: "stale-token", participantId: "stale-id" }
            : response("stale-token", "stale-id"),
        );
      await connection;

      expect(roomSocketService.connect).not.toHaveBeenCalled();
      expect(useStore.getState().sessionToken).toBe("original-token");
      expect(useStore.getState().participantId).toBe("p0");
      expect(localStorage.getItem("participantId")).toBeNull();
    },
  );

  it.each([false, true])(
    "keeps the newest room when an older request settles last (failure=%s)",
    async (failOld) => {
      const old = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockReturnValueOnce(old.promise)
          .mockResolvedValueOnce(response("new-token", "new-id")),
      );
      const first = useStore.getState().connect("room-a", "Alice");
      await useStore.getState().connect("room-b", "Bob");
      if (failOld) old.reject(new Error("late failure"));
      else old.resolve(response("old-token", "old-id"));
      await first;

      expect(roomSocketService.connect).toHaveBeenCalledExactlyOnceWith(
        "room-b",
        "Bob",
        "new-id",
        "new-token",
      );
      expect(useStore.getState().participantId).toBe("new-id");
      expect(useStore.getState().sessionToken).toBe("new-token");
      expect(localStorage.getItem("participantId")).toBe("new-id");
    },
  );

  it("does not let an older session recovery replace a newer connection identity", async () => {
    useStore.setState({ room: roomWithParticipants(1), isConnected: true });
    const recovery = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(recovery.promise)
        .mockResolvedValueOnce(response("new-token", "new-id")),
    );
    const oldRecovery = useStore.getState().resyncSession();
    await useStore.getState().connect("room-b", "Bob");
    recovery.resolve(response("old-token", "old-id"));
    await oldRecovery;

    expect(useStore.getState().participantId).toBe("new-id");
    expect(useStore.getState().sessionToken).toBe("new-token");
    expect(roomSocketService.upgradeSession).not.toHaveBeenCalled();
  });

  it.each([401, 429, 500])(
    "reports HTTP %s as a failed attempt without bypassing authorization through a socket fallback",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));

      expect(await useStore.getState().connect("room-a", "Alice")).toBe(false);
      expect(roomSocketService.connect).not.toHaveBeenCalled();
      expect(useStore.getState().sessionToken).toBe("original-token");
    },
  );
});
