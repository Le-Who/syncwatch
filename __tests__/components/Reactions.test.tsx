import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import Reactions from "../../components/Reactions";
import { roomSocketService } from "../../lib/socket";

// 1. Mock Socket Service
vi.mock("../../lib/socket", () => {
  return {
    roomSocketService: {
      getSocket: vi.fn(),
    },
  };
});

// Mock web animations / crypto for jsdom
beforeEach(() => {
  if (!global.crypto) {
    global.crypto = {
      randomUUID: () => "mock-uuid-" + Math.random(),
    } as any;
  }
});

describe("Reactions Component (Unit Tests)", () => {
  let mockSocket: any;
  let eventHandlers: Record<string, Function> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers = {};

    mockSocket = {
      on: vi.fn((event, handler) => {
        eventHandlers[event] = handler;
      }),
      off: vi.fn((event, handler) => {
        if (eventHandlers[event] === handler) {
          delete eventHandlers[event];
        }
      }),
      emit: vi.fn(),
    };

    (roomSocketService.getSocket as any).mockReturnValue(mockSocket);
    // Fake timers to test the 4000ms removal logic
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TC-UI-06: Renders reaction toggle button and opens menu", async () => {
    render(<Reactions />);

    const toggleBtn = screen.getByRole("button");
    expect(toggleBtn).toBeInTheDocument();

    // Menu should be hidden initially
    expect(screen.queryByText("🔥")).not.toBeInTheDocument();

    // Click toggle
    fireEvent.click(toggleBtn);

    // Menu should appear with emojis
    expect(screen.getByText("🔥")).toBeInTheDocument();
    expect(screen.getByText("😂")).toBeInTheDocument();
  });
});
