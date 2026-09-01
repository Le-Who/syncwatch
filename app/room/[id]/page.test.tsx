import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RoomPage from "./page";
import { useSettingsStore, useStore } from "@/lib/store";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "room-a" }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  Reorder: {
    Group: ({ children, className }: any) => (
      <div className={className}>{children}</div>
    ),
    Item: ({ children, className }: any) => (
      <div className={className}>{children}</div>
    ),
  },
}));

vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ src }: any) => <div data-testid="provider" data-src={src} />,
}));

vi.mock("react-player", () => ({
  default: { canPlay: () => true },
}));

vi.mock("@/components/Reactions", () => ({ default: () => null }));
vi.mock("@/components/ReconnectingOverlay", () => ({
  ReconnectingOverlay: () => null,
}));

vi.mock("@/lib/store", () => ({
  useStore: vi.fn(),
  useSettingsStore: vi.fn(),
}));

let state: any;

function renderRoom(hasMedia: boolean) {
  state = {
    room: {
      id: "room-a",
      name: "Room A",
      currentMediaId: hasMedia ? "media-a" : null,
      sequence: 1,
      leaderId: null,
      playlist: hasMedia
        ? [
            {
              id: "media-a",
              url: "https://example.com/a.mp4",
              provider: "raw",
              title: "A",
              duration: 120,
            },
          ]
        : [],
      settings: { autoplayNext: true, looping: false },
      playback: {
        status: "paused",
        basePosition: 0,
        baseTimestamp: 0,
        rate: 1,
      },
      participants: { user1: { id: "user1", role: "owner", nickname: "Sam" } },
    },
    isConnected: true,
    nickname: "Sam",
    participantId: "user1",
    init: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    setNickname: vi.fn(),
    sendCommand: vi.fn(),
    serverClockOffset: 0,
    occRollbackTick: 0,
    connectionEpoch: 0,
    connectionDeliveryFloor: 0,
    canonicalDeliveryVersion: 0,
    setLocalPlaybackHealth: vi.fn(),
  };
  (useStore as any).mockImplementation((selector: any) =>
    selector ? selector(state) : state,
  );
  (useStore as any).getState = () => state;

  render(<RoomPage />);
  fireEvent.submit(
    screen.getByRole("button", { name: /join room/i }).closest("form")!,
  );
}

describe("room media composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSettingsStore as any).mockReturnValue({
      theaterMode: false,
      volume: 0.5,
      muted: true,
      setVolume: vi.fn(),
      setMuted: vi.fn(),
      toggleTheaterMode: vi.fn(),
    });
  });

  it.each([false, true])(
    "mounts one logical media composer when media exists=%s",
    (hasMedia) => {
      renderRoom(hasMedia);

      expect(
        screen.getAllByRole("textbox", { name: /youtube url or search/i }),
      ).toHaveLength(1);
    },
  );
});
