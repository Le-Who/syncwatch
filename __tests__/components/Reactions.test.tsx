import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Reactions from "../../components/Reactions";

const socket = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
vi.mock("@/lib/socket", () => ({
  roomSocketService: { getSocket: () => socket },
}));

function receive(payload: unknown) {
  const handler = socket.on.mock.calls.find(
    ([event]) => event === "reaction",
  )![1] as (value: unknown) => void;
  act(() => handler(payload));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("reaction packet boundary", () => {
  it("TC-UI-06: Renders reaction toggle button and opens menu", () => {
    render(<Reactions />);
    const toggleButton = screen.getByRole("button");
    expect(toggleButton).toBeInTheDocument();
    expect(screen.queryByText("🔥")).not.toBeInTheDocument();
    fireEvent.click(toggleButton);
    expect(screen.getByText("🔥")).toBeInTheDocument();
    expect(screen.getByText("😂")).toBeInTheDocument();
  });

  it.each(
    [
      null,
      undefined,
      {},
      { emoji: null },
      { emoji: { invalid: true } },
      { emoji: ["🔥"] },
      { emoji: "x".repeat(50_001) },
      { emoji: "" },
    ].map((payload) => ({ payload })),
  )("ignores malformed incoming packet $payload", ({ payload }) => {
    const view = render(<Reactions />);
    expect(() => receive(payload)).not.toThrow();
    expect(view.container.querySelectorAll(".animate-float-up")).toHaveLength(
      0,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["🔥", "😂", "💖", "👀", "🤯", "💯"])(
    "shows supported incoming reaction %s and expires it",
    (emoji) => {
      const view = render(<Reactions />);
      receive({ emoji });
      expect(screen.getByText(emoji)).toBeInTheDocument();
      expect(view.container.querySelectorAll(".animate-float-up")).toHaveLength(
        1,
      );
      act(() => vi.advanceTimersByTime(4000));
      expect(view.container.querySelectorAll(".animate-float-up")).toHaveLength(
        0,
      );
    },
  );

  it("keeps all six reaction controls working with local playback", () => {
    render(<Reactions />);
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle reactions menu" }),
    );
    for (const emoji of ["🔥", "😂", "💖", "👀", "🤯", "💯"]) {
      expect(
        screen.getByRole("button", { name: `React with ${emoji}` }),
      ).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "React with 🔥" }));
    expect(socket.emit).toHaveBeenCalledExactlyOnceWith("reaction", {
      emoji: "🔥",
    });
    expect(screen.getByText("🔥")).toBeInTheDocument();
  });
});
