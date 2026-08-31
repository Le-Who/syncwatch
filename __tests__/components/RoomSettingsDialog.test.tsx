import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RoomSettingsDialog from "@/components/RoomSettingsDialog";
import { useStore } from "@/lib/store";

vi.mock("@/lib/store", () => ({
  useStore: vi.fn(),
}));

vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

describe("RoomSettingsDialog", () => {
  const sendCommand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      room: {
        settings: {
          controlMode: "open",
          autoplayNext: true,
          looping: false,
          shuffle: false,
          playlistMode: "editable",
          requestLeaderOnPause: false,
          unpauseWithoutLeader: false,
        },
        participants: {
          owner: { id: "owner", role: "owner", nickname: "Owner" },
        },
      },
      participantId: "owner",
      sendCommand,
    });
  });

  it("saves behavior settings without legacy control modes", () => {
    const onClose = vi.fn();
    render(<RoomSettingsDialog onClose={onClose} />);

    expect(screen.queryByText(/Open Room/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hybrid Room/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Controlled Room/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Append-only Queue/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Autoplay Next/i));
    fireEvent.click(screen.getByLabelText(/Loop Playlist/i));
    fireEvent.click(screen.getByLabelText(/Shuffle Playlist/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(sendCommand).toHaveBeenCalledWith("update_settings", {
      settings: {
        autoplayNext: false,
        looping: true,
        shuffle: true,
      },
    });
    expect(onClose).toHaveBeenCalled();
  });
});
