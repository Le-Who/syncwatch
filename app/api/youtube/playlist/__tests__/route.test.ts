import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";
import yts from "yt-search";

vi.mock("yt-search");

vi.mock("@/lib/redis-rate-limit", () => ({
  checkRedisRateLimit: vi.fn().mockReturnValue(true),
}));

describe("GET /api/youtube/playlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (url: string) => {
    return new Request(url);
  };

  it("should return 400 Bad Request if listId is missing", async () => {
    const req = createRequest("http://localhost:3000/api/youtube/playlist");
    const response = await GET(req);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("listId missing or invalid");
  });

  it("should return mapped playlist videos on successful search", async () => {
    const mockYtsResponse = {
      title: "My Awesome Playlist",
      videos: [
        {
          title: "Test Video 1",
          videoId: "test_id_1",
          duration: { seconds: 120 },
          thumbnail: "https://img.youtube.com/vi/test_id_1/hqdefault.jpg",
        },
        {
          title: "Test Video 2",
          videoId: "test_id_2", // Missing duration and thumbnail to test Zod catch defaults
        },
      ],
    };

    // @ts-ignore
    vi.mocked(yts).mockResolvedValue(mockYtsResponse as any);

    const req = createRequest(
      "http://localhost:3000/api/youtube/playlist?listId=PL12345",
    );
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.title).toBe("My Awesome Playlist");
    expect(data.videos).toHaveLength(2);

    // First video matches exactly
    expect(data.videos[0]).toEqual({
      title: "Test Video 1",
      url: "https://www.youtube.com/watch?v=test_id_1",
      duration: 120,
      thumbnail: "https://img.youtube.com/vi/test_id_1/hqdefault.jpg",
    });

    // Second video tests the Zod `catch` fallback mechanisms
    expect(data.videos[1]).toEqual({
      title: "Test Video 2",
      url: "https://www.youtube.com/watch?v=test_id_2",
      duration: 0,
      thumbnail: "",
    });
  });

  it("should handle completely missing playlist title gracefully", async () => {
    const mockYtsResponse = {
      videos: [], // No title field
    };
    // @ts-ignore
    vi.mocked(yts).mockResolvedValue(mockYtsResponse as any);

    const req = createRequest(
      "http://localhost:3000/api/youtube/playlist?listId=PL12345",
    );
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.title).toBe("Unknown Playlist");
  });

  it("should return 500 if yt-search throws an error", async () => {
    // @ts-ignore
    vi.mocked(yts).mockRejectedValue(new Error("yts crashed"));

    const req = createRequest(
      "http://localhost:3000/api/youtube/playlist?listId=PL12345",
    );
    const response = await GET(req);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Playlist fetch failed");
  });
});
