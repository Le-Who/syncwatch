import { renderHook, act } from "@testing-library/react";
import { useStore, useSettingsStore } from "../store";
import { roomSocketService } from "../socket";
import { vi, describe, beforeEach, it, expect } from "vitest";

vi.mock("../socket", () => {
  return {
    roomSocketService: {
      init: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendCommand: vi.fn(),
    },
  };
});

describe("useSettingsStore", () => {
  beforeEach(() => {
    // Reset local storage
    localStorage.clear();
  });

  it("should initialize with default settings", () => {
    const { result } = renderHook(() => useSettingsStore());
    expect(result.current.volume).toBe(0.8);
    expect(result.current.muted).toBe(false);
    expect(result.current.theaterMode).toBe(false);
  });

  it("should update volume", () => {
    const { result } = renderHook(() => useSettingsStore());
    act(() => {
      result.current.setVolume(0.5);
    });
    expect(result.current.volume).toBe(0.5);
  });

  it("should toggle theater mode", () => {
    const { result } = renderHook(() => useSettingsStore());
    act(() => {
      result.current.toggleTheaterMode();
    });
    expect(result.current.theaterMode).toBe(true);
  });
});

describe("useStore", () => {
  beforeEach(() => {
    localStorage.clear();
    const { result } = renderHook(() => useStore());
    act(() => {
      // Clear state manually for clean runs
      useStore.setState({
        room: null,
        serverClockOffset: 0,
        isConnected: false,
        participantId: null,
        sessionToken: null,
        nickname: "",
        commandSequence: 1,
      });
    });
    vi.clearAllMocks();
  });

  it("should initialize with correct default state", () => {
    const { result } = renderHook(() => useStore());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.room).toBeNull();
  });

  it("should call init and load from localStorage", () => {
    localStorage.setItem("nickname", "TestUser");
    localStorage.setItem("participantId", "1234");

    const { result } = renderHook(() => useStore());
    act(() => {
      result.current.init();
    });

    expect(result.current.nickname).toBe("TestUser");
    expect(result.current.participantId).toBe("1234");
  });

  it("should update nickname and omit emitting if not connected", () => {
    const { result } = renderHook(() => useStore());

    act(() => {
      result.current.setNickname("NewName");
    });

    expect(result.current.nickname).toBe("NewName");
    expect(localStorage.getItem("nickname")).toBe("NewName");
    expect(roomSocketService.sendCommand).not.toHaveBeenCalled();
  });

  it("should emit update_nickname if connected and in a room", () => {
    const { result } = renderHook(() => useStore());

    act(() => {
      useStore.setState({ isConnected: true, room: { id: "room1" } as any });
      result.current.setNickname("EmitName");
    });

    expect(roomSocketService.sendCommand).toHaveBeenCalledWith(
      "update_nickname",
      { nickname: "EmitName" },
    );
  });

  it("should handle disconnect", () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      useStore.setState({ isConnected: true, room: { id: "1" } as any });
      result.current.disconnect();
    });

    expect(roomSocketService.disconnect).toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.room).toBeNull();
  });

  it("should append a unique nonce to fast-path commands to prevent echo rollbacks (TC-101)", () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      useStore.setState({ isConnected: true, room: { id: "room1" } as any });
      result.current.sendCommand("play", { position: 10 });
    });

    expect(roomSocketService.sendCommand).toHaveBeenCalledWith(
      "play",
      expect.objectContaining({ position: 10, nonce: expect.any(String) }),
    );
  });
});
