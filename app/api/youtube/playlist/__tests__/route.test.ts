import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";
import yts from "yt-search";
import { checkRedisRateLimit } from "@/lib/redis-rate-limit";

vi.mock("yt-search");

vi.mock("@/lib/redis-rate-limit", () => ({
  checkRedisRateLimit: vi.fn().mockReturnValue(true),
}));

describe("GET /api/youtube/playlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(checkRedisRateLimit).mockResolvedValue(true);
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
    expect(checkRedisRateLimit).toHaveBeenCalledWith("unknown", 10, 60000);
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

  it("should fall back to parsing YouTube playlist HTML if yt-search throws an error", async () => {
    // @ts-ignore
    vi.mocked(yts).mockRejectedValue(new Error("yts crashed"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          `<html><head><title>Fallback</title></head><body><script>
          var ytInitialData = {
            "metadata": {
              "playlistMetadataRenderer": { "title": "Fallback Playlist" }
            },
            "contents": {
              "twoColumnBrowseResultsRenderer": {
                "tabs": [{
                  "tabRenderer": {
                    "content": {
                      "sectionListRenderer": {
                        "contents": [{
                          "itemSectionRenderer": {
                            "contents": [{
                              "lockupViewModel": {
                                "contentId": "fallback123",
                                "contentType": "LOCKUP_CONTENT_TYPE_VIDEO",
                                "contentImage": {
                                  "thumbnailViewModel": {
                                    "image": {
                                      "sources": [{
                                        "url": "https://img.youtube.com/vi/fallback123/hqdefault.jpg",
                                        "width": 480,
                                        "height": 360
                                      }]
                                    },
                                    "overlays": [{
                                      "thumbnailBottomOverlayViewModel": {
                                        "badges": [{
                                          "thumbnailBadgeViewModel": { "text": "1:23" }
                                        }]
                                      }
                                    }]
                                  }
                                },
                                "metadata": {
                                  "lockupMetadataViewModel": {
                                    "title": { "content": "Fallback Video" },
                                    "metadata": {
                                      "contentMetadataViewModel": {
                                        "metadataRows": [{
                                          "metadataParts": [{
                                            "text": { "content": "Fallback Channel" }
                                          }]
                                        }]
                                      }
                                    }
                                  }
                                },
                                "rendererContext": {
                                  "commandContext": {
                                    "onTap": {
                                      "innertubeCommand": {
                                        "watchEndpoint": {
                                          "videoId": "fallback123",
                                          "playlistId": "PL12345",
                                          "index": 0
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }]
                          }
                        }]
                      }
                    }
                  }
                }]
              }
            }
          };
          </script></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      ),
    );

    const req = createRequest(
      "http://localhost:3000/api/youtube/playlist?listId=PL12345",
    );
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.title).toBe("Fallback Playlist");
    expect(data.videos).toEqual([
      {
        title: "Fallback Video",
        url: "https://www.youtube.com/watch?v=fallback123",
        duration: 83,
        thumbnail: "https://img.youtube.com/vi/fallback123/hqdefault.jpg",
        author: "Fallback Channel",
      },
    ]);
  });
});
