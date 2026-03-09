import { describe, it, expect, vi, beforeEach } from "vitest";

// Partially mock socket.io-client to capture the event binding
const mockSocketOn = vi.fn();
const mockSocketEmit = vi.fn();
const mockSocketDisconnect = vi.fn();

vi.mock("socket.io-client", () => {
  return {
    io: vi.fn(() => ({
      on: mockSocketOn,
      emit: mockSocketEmit,
      connect: vi.fn(),
      disconnect: mockSocketDisconnect,
      connected: true,
    })),
  };
});

import { roomSocketService } from "../lib/socket";

describe("Socket Service OCC Rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (roomSocketService as any).socket = null;
    (roomSocketService as any).isResyncing = false;
    // We need to trigger the initial getSocket() call so event listeners are bound
    roomSocketService.getSocket();
  });

  it("TC-01: Should call triggerOccRollback on VERSION_CONFLICT error", () => {
    // 1. Arrange: Setup spy payload
    let errorCallback: any = null;

    // Find the 'error' event registration from mockSocketOn
    for (const call of mockSocketOn.mock.calls) {
      if (call[0] === "error") {
        errorCallback = call[1];
        break;
      }
    }
    expect(errorCallback).toBeDefined();

    const mockTriggerOccRollback = vi.fn();
    const mockGetState = vi.fn().mockReturnValue({
      triggerOccRollback: mockTriggerOccRollback,
    });

    // Inject mock state getters into the socket service
    roomSocketService.init(mockGetState, vi.fn());

    // 2. Act: Simulate Socket.IO receiving VERSION_CONFLICT error
    errorCallback({ message: "VERSION_CONFLICT" });

    // 3. Assert: Store should have been told to roll back
    expect(mockGetState).toHaveBeenCalled();
    expect(mockTriggerOccRollback).toHaveBeenCalled();
  });

  it("TC-02: Should not trigger rollback on generic errors", () => {
    // 1. Arrange
    let errorCallback: any = null;

    // We already called roomSocketService.getSocket() in beforeEach which binds events
    for (const call of mockSocketOn.mock.calls) {
      if (call[0] === "error") {
        errorCallback = call[1];
        break;
      }
    }
    expect(errorCallback).toBeDefined();

    const mockTriggerOccRollback = vi.fn();
    const mockGetState = vi.fn().mockReturnValue({
      triggerOccRollback: mockTriggerOccRollback,
      participantId: "user-1",
    });
    roomSocketService.init(mockGetState, vi.fn());

    // 2. Act: Simulate Generic error
    errorCallback({ message: "Rate limit exceeded" });

    // 3. Assert: Store should NOT have been told to roll back
    expect(mockTriggerOccRollback).not.toHaveBeenCalled();
  });
});
