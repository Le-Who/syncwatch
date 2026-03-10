import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Vitest environment will be Node for this to test the API route execution
import { GET } from "../app/api/metadata/route";
import { NextRequest } from "next/server";

// Mock the rate limiter so our tests don't randomly fail
vi.mock("../lib/redis-rate-limit", () => ({
  checkRedisRateLimit: vi.fn().mockReturnValue(true),
}));

// Mock DNS promises strictly
vi.mock("dns/promises", () => ({
  default: {
    resolve: vi.fn(async (hostname: string) => {
      if (hostname.includes("127.0.0.1") || hostname.includes("localhost")) {
        return ["127.0.0.1"];
      }
      return ["8.8.8.8"]; // Mock generic safe public IP for others
    }),
  },
}));

describe("/api/metadata SSRF Protection", () => {
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
    // We mock fetch so we don't accidentally make real requests to internet or parse real HTML
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode(
                "<title>Mocked Standard Title</title>",
              ),
            })
            .mockResolvedValueOnce({ done: true }),
          cancel: vi.fn().mockResolvedValue(undefined),
        }),
      },
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("TC-API-01: Blocks entirely invalid URLs", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/metadata?url=not-a-url",
    );
    const res = await GET(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("Invalid URL");
  });

  it("TC-API-02: Blocks local / bogon IPs (SSRF Attempt 1: 127.0.0.1)", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/metadata?url=http://127.0.0.1:8080/admin",
    );
    const res = await GET(req);
    // Because dns.resolve('127.0.0.1') returns ['127.0.0.1'] which is a bogon.
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toBe("Access to private network forbidden");
  });

  it("TC-API-03: Blocks local / bogon IPs (SSRF Attempt 2: localhost)", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/metadata?url=http://localhost:8080/metrics",
    );
    const res = await GET(req);
    // dns.resolve('localhost') -> e.g. ['127.0.0.1', '::1'] -> bogon
    expect(res.status).toBe(403);
  });

  it("TC-API-04: Successfully fetches and extracts title for safely resolved external URLs", async () => {
    // Since we can't reliably mock `dns/promises` elegantly without breaking NodeJS internals,
    // and we want integration level confidence, we will actually let it resolve a genuine external domain,
    // BUT we intercepted the global.fetch to not actually HTTP GET it.
    const req = new NextRequest(
      "http://localhost:3000/api/metadata?url=https://example.com/video.mp4",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    // Remember, our global.fetch mock returns <title>Mocked Standard Title</title>
    expect(data.title).toBe("Mocked Standard Title");
  });

  it("TC-API-05: YouTube OEmbed parsing shortcut works", async () => {
    // Override the mock exclusively for this test to send the YouTube OEmbed JSON format
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        title: "Mocked YouTube Video",
        thumbnail_url: "https://yt.img/mock.jpg",
      }),
    });

    const req = new NextRequest(
      "http://localhost:3000/api/metadata?url=https://www.youtube.com/watch?v=123",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.title).toBe("Mocked YouTube Video");
    expect(data.thumbnail).toBe("https://yt.img/mock.jpg");
  });
});
