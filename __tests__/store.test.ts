import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock socket service before importing store
vi.mock("../lib/socket", () => {
  return {
    roomSocketService: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendCommand: vi.fn(),
      upgradeSession: vi.fn(),
      joinRoom: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    },
  };
});

import { useStore } from "../lib/store";
import { roomSocketService } from "../lib/socket";

describe("Zustand Store & OCC Flashback", () => {
  beforeEach(() => {
    // Reset store state
    useStore.setState({
      room: null,
      isConnected: false,
      participantId: "test-user-1",
      commandSequence: 1,
      occRollbackTick: 0,
      sessionToken: null,
      nickname: "TestUser",
    });
    vi.clearAllMocks();

    // Polyfill crypto.randomUUID for testing environment
    if (!global.crypto) {
      global.crypto = {
        randomUUID: () => "mock-uuid",
      } as any;
    }
  });

  it("TC-01: Should initialize and attach to roomSocketService", () => {
    const { init } = useStore.getState();

    // We mock localStorage
    const mockStorage: Record<string, string> = {
      participantId: "mock-storage-id",
    };
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => mockStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
    });

    init();

    expect(roomSocketService.on).toHaveBeenCalledWith(
      "connected",
      expect.any(Function),
    );
    expect(localStorage.getItem).toHaveBeenCalledWith("participantId");
    expect(useStore.getState().participantId).toBe("mock-storage-id");

    vi.unstubAllGlobals();
  });

  it("TC-02: Should trigger OCC rollback tick", () => {
    const stateBefore = useStore.getState();
    expect(stateBefore.occRollbackTick).toBe(0);

    stateBefore.triggerOccRollback();

    const stateAfter = useStore.getState();
    expect(stateAfter.occRollbackTick).toBe(1);
  });

  it("TC-03: Should inject nonce for fast-path mutations", () => {
    useStore.setState({
      isConnected: true,
      room: { id: "test", sequence: 1 } as any,
    });
    const { sendCommand } = useStore.getState();

    sendCommand("play", { position: 10 });

    expect(roomSocketService.sendCommand).toHaveBeenCalledWith(
      "test",
      2,
      "play",
      expect.objectContaining({ position: 10, nonce: expect.any(String) }),
      "test-user-1",
    );
  });

  it("TC-04: Should NOT inject nonce for slow-path mutations", () => {
    useStore.setState({
      isConnected: true,
      room: { id: "test", sequence: 1 } as any,
    });
    const { sendCommand } = useStore.getState();

    sendCommand("add_item", { url: "https://example.com/video" });

    const call = vi.mocked(roomSocketService.sendCommand).mock.calls[0];
    expect(call[0]).toBe("test");
    expect(call[1]).toBe(2);
    expect(call[2]).toBe("add_item");
    expect(call[3]).not.toHaveProperty("nonce");
  });

  it("TC-05: Should update nickname and notify server if connected", () => {
    const { init } = useStore.getState();
    init();

    // Not connected initially
    useStore.getState().setNickname("NewName");
    expect(useStore.getState().nickname).toBe("NewName");
    expect(localStorage.getItem("nickname")).toBe("NewName");
    expect(roomSocketService.sendCommand).not.toHaveBeenCalled();

    // Fake connected state and room
    useStore.setState({
      isConnected: true,
      room: { id: "test", sequence: 1 } as any,
    });

    useStore.getState().setNickname("ConnectedName");
    expect(useStore.getState().nickname).toBe("ConnectedName");
    expect(roomSocketService.sendCommand).toHaveBeenCalledWith(
      "test",
      2,
      "update_nickname",
      { nickname: "ConnectedName" },
      expect.any(String),
    );
  });

  it("TC-06: Should clear room state on disconnect", () => {
    const { init } = useStore.getState();
    init();

    useStore.setState({ isConnected: true, room: { id: "test" } as any });

    useStore.getState().disconnect();

    expect(roomSocketService.disconnect).toHaveBeenCalled();
    expect(useStore.getState().isConnected).toBe(false);
    expect(useStore.getState().room).toBeNull();
  });
});
