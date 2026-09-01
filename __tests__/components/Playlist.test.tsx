import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Playlist from "../../components/Playlist";
import { useStore } from "../../lib/store";
import ReactPlayer from "react-player";

// 1. Mock Zustand Store
vi.mock("../../lib/store", () => ({
  useStore: vi.fn(),
}));

// 2. Mock ReactPlayer's canPlay static method
vi.mock("react-player", () => ({
  default: {
    canPlay: vi.fn((url) => {
      // Basic mock logic: accept youtube and mp4
      return url.includes("youtube.com") || url.includes(".mp4");
    }),
  },
}));

// 3. Mock Framer Motion to prevent animation warnings/delays in JSDOM
vi.mock("motion/react", () => {
  return {
    motion: {
      div: ({ children, className, ...props }: any) => (
        <div className={className} {...props}>
          {children}
        </div>
      ),
    },
    Reorder: {
      Group: ({ children, className }: any) => (
        <ul className={className}>{children}</ul>
      ),
      Item: ({ children, className }: any) => (
        <li className={className}>{children}</li>
      ),
    },
  };
});

// 4. Mock fetch for Youtube API and Metadata API searches
global.fetch = vi.fn();

describe("Playlist Component (Unit Tests)", () => {
  const mockSendCommand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default store state: User is owner, room has 1 video
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      room: {
        settings: { autoplayNext: true, looping: false },
        currentMediaId: "vid-1",
        participants: {
          "user-1": { role: "owner" },
        },
        playlist: [
          {
            id: "vid-1",
            title: "Test Video 1",
            provider: "YouTube",
            url: "https://youtube.com/watch?v=123",
            duration: 100,
            addedBy: "OwnerUser",
          },
        ],
        playback: {
          status: "playing",
          basePosition: 10,
          baseTimestamp: Date.now(),
          rate: 1,
        },
      },
      participantId: "user-1",
      sendCommand: mockSendCommand,
    });
  });

  it("TC-UI-01: Renders the playlist and allows Owner to see 'Remove' and 'Input' elements", () => {
    render(<Playlist />);

    // Owner should see the Add input
    expect(
      screen.getByPlaceholderText(/YouTube URL or search/i),
    ).toBeInTheDocument();

    // Owner should see the item in the list
    expect(screen.getByText("Test Video 1")).toBeInTheDocument();

    // Owner should see the trash/remove button (using title="Remove" from the component)
    const removeBtn = screen.getByTitle("Remove");
    expect(removeBtn).toBeInTheDocument();
  });

  it("TC-UI-02: Allows viewers to add media but hides queue management controls", () => {
    // Override store for Guest
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      room: {
        settings: { autoplayNext: true, looping: false },
        currentMediaId: "vid-1",
        participants: {
          "user-viewer": { role: "viewer" }, // Viewer role
        },
        playlist: [
          {
            id: "vid-1",
            title: "Test Video 1",
            provider: "YouTube",
          },
        ],
        playback: {
          status: "playing",
          basePosition: 10,
          baseTimestamp: Date.now(),
          rate: 1,
        },
      },
      participantId: "user-viewer",
      sendCommand: mockSendCommand,
    });

    render(<Playlist />);

    // Viewer can add media.
    expect(
      screen.getByPlaceholderText(/YouTube URL or search/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add next/i }),
    ).not.toBeInTheDocument();

    // Viewer cannot manage queue items.
    expect(screen.queryByTitle("Remove")).not.toBeInTheDocument();

    // But Guest CAN see the video title
    expect(screen.getByText("Test Video 1")).toBeInTheDocument();
  });

  it("TC-UI-03: Calls 'remove_item' command when trash icon is clicked", () => {
    render(<Playlist />);

    const removeBtn = screen.getByTitle("Remove");
    fireEvent.click(removeBtn);

    expect(mockSendCommand).toHaveBeenCalledWith("remove_item", {
      itemId: "vid-1",
    });
  });

  it("TC-UI-04: Submits a valid direct URL to 'add_item'", async () => {
    // Mock the /api/metadata fetch response that happens inline
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      {
        ok: true,
        json: async () => ({
          title: "Mocked Metadata Title",
          thumbnail: "http://thumb.jpg",
        }),
      },
    );

    render(<Playlist />);

    const input = screen.getByPlaceholderText(/YouTube URL or search/i);
    fireEvent.change(input, {
      target: { value: "https://example.com/video.mp4" },
    });

    const form = input.closest("form");
    expect(form).toBeInTheDocument();

    // Trigger submit
    fireEvent.submit(form!);

    // Wait for the async fetch to finish and sendCommand to be called
    await waitFor(() => {
      expect(mockSendCommand).toHaveBeenCalledWith(
        "add_item",
        expect.objectContaining({
          url: "https://example.com/video.mp4",
          provider: "direct",
          title: "Mocked Metadata Title",
          insertMode: "end",
        }),
      );
    });
  });

  it("TC-UI-06: Adds media directly after current item when Add next is selected", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      {
        ok: true,
        json: async () => ({
          title: "Next Metadata Title",
        }),
      },
    );

    render(<Playlist />);

    fireEvent.click(screen.getByRole("button", { name: /add next/i }));
    const input = screen.getByPlaceholderText(/YouTube URL or search/i);
    fireEvent.change(input, {
      target: { value: "https://example.com/next.mp4" },
    });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(mockSendCommand).toHaveBeenCalledWith(
        "add_item",
        expect.objectContaining({
          url: "https://example.com/next.mp4",
          insertMode: "next",
        }),
      );
    });
  });

  it("TC-UI-07: Sends queue management commands from playlist controls", () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      room: {
        settings: { autoplayNext: true, looping: false },
        currentMediaId: "vid-1",
        participants: {
          "user-1": { role: "owner" },
        },
        playlist: [
          {
            id: "vid-1",
            title: "Test Video 1",
            provider: "youtube",
            url: "https://youtube.com/watch?v=123",
            duration: 100,
            addedBy: "OwnerUser",
          },
          {
            id: "vid-2",
            title: "Test Video 2",
            provider: "youtube",
            url: "https://youtube.com/watch?v=456",
            duration: 90,
            addedBy: "OwnerUser",
          },
        ],
        playback: {
          status: "playing",
          basePosition: 10,
          baseTimestamp: Date.now(),
          rate: 1,
        },
      },
      participantId: "user-1",
      sendCommand: mockSendCommand,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<Playlist />);

    fireEvent.click(screen.getByTitle("Set as next: Test Video 2"));
    expect(mockSendCommand).toHaveBeenCalledWith("set_next_item", {
      itemId: "vid-2",
    });

    fireEvent.click(screen.getByTitle("Mark temporary: Test Video 2"));
    expect(mockSendCommand).toHaveBeenCalledWith("toggle_item_temporary", {
      itemId: "vid-2",
    });

    fireEvent.click(screen.getByTitle("Shuffle playlist"));
    expect(mockSendCommand).toHaveBeenCalledWith("shuffle_playlist", {});

    fireEvent.click(screen.getByTitle("Clear playlist"));
    expect(mockSendCommand).toHaveBeenCalledWith("clear_playlist", {});
  });

  it("TC-UI-05: Shows an error when unsupported URLs are added", async () => {
    // Override canPlay to reject for this test
    (ReactPlayer.canPlay as any).mockReturnValueOnce(false);

    render(<Playlist />);
    const input = screen.getByPlaceholderText(/YouTube URL or search/i);

    fireEvent.change(input, {
      target: { value: "https://unsupported.com/bad" },
    });

    const form = input.closest("form");
    fireEvent.submit(form!);

    // Should display the error div
    await waitFor(() => {
      expect(
        screen.getByText("This URL is not supported by the player."),
      ).toBeInTheDocument();
    });

    // Should NOT send command
    expect(mockSendCommand).not.toHaveBeenCalled();
  });
});
