import { describe, expect, it, vi } from "vitest";
import {
  buildMediaAddCommand,
  MediaComposeError,
} from "@/lib/media-compose";

describe("buildMediaAddCommand", () => {
  it("builds a single add_item command with metadata, start time, and insert mode", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        title: "Episode 7",
        thumbnail: "https://example.com/thumb.jpg",
        author: "Channel",
        aspectRatio: 1.777,
      }),
    })) as any;

    const command = await buildMediaAddCommand(
      "https://example.com/video.mp4?t=1m2s",
      {
        insertMode: "next",
        fetcher,
        canPlay: () => true,
      },
    );

    expect(command).toEqual({
      type: "add_item",
      payload: {
        url: "https://example.com/video.mp4?t=1m2s",
        provider: "direct",
        title: "Episode 7",
        duration: 0,
        startPosition: 62,
        thumbnail: "https://example.com/thumb.jpg",
        author: "Channel",
        aspectRatio: 1.777,
        insertMode: "next",
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/metadata?url=https%3A%2F%2Fexample.com%2Fvideo.mp4%3Ft%3D1m2s",
    );
  });

  it("expands comma-separated media input into an add_items command", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ title: "Fetched Title" }),
    })) as any;

    const command = await buildMediaAddCommand(
      "https://cdn.example.com/clip-1.mp4, https://cdn.example.com/clip-2.mp4",
      {
        insertMode: "end",
        fetcher,
        canPlay: () => true,
      },
    );

    expect(command.type).toBe("add_items");
    expect(command.payload.insertMode).toBe("end");
    expect(command.payload.items).toHaveLength(2);
    expect(command.payload.items[0]).toMatchObject({
      url: "https://cdn.example.com/clip-1.mp4",
      provider: "direct",
      title: "Fetched Title",
    });
  });

  it("fetches YouTube playlists as add_items and preserves insert mode", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe("/api/youtube/playlist?listId=PL123");
      return {
        ok: true,
        json: async () => ({
          videos: [
            {
              url: "https://www.youtube.com/watch?v=one",
              title: "One",
              duration: 10,
              thumbnail: "https://img.youtube.com/one.jpg",
            },
          ],
        }),
      };
    }) as any;

    const command = await buildMediaAddCommand(
      "https://www.youtube.com/watch?v=abc&list=PL123",
      {
        insertMode: "next",
        fetcher,
        canPlay: () => true,
      },
    );

    expect(command).toEqual({
      type: "add_items",
      payload: {
        insertMode: "next",
        items: [
          {
            url: "https://www.youtube.com/watch?v=one",
            provider: "youtube",
            title: "One",
            duration: 10,
            startPosition: 0,
            thumbnail: "https://img.youtube.com/one.jpg",
          },
        ],
      },
    });
  });

  it("throws a stable validation error for unsupported media", async () => {
    await expect(
      buildMediaAddCommand("https://example.com/file.zip", {
        canPlay: () => false,
      }),
    ).rejects.toEqual(
      new MediaComposeError("This URL is not supported by the player."),
    );
  });
});
