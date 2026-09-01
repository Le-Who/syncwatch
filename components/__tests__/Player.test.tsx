import { render, screen, fireEvent, act } from "@testing-library/react";
import Player from "../Player";
import { SyncStatusBadge } from "../SyncStatusBadge";
import { vi, describe, beforeEach, afterEach, it, expect } from "vitest";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
import {
  PlaybackCoordinator,
  PlaybackHealthController,
} from "@/lib/playback-health";
import {
  PlayerTestHarness,
  type PlayerEventHandlers,
} from "./player-test-harness";
import { roomSocketService } from "@/lib/socket";

const providerCallbacks = vi.hoisted(
  () => new Map<string, Record<string, (...args: any[]) => void>>(),
);

// Mock Zustand store hooks
vi.mock("@/lib/store", () => {
  return {
    useStore: vi.fn(),
    useSettingsStore: vi.fn(),
  };
});

// Mock dynamic import of react-player and motion
vi.mock("next/dynamic", () => ({
  default: () => {
    return function MockPlayer(props: any) {
      providerCallbacks.set(props.src, {
        onWaiting: props.onWaiting,
        onPlaying: props.onPlaying,
        onPlay: props.onPlay,
        onPause: props.onPause,
        onSeeked: props.onSeeked,
        onEnded: props.onEnded,
        onLoadedMetadata: props.onLoadedMetadata,
      });
      return (
        <div
          data-testid="mock-react-player"
          data-controls={String(Boolean(props.controls))}
          data-muted={String(Boolean(props.muted))}
          data-volume={String(props.volume)}
          data-youtube-controls={String(props.config?.youtube?.controls)}
          data-youtube-disablekb={String(props.config?.youtube?.disablekb)}
        >
          {/* Mock events needed by tests */}
          <button
            data-testid="loadedmetadata-event"
            onClick={() =>
              props.onLoadedMetadata?.({ target: { duration: 123 } })
            }
          >
            loadedmetadata
          </button>
          <button data-testid="play-event" onClick={props.onPlay}>
            play
          </button>
          <button data-testid="pause-event" onClick={props.onPause}>
            pause
          </button>
          <button data-testid="waiting-event" onClick={props.onWaiting}>
            waiting
          </button>
          <button data-testid="playing-event" onClick={props.onPlaying}>
            playing
          </button>
        </div>
      );
    };
  },
}));

vi.mock("motion/react", () => ({
  motion: {
    div: (props: any) => <div {...props} />,
  },
}));

import { useStore, useSettingsStore } from "@/lib/store";

let currentStoreState: any;

function mockStoreState(state: any) {
  state.connectionEpoch ??= 0;
  state.connectionDeliveryFloor ??= 0;
  state.canonicalDeliveryVersion ??= 0;
  currentStoreState = state;
  (useStore as any).mockImplementation((selector: any) =>
    selector ? selector(currentStoreState) : currentStoreState,
  );
  (useStore as any).getState = vi.fn(() => currentStoreState);
}

