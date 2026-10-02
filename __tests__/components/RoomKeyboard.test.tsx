import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import RoomPage from "../../app/room/[id]/page";
import { useStore } from "../../lib/store";
import { roomWithParticipants } from "../helpers/room-fixtures";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "keyboard-room" }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
afterEach(cleanup);
function enter() {
  const room = roomWithParticipants(1);
  room.id = "keyboard-room";
  useStore.setState({
    room,
    participantId: "p0",
    isConnected: true,
    init: () => {},
    connect: async () => {},
    disconnect: () => {},
    setNickname: () => {},
  });
  render(<RoomPage />);
  fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), {
    target: { value: "Owner" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Join room" }));
}
it("exposes permitted rename as a focusable button and labelled editor", () => {
  enter();
  const rename = screen.getByRole("button", { name: "Rename room" });
  rename.focus();
  expect(rename).toHaveFocus();
  fireEvent.click(rename);
  expect(screen.getByRole("textbox", { name: "Room name" })).toHaveFocus();
});
it("failed clipboard writes expose a selectable manual link without claiming success", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  });
  enter();
  fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue(
      "http://localhost:3000/room/keyboard-room",
    ),
  );
  expect(
    screen.queryByRole("button", { name: "Invite link copied" }),
  ).not.toBeInTheDocument();
});
