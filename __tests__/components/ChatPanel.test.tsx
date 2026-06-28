import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ChatPanel from "@/components/ChatPanel";
import { useStore } from "@/lib/store";

vi.mock("@/lib/store", () => ({
  useStore: vi.fn(),
}));

describe("ChatPanel", () => {
  const sendCommand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      room: {
        chat: [
          {
            id: "msg-1",
            participantId: "owner",
            nickname: "Owner",
            message: "Welcome",
            sentAt: 1000,
          },
        ],
      },
      participantId: "viewer",
      sendCommand,
    });
  });

  it("renders room messages and sends a new chat message", () => {
    render(<ChatPanel />);

    expect(screen.getByText("Welcome")).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Message room/i);
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.submit(input.closest("form")!);

    expect(sendCommand).toHaveBeenCalledWith("send_chat", {
      message: "hello",
    });
    expect(input).toHaveValue("");
  });
});
