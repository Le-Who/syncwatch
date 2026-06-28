import { describe, expect, it } from "vitest";
import {
  expandMediaInput,
  extractStartPositionFromUrl,
  extractYouTubePlaylistId,
} from "../lib/media-input";

describe("media input parsing", () => {
  it("expands comma-separated media URLs while preserving protocols", () => {
    expect(
      expandMediaInput(
        "https://cdn.example/a.mp4, https://cdn.example/b.webm,https://youtu.be/abc",
      ),
    ).toEqual([
      "https://cdn.example/a.mp4",
      "https://cdn.example/b.webm",
      "https://youtu.be/abc",
    ]);
  });

  it("expands SyncTube-style numeric masks in ascending and descending order", () => {
    expect(expandMediaInput("https://cdn.example/episode-${1-3}.mp4")).toEqual([
      "https://cdn.example/episode-1.mp4",
      "https://cdn.example/episode-2.mp4",
      "https://cdn.example/episode-3.mp4",
    ]);

    expect(expandMediaInput("https://cdn.example/episode-${3-1}.mp4")).toEqual([
      "https://cdn.example/episode-3.mp4",
      "https://cdn.example/episode-2.mp4",
      "https://cdn.example/episode-1.mp4",
    ]);
  });

  it("caps numeric mask expansion at 100 generated URLs", () => {
    const expanded = expandMediaInput("https://cdn.example/${1-250}.mp4");

    expect(expanded).toHaveLength(100);
    expect(expanded[0]).toBe("https://cdn.example/1.mp4");
    expect(expanded[99]).toBe("https://cdn.example/100.mp4");
  });

  it("extracts YouTube playlist identifiers", () => {
    expect(
      extractYouTubePlaylistId(
        "https://www.youtube.com/watch?v=abc&list=PL1234567890",
      ),
    ).toBe("PL1234567890");
    expect(extractYouTubePlaylistId("https://youtu.be/abc")).toBeNull();
  });

  it("extracts numeric and h/m/s start positions from URLs", () => {
    expect(
      extractStartPositionFromUrl("https://youtu.be/abc?t=91"),
    ).toBe(91);
    expect(
      extractStartPositionFromUrl("https://youtu.be/abc?t=1h2m3s"),
    ).toBe(3723);
    expect(
      extractStartPositionFromUrl("https://youtube.com/watch?v=abc&start=45"),
    ).toBe(45);
  });
});
