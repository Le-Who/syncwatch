import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AwaitingSignal } from "@/components/AwaitingSignal";

vi.mock("react-player", () => ({
  default: {
    canPlay: vi.fn((url) => url.includes(".mp4")),
  },
}));

global.fetch = vi.fn();

describe("AwaitingSignal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the shared media composer to add the first media item", async () => {
    const sendCommand = vi.fn();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      {
        ok: true,
        json: async () => ({
          title: "First Clip",
          thumbnail: "https://example.com/first.jpg",
        }),
      },
    );

    render(
      <AwaitingSignal
        canAddPlaylist={true}
        participantCount={1}
        sendCommand={sendCommand}
      />,
    );

    const input = screen.getByPlaceholderText(
      /Search YouTube or paste any media URL/i,
    );
    fireEvent.change(input, {
      target: { value: "https://example.com/first.mp4" },
    });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "add_item",
        expect.objectContaining({
          url: "https://example.com/first.mp4",
          title: "First Clip",
          insertMode: "end",
        }),
      );
    });
  });
});
