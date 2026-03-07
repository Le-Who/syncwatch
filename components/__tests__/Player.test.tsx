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

    (useStore as any).mockReturnValue({
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
    (useStore as any).mockReturnValue({
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
        settings: { controlMode: "open" },
        participants: {
          user1: { role: "guest" },
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
    (useStore as any).mockReturnValue({
      room: {
        currentMediaId: "1",
        playlist: [
          {
            id: "1",
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            provider: "youtube",
          },
        ],
        settings: { controlMode: "open" },
        playback: {
          status: "paused",
          basePosition: 0,
          baseTimestamp: 0,
          rate: 1,
        },
        participants: {
          user1: { role: "guest" },
        },
      },
      participantId: "user1",
      sendCommand: mockSendCommand,
      serverClockOffset: 0,
    });

    render(<Player />);

    // Since playing=false by default in local state, it should show pause overlay with a Play button
    // But we mocked ReactPlayer. Let's trigger play event
    fireEvent.click(screen.getByTestId("play-event"));

    // Should emit "play" command
    expect(mockSendCommand).toHaveBeenCalledWith("play", expect.any(Object));
  });
});