describe("Player Component", () => {
  const mockSendCommand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    providerCallbacks.clear();
    vi.useRealTimers();

    // Default mock implementation
    (useSettingsStore as any).mockReturnValue({
      volume: 0.8,
      muted: false,
      theaterMode: false,
      setVolume: vi.fn(),
      setMuted: vi.fn(),
      toggleTheaterMode: vi.fn(),
    });

    mockStoreState({
      room: null,
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should render Awaiting Signal when no media is present", () => {
    render(<Player />);
    expect(screen.getByText(/Awaiting Signal/i)).toBeInTheDocument();
  });

  it("should render the player when media is present", () => {
    mockStoreState({
      room: {
        currentMediaId: "1",
        playlist: [
          {
            id: "1",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            provider: "youtube",
            title: "Test Video",
          },
        ],
        settings: { autoplayNext: true, looping: false },
        participants: {
          user1: { role: "viewer" },
        },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
    });

    render(<Player />);
    expect(screen.getByTestId("mock-react-player")).toBeInTheDocument();
  });

  it("should show native YouTube controls to viewers for volume, quality, and captions", () => {
    mockStoreState({
      room: {
        currentMediaId: "1",
        leaderId: null,
        playlist: [
          {
            id: "1",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            provider: "youtube",
            title: "Test Video",
          },
        ],
        settings: { autoplayNext: true, looping: false },
        playback: {
          status: "paused",
          basePosition: 0,
          baseTimestamp: 0,
          rate: 1,
        },
        participants: {
          user1: { id: "user1", role: "viewer" },
        },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
      occRollbackTick: 0,
      isConnected: true,
    });

    render(<Player />);

    const player = screen.getByTestId("mock-react-player");
    expect(player).toHaveAttribute("data-controls", "true");
    expect(player).toHaveAttribute("data-youtube-controls", "1");
    expect(player).toHaveAttribute("data-youtube-disablekb", "0");
  });

  it("should turn a native YouTube pause from a viewer into a room pause when no leader is active", () => {
    vi.useFakeTimers();
    mockStoreState({
      room: {
        currentMediaId: "00000000-0000-4000-8000-000000000001",
        leaderId: null,
        playlist: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            provider: "youtube",
            title: "Test Video",
          },
        ],
        settings: { autoplayNext: true, looping: false },
        playback: {
          status: "playing",
          basePosition: 0,
          baseTimestamp: Date.now(),
          rate: 1,
        },
        participants: {
          user1: { id: "user1", role: "viewer" },
        },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
      occRollbackTick: 0,
      isConnected: true,
    });

    render(<Player />);
    fireEvent.click(screen.getByText(/Initialize Stream Sync/i));
    fireEvent.click(screen.getByTestId("loadedmetadata-event"));

    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    fireEvent.click(screen.getByTestId("pause-event"));
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(mockSendCommand).toHaveBeenCalledWith(
      "pause",
      expect.objectContaining({ position: 0, fromNative: true }),
    );
  });

  it("should allow play/pause interactions if user has control", () => {
    mockStoreState({
      room: {
        currentMediaId: "1",
        playlist: [
          {
            id: "1",
            url: "https://example.com/video.mp4",
            provider: "raw",
          },
        ],
        settings: { autoplayNext: true, looping: false },
        playback: {
          status: "paused",
          basePosition: 0,
          baseTimestamp: 0,
          rate: 1,
        },
        participants: {
          user1: { role: "owner" },
        },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
    });

    render(<Player />);

    // To test the strict one-way data flow, we must interact with the Custom Controls,
    // not the underlying mock ReactPlayer events (unless nativeInteraction is true).

    // First, user must join the room manually to dismiss "Initialize Stream Sync"
    fireEvent.click(screen.getByText(/Initialize Stream Sync/i));

    // The play button is inside the custom controls. It toggles playing state.
    // It's a button containing the Play icon. We can find it by its role or wait for it.
    // Let's use getByRole button but there are multiple buttons.
    // We can just find the SVG with lucide-play
    const playButtonIcon = document.querySelector(".lucide-play");
    expect(playButtonIcon).toBeInTheDocument();

    // The parent button of the icon is what has the onClick handler
    if (playButtonIcon && playButtonIcon.parentElement) {
      fireEvent.click(playButtonIcon.parentElement);
    }

    // Should emit "play" command
    expect(mockSendCommand).toHaveBeenCalledWith("play", expect.any(Object));
  });

  it("should trigger a flashback seek when OCC rollback tick increments (TC-102)", () => {
    mockStoreState({
      room: {
        currentMediaId: "1",
        playlist: [
          { id: "1", url: "https://example.com/video.mp4", provider: "raw" },
        ],
        settings: { autoplayNext: true, looping: false },
        playback: {
          status: "playing",
          basePosition: 10,
          baseTimestamp: Date.now() - 5000,
          rate: 1,
        },
        participants: { user1: { role: "owner" } },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
      occRollbackTick: 1, // trigger rollback
    });

    render(<Player />);

    expect(screen.getByTestId("mock-react-player")).toBeInTheDocument();
  });

  it("should report media readiness when the provider is ready", () => {
    mockStoreState({
      room: {
        currentMediaId: "00000000-0000-4000-8000-000000000001",
        playlist: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            provider: "youtube",
            title: "Test Video",
          },
        ],
        settings: { autoplayNext: true, looping: false },
        playback: {
          status: "paused",
          basePosition: 0,
          baseTimestamp: 0,
          rate: 1,
        },
        participants: {
          user1: { role: "viewer" },
        },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
      occRollbackTick: 0,
    });

    render(<Player />);
    fireEvent.click(screen.getByTestId("loadedmetadata-event"));

    expect(mockSendCommand).toHaveBeenCalledWith("media_ready", {
      mediaId: "00000000-0000-4000-8000-000000000001",
      ready: true,
    });
  });

  it("keeps provider waiting local while friends continue on the canonical timeline", () => {
    mockStoreState({
      room: {
        currentMediaId: "00000000-0000-4000-8000-000000000001",
        sequence: 7,
        leaderId: null,
        playlist: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            provider: "youtube",
            title: "Test Video",
          },
        ],
        settings: { autoplayNext: true, looping: false },
        playback: {
          status: "playing",
          basePosition: 20,
          baseTimestamp: Date.now(),
          rate: 1,
          updatedBy: "user2",
        },
        participants: {
          user1: { id: "user1", role: "viewer", playbackHealth: "ready" },
          user2: { id: "user2", role: "owner", playbackHealth: "ready" },
          user3: { id: "user3", role: "viewer", playbackHealth: "ready" },
        },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
      occRollbackTick: 0,
      isConnected: true,
    });
    render(<Player />);
    fireEvent.click(screen.getByText(/Initialize Stream Sync/i));
    fireEvent.click(screen.getByTestId("loadedmetadata-event"));
    mockSendCommand.mockClear();

    fireEvent.click(screen.getByTestId("waiting-event"));

    expect(
      mockSendCommand.mock.calls.filter(([type]) =>
        ["buffering", "pause", "seek"].includes(type),
      ),
    ).toEqual([]);
    expect(
      screen.getByRole("status", { name: /your video is buffering/i }),
    ).toHaveTextContent(/friends are still watching/i);
    expect(screen.getByText("Local buffering")).toBeInTheDocument();
  });

  it.each([
    ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["twitch", "https://www.twitch.tv/videos/123456"],
    ["raw", "https://example.com/video.mp4"],
  ])(
    "suppresses %s waiting→pause/seek/ended provider chains without stopping healthy peers",
    (provider, url) => {
      vi.useFakeTimers();
      vi.setSystemTime(10_000);
      const mediaId = "00000000-0000-4000-8000-000000000001";
      const state = {
        room: {
          currentMediaId: mediaId,
          sequence: 41,
          leaderId: null,
          playlist: [{ id: mediaId, url, provider, title: "Shared video" }],
          settings: { autoplayNext: true, looping: false },
          playback: {
            status: "playing",
            basePosition: 20,
            baseTimestamp: 10_000,
            rate: 1,
            updatedBy: "user2",
          },
          participants: {
            user1: { id: "user1", role: "owner", playbackHealth: "ready" },
            user2: { id: "user2", role: "viewer", playbackHealth: "ready" },
            user3: { id: "user3", role: "viewer", playbackHealth: "ready" },
          },
        },
        participantId: "user1",
        sendCommand: mockSendCommand,
        setLocalPlaybackHealth: vi.fn(),
        serverClockOffset: 0,
        occRollbackTick: 0,
        isConnected: true,
      };
      mockStoreState(state);
      const view = render(<Player />);
      fireEvent.click(screen.getByText(/Initialize Stream Sync/i));
      const callbacks = providerCallbacks.get(url);
      act(() => callbacks?.onLoadedMetadata?.({ target: { duration: 120 } }));
      mockSendCommand.mockClear();

      act(() => {
        callbacks?.onWaiting?.();
        callbacks?.onPause?.();
        callbacks?.onSeeked?.();
        callbacks?.onEnded?.();
        vi.advanceTimersByTime(5_000);
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(state.room.sequence).toBe(41);
      expect(state.room.playback.status).toBe("playing");
      for (const _healthyParticipant of ["user2", "user3"] as const) {
        const coordinator = new PlaybackCoordinator();
        coordinator.beginMediaEpoch(mediaId);
        coordinator.acceptCanonical({
          mediaItemId: mediaId,
          status: "playing",
          basePosition: state.room.playback.basePosition,
          baseTimestamp: state.room.playback.baseTimestamp,
          rate: state.room.playback.rate,
          updatedBy: state.room.playback.updatedBy,
          sequence: state.room.sequence,
        });
        const decision = coordinator.reconcile({
          now: Date.now(),
          serverClockOffset: 0,
          currentPosition: 25,
          provider,
          duration: 120,
          isReady: true,
          health: "ready",
          recoveryMode: "none",
          previouslyAdjusting: false,
        });
        expect(decision.targetPosition).toBe(25);
        expect(decision.shouldPlay).toBe(true);
      }
      view.unmount();
    },
  );

  it("ignores a delayed provider callback from the previous media epoch", () => {
    const mediaA = "00000000-0000-4000-8000-000000000001";
    const mediaB = "00000000-0000-4000-8000-000000000002";
    const state = {
      room: {
        currentMediaId: mediaA,
        sequence: 12,
        leaderId: null,
        playlist: [
          {
            id: mediaA,
            url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
            provider: "youtube",
            title: "A",
          },
          {
            id: mediaB,
            url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
            provider: "youtube",
            title: "B",
          },
        ],
        settings: { autoplayNext: true, looping: false },
        playback: {
          status: "playing",
          basePosition: 0,
          baseTimestamp: Date.now(),
          rate: 1,
          updatedBy: "user1",
        },
        participants: { user1: { id: "user1", role: "owner" } },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
      occRollbackTick: 0,
      isConnected: true,
    };
    mockStoreState(state);
    const view = render(<Player />);
    const staleWaiting = providerCallbacks.get(
      "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    )?.onWaiting;

    state.room.currentMediaId = mediaB;
    state.room.sequence = 13;
    view.rerender(<Player />);
    mockSendCommand.mockClear();
    act(() => staleWaiting?.());

    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(screen.queryByText("Local buffering")).not.toBeInTheDocument();
  });

  it("does not let an old same-media playing callback clear newer buffering health", () => {
    const mediaId = "00000000-0000-4000-8000-000000000001";
    const state = {
      room: {
        currentMediaId: mediaId,
        sequence: 12,
        leaderId: null,
        playlist: [
          {
            id: mediaId,
            url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
            provider: "youtube",
            title: "A",
          },
        ],
        settings: { autoplayNext: true, looping: false },
        playback: {
          status: "playing",
          basePosition: 0,
          baseTimestamp: Date.now(),
          rate: 1,
          updatedBy: "user1",
        },
        participants: { user1: { id: "user1", role: "owner" } },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
      occRollbackTick: 0,
      isConnected: true,
    };
    mockStoreState(state);
    const view = render(<Player />);
    const callbacks = providerCallbacks.get(
      "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    );
    act(() => callbacks?.onWaiting());
    expect(screen.getByText("Local buffering")).toBeInTheDocument();

    state.room.sequence = 13;
    view.rerender(<Player />);
    act(() => callbacks?.onPlaying());

    expect(screen.getByText("Local buffering")).toBeInTheDocument();
  });

  it("ignores provider callbacks retained across a disconnect and reconnect", () => {
    const mediaId = "00000000-0000-4000-8000-000000000001";
    const state = {
      room: {
        currentMediaId: mediaId,
        sequence: 12,
        leaderId: null,
        playlist: [
          {
            id: mediaId,
            url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
            provider: "youtube",
            title: "A",
          },
        ],
        settings: { autoplayNext: true, looping: false },
        playback: {
          status: "playing",
          basePosition: 0,
          baseTimestamp: Date.now(),
          rate: 1,
          updatedBy: "user1",
        },
        participants: { user1: { id: "user1", role: "owner" } },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
      occRollbackTick: 0,
      isConnected: true,
      connectionEpoch: 0,
    };
    mockStoreState(state);
    const view = render(<Player />);
    const staleWaiting = providerCallbacks.get(
      "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    )?.onWaiting;

    state.connectionEpoch += 1;
    state.isConnected = false;
    view.rerender(<Player />);
    state.isConnected = true;
    view.rerender(<Player />);
    act(() => staleWaiting?.());

    expect(screen.queryByText("Local buffering")).not.toBeInTheDocument();
  });

  it("mounts into reconnect recovery when transport returned before a fresh room delivery", () => {
    const healthSend = vi
      .spyOn(roomSocketService, "sendParticipantHealth")
      .mockReturnValue(true);
    mockStoreState({
      room: {
        currentMediaId: "media-a",
        sequence: 12,
        leaderId: null,
        playlist: [
          {
            id: "media-a",
            url: "https://example.com/a.mp4",
            provider: "raw",
            title: "A",
            duration: 120,
          },
        ],
        settings: { autoplayNext: true, looping: false },
        playback: {
          status: "playing",
          basePosition: 20,
          baseTimestamp: Date.now(),
          rate: 1,
          updatedBy: "user1",
        },
        participants: { user1: { id: "user1", role: "owner" } },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
      occRollbackTick: 0,
      isConnected: true,
      connectionEpoch: 3,
      connectionDeliveryFloor: 7,
      canonicalDeliveryVersion: 7,
    });

    render(<Player />);

    expect(screen.getByRole("status")).toHaveAccessibleName(/reconnecting/i);
    expect(healthSend).toHaveBeenCalledOnce();
    expect(healthSend).toHaveBeenCalledWith("idle");
    healthSend.mockRestore();
  });

  it("removes the exact provider recovery timer on unmount", () => {
    vi.useFakeTimers();
    const mediaId = "00000000-0000-4000-8000-000000000001";
    mockStoreState({
      room: {
        currentMediaId: mediaId,
        sequence: 4,
        playlist: [{ id: mediaId, provider: "twitch" }],
        playback: { status: "playing" },
      },
    });
    const intentManager = new PlaybackIntentManager();
    const healthController = new PlaybackHealthController();
    let handlers: PlayerEventHandlers | null = null;
    const view = render(
      <PlayerTestHarness
        options={{
          intentManager,
          healthController,
          currentMediaId: mediaId,
          canonicalSequence: 4,
          canControl: true,
          playing: true,
          setIsReady: vi.fn(),
          setError: vi.fn(),
          setPlaying: vi.fn(),
          setDuration: vi.fn(),
          emitCommand: vi.fn(),
          handleNativePlay: vi.fn(),
          handleNativePause: vi.fn(),
        }}
        onHandlers={(next) => {
          handlers = next;
        }}
      />,
    );
    const timerCountBeforeSeek = vi.getTimerCount();

    act(() => {
      (handlers as PlayerEventHandlers | null)?.handleSeek(10, true);
    });
    expect(vi.getTimerCount()).toBe(timerCountBeforeSeek + 1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(timerCountBeforeSeek);
    intentManager.dispose();
    healthController.dispose();
  });
});

describe("SyncStatusBadge human states", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      isConnected: true,
      health: "ready" as const,
      drift: 0.05,
      label: "Synced",
    },
    {
      isConnected: true,
      health: "ready" as const,
      drift: 1.2,
      label: "Catching up",
    },
    {
      isConnected: true,
      health: "buffering" as const,
      drift: 0,
      label: "Local buffering",
    },
    {
      isConnected: false,
      health: "ready" as const,
      drift: 0,
      label: "Reconnecting",
    },
  ])("renders $label instead of raw drift-only status", (entry) => {
    mockStoreState({
      isConnected: entry.isConnected,
      room: { playback: { status: "playing" } },
    });
    render(
      <SyncStatusBadge
        driftRef={{ current: entry.drift }}
        playbackHealth={entry.health}
        reconnecting={!entry.isConnected}
      />,
    );

    act(() => vi.advanceTimersByTime(500));

    expect(screen.getByText(entry.label)).toBeInTheDocument();
  });

  it("keeps an accessible reconnecting label after transport reconnect", () => {
    mockStoreState({
      isConnected: true,
      room: { playback: { status: "playing" } },
    });
    render(
      <SyncStatusBadge
        driftRef={{ current: 0 }}
        playbackHealth="ready"
        reconnecting
      />,
    );

    expect(screen.getByRole("status")).toHaveAccessibleName(/reconnecting/i);
  });
});
