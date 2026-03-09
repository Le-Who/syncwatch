import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/socket", () => {
  return {
    roomSocketService: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      commandQueue: [],
    },
  };
});

import { roomSocketService } from "../lib/socket";
import { useStore } from "../lib/store";

describe("Socket Service OCC Rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TC-01: Should trigger occRollback on VERSION_CONFLICT error", () => {
    // 1. Arrange: grab error callback
    let errorCallback: any = null;

    useStore.getState().init();

    const mockOnCalls = vi.mocked(roomSocketService.on).mock.calls;
    for (const call of mockOnCalls) {
      if (call[0] === "error") {
        errorCallback = call[1];
        break;
      }
    }
    expect(errorCallback).toBeDefined();

    const initialTick = useStore.getState().occRollbackTick;

    // 2. Act
    errorCallback({ message: "VERSION_CONFLICT" });

    // 3. Assert
    expect(useStore.getState().occRollbackTick).toBe(initialTick + 1);
  });

  it("TC-02: Should not trigger rollback on generic errors", () => {
    let errorCallback: any = null;

    useStore.getState().init();

    const mockOnCalls = vi.mocked(roomSocketService.on).mock.calls;
    for (const call of mockOnCalls) {
      if (call[0] === "error") {
        errorCallback = call[1];
        break;
      }
    }
    expect(errorCallback).toBeDefined();

    const initialTick = useStore.getState().occRollbackTick;

    errorCallback({ message: "Rate limit exceeded" });

    expect(useStore.getState().occRollbackTick).toBe(initialTick);
  });
});
