import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RoomPage from "../app/room/[id]/page";
import { useStore } from "../lib/store";
import { roomSocketService } from "../lib/socket";
import { roomWithParticipants } from "./helpers/room-fixtures";

const boundary = vi.hoisted(() => ({ props: null as any }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "room-test" }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));
vi.mock("react-player", () => ({ default: { canPlay: () => true } }));
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: () =>
      function Provider(props: any) {
        boundary.props = props;
        React.useImperativeHandle(props.ref, () => ({
          currentTime: 0,
          duration: 120,
        }));
        return null;
      },
  };
});
vi.mock("motion/react", () => {
  const Box = ({ children, className }: any) => (
    <div className={className}>{children}</div>
  );
  return {
    motion: { div: Box },
    Reorder: { Group: Box, Item: Box },
    AnimatePresence: Box,
  };
});
vi.mock("../lib/socket", () => {
  const listeners = new Map<string, (...args: any[]) => void>();
  return {
    roomSocketService: {
      on: (name: string, listener: (...args: any[]) => void) =>
        listeners.set(name, listener),
      off: vi.fn(),
      onRoomEvent: vi.fn(),
      offRoomEvent: vi.fn(),
      getSocket: () => ({ on: vi.fn(), off: vi.fn() }),
      disconnect: vi.fn(() => listeners.get("disconnected")?.()),
      connect: vi.fn(),
      upgradeSession: vi.fn(),
      joinRoom: vi.fn(),
      sendCommand: vi.fn(),
      sendParticipantHealth: vi.fn(),
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  localStorage.clear();
  localStorage.setItem("participantId", "p0");
  localStorage.setItem("nickname", "Alice");
  useStore.getState().disconnect();
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ participantId: "p0", token: "fresh-token" }),
    }),
  );
  const room = roomWithParticipants(1);
  room.currentMediaId = "media-a";
  room.playlist = [
    {
      id: "media-a",
      url: "https://example.com/a.mp4",
      provider: "direct",
      title: "A",
      duration: 120,
      addedBy: "p0",
    },
  ];
  useStore.setState({
    room,
    isConnected: true,
    connectionEpoch: 0,
    canonicalDeliveryVersion: 0,
    connectionDeliveryFloor: 0,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function join() {
  render(<RoomPage />);
  fireEvent.submit(
    screen.getByRole("button", { name: /join room/i }).closest("form")!,
  );
  fireEvent.click(screen.getByText(/Initialize Stream Sync/i));
  act(() => boundary.props.onLoadedMetadata());
}

it("keeps the room and initialized player mounted during a transport drop", async () => {
  join();
  await act(async () => {});
  act(() => useStore.setState({ isConnected: false, connectionEpoch: 1 }));
  expect(
    screen.getByRole("button", { name: "Room settings" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Connection Lost")).toBeInTheDocument();
  act(() => useStore.setState({ isConnected: true }));
  expect(screen.queryByText(/Initialize Stream Sync/i)).not.toBeInTheDocument();
});

it("returns to the join form after an HTTP auth error and allows a successful retry", async () => {
  useStore.getState().disconnect();
  vi.mocked(roomSocketService.connect).mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  render(<RoomPage />);

  await act(async () => {
    fireEvent.submit(
      screen.getByRole("button", { name: /join room/i }).closest("form")!,
    );
  });
  expect(roomSocketService.connect).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Your name" })).toHaveValue(
    "Alice",
  );

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ participantId: "p0", token: "retry-token" }),
    }),
  );
  await act(async () => {
    fireEvent.submit(
      screen.getByRole("button", { name: /join room/i }).closest("form")!,
    );
  });
  expect(roomSocketService.connect).toHaveBeenCalledExactlyOnceWith(
    "room-test",
    "Alice",
    "p0",
    "retry-token",
  );
  expect(
    screen.queryByRole("button", { name: /join room/i }),
  ).not.toBeInTheDocument();
  act(() =>
    useStore.setState({ room: roomWithParticipants(1), isConnected: true }),
  );
  expect(
    screen.getByRole("button", { name: "Room settings" }),
  ).toBeInTheDocument();
});

it("sleeps with the transport closed, retains the room, and wakes using current identity", async () => {
  join();
  await act(async () => {});
  vi.mocked(roomSocketService.connect).mockClear();
  act(() => vi.advanceTimersByTime(2 * 60 * 60 * 1000));

  expect(screen.getByText("Sleep Mode")).toBeInTheDocument();
  expect(useStore.getState().room?.id).toBe("room-test");
  expect(useStore.getState().isConnected).toBe(false);
  expect(roomSocketService.disconnect).toHaveBeenCalledOnce();
  expect(screen.queryByText("Connection Lost")).not.toBeInTheDocument();
  expect(boundary.props.playing).toBe(false);
  await act(async () => vi.advanceTimersByTime(6_000));
  expect(roomSocketService.connect).not.toHaveBeenCalled();

  act(() =>
    useStore.setState({
      participantId: "current-id",
      sessionToken: "current-token",
      nickname: "Current name",
    }),
  );
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await act(async () => fireEvent.click(screen.getByText("Sleep Mode")));
  expect(roomSocketService.connect).toHaveBeenCalledExactlyOnceWith(
    "room-test",
    "Current name",
    "current-id",
    "current-token",
  );
  expect(screen.queryByText("Sleep Mode")).not.toBeInTheDocument();
  expect(screen.queryByText(/Initialize Stream Sync/i)).not.toBeInTheDocument();
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual(
    { participantId: "current-id" },
  );
  warning.mockRestore();

  act(() => {
    const room = useStore.getState().room!;
    useStore.setState({
      isConnected: true,
      canonicalDeliveryVersion: 1,
      room: {
        ...room,
        sequence: room.sequence + 1,
        playback: {
          ...room.playback,
          status: "playing",
          baseTimestamp: Date.now(),
        },
      },
    });
  });
  act(() => vi.advanceTimersByTime(500));
  expect(boundary.props.playing).toBe(true);
});
