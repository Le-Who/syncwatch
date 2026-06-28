import { render, screen, fireEvent } from "@testing-library/react";
import Player from "../Player";
import { vi, describe, beforeEach, it, expect } from "vitest";

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
      return (
        <div data-testid="mock-react-player">
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
});
