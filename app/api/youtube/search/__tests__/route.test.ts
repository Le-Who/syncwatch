import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";
import yts from "yt-search";
import * as rateLimit from "@/lib/rate-limit";

vi.mock("yt-search");
vi.mock("@/lib/rate-limit");

describe("GET /api/youtube/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue(true);
  });

  const createRequest = (url: string, ip: string = "127.0.0.1") => {
    return new Request(url, {
      headers: new Headers({
        "x-forwarded-for": ip,
      }),
    });
  };

  it("should return 429 Too Many Requests if rate limit is exceeded", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue(false);

    const req = createRequest(
      "http://localhost:3000/api/youtube/search?q=test",
    );
    const response = await GET(req);

    expect(response.status).toBe(429);
    const data = await response.json();
    expect(data.error).toBe("Too many requests");
  });

  it("should return 400 Bad Request if query is missing", async () => {
    const req = createRequest("http://localhost:3000/api/youtube/search");
    const response = await GET(req);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Query missing or invalid");
  });

  it("should return mapped video results on successful search", async () => {
    const mockYtsResponse = {
      videos: [
        {
          title: "Test Video 1",
          url: "https://youtube.com/watch?v=123",
          seconds: 120,
          thumbnail: "https://img.youtube.com/vi/123/0.jpg",
          author: { name: "Test Author" },
        },
        {
          title: "Test Video 2",
          url: "https://youtube.com/watch?v=456",
          seconds: 60,
          thumbnail: "https://img.youtube.com/vi/456/0.jpg",
        }, // Missing author intentionally to test Zod fallback
      ],
    };

    // @ts-ignore - Mocking yts default export
    vi.mocked(yts).mockResolvedValue(mockYtsResponse as any);

    const req = createRequest(
      "http://localhost:3000/api/youtube/search?q=testquery",
    );
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.videos).toHaveLength(2);
    expect(data.videos[0]).toEqual({
      title: "Test Video 1",
      url: "https://youtube.com/watch?v=123",
      duration: 120,
      thumbnail: "https://img.youtube.com/vi/123/0.jpg",
      author: "Test Author",
    });

    // Verify Zod catch fallback on author mapping
    expect(data.videos[1].author).toBe("Unknown");
  });

  it("should return 500 if yt-search throws an error", async () => {
    // @ts-ignore
    vi.mocked(yts).mockRejectedValue(new Error("yts crashed"));

    const req = createRequest(
      "http://localhost:3000/api/youtube/search?q=testquery",
    );
    const response = await GET(req);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Search failed");
  });
});
