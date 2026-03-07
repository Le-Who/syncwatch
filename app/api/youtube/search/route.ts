import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { Worker } from "worker_threads";

const ytSearchQuerySchema = z.string().min(1);

const ytSearchVideoSchema = z.object({
  title: z.string(),
  url: z.string(),
  seconds: z.number().int().nonnegative().catch(0), // Fallback if missing
  thumbnail: z.string().url().catch(""), // Fallback if missing
  author: z.object({ name: z.string() }).catch({ name: "Unknown" }),
});

const ytSearchResponseSchema = z.object({
  videos: z.array(ytSearchVideoSchema).catch([]),
});

// LRU Cache (L1)
class LRUCache<K, V> {
  private cache: Map<K, { value: V; expiresAt: number }> = new Map();
  constructor(
    private maxSize: number,
    private ttlMs: number,
  ) {}

  get(key: K): V | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    // Refresh position
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key: K, value: V) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

const searchCache = new LRUCache<string, any>(200, 1000 * 60 * 60);

// Circuit Breaker
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  constructor(
    private threshold: number,
    private resetTimeoutMs: number,
  ) {}

  isOpen(): boolean {
    if (this.failures >= this.threshold) {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.failures = 0; // Half-open
        return false;
      }
      return true;
    }
    return false;
  }

  recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
  }

  recordSuccess() {
    this.failures = 0;
  }
}

const ytSearchBreaker = new CircuitBreaker(5, 60000); // 1 minute lockout after 5 consecutive failures

// Worker Thread isolation for yt-search to prevent unbounded lingering promises
const workerCode = `
  const { parentPort, workerData } = require('worker_threads');
  const yts = require('yt-search');
  
  yts(workerData.query).then((res) => {
    parentPort.postMessage({ success: true, data: res });
  }).catch((err) => {
    parentPort.postMessage({ success: false, error: err.message });
  });
`;

function searchYoutubeWithWorker(
  query: string,
  timeoutMs: number,
): Promise<any> {
  return new Promise((resolve, reject) => {
    // Generate a Data URI to avoid eval: true which is insecure and flagged by SAST tools
    const workerScript = `data:text/javascript;base64,${Buffer.from(workerCode).toString("base64")}`;

    const worker = new Worker(workerScript, {
      workerData: { query },
    });

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Timeout"));
    }, timeoutMs);

    worker.on("message", (msg) => {
      clearTimeout(timeout);
      worker.terminate();
      if (msg.success) resolve(msg.data);
      else reject(new Error(msg.error));
    });

    worker.on("error", (err) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(err);
    });

    worker.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0)
        reject(new Error("Worker stopped with exit code " + code));
    });
  });
}

async function searchWithGoogleApi(query: string, apiKey: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("maxResults", "5");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "video");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error("Google API Error: " + res.status);
  const data = await res.json();

  if (!data.items) return { videos: [] };

  const videos = data.items.map((item: any) => ({
    title: item.snippet.title,
    url: `https://youtube.com/watch?v=${item.id.videoId}`,
    seconds: 0,
    thumbnail: item.snippet.thumbnails?.default?.url || "",
    author: { name: item.snippet.channelTitle || "Unknown" },
  }));
  return { videos };
}

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, 20, 60000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const rawQ = searchParams.get("q");

  const qResult = ytSearchQuerySchema.safeParse(rawQ);
  if (!qResult.success) {
    return NextResponse.json(
      { error: "Query missing or invalid" },
      { status: 400 },
    );
  }

  const q = qResult.data;

  // 1. Check Cache (L1)
  const cached = searchCache.get(q);
  if (cached) {
    return NextResponse.json({ videos: cached });
  }

  try {
    let rawResult;
    const googleApiKey = process.env.YOUTUBE_API_KEY;

    // 2. Circuit Breaker + Primary API Selector
    if (googleApiKey && !ytSearchBreaker.isOpen()) {
      try {
        rawResult = await searchWithGoogleApi(q, googleApiKey);
        ytSearchBreaker.recordSuccess();
      } catch (e) {
        console.error("Google API failed, falling back to scraped worker:", e);
        ytSearchBreaker.recordFailure();
        rawResult = await searchYoutubeWithWorker(q, 5000);
      }
    } else {
      if (ytSearchBreaker.isOpen()) {
        return NextResponse.json(
          { error: "Search service temporarily unavailable" },
          { status: 503 },
        );
      }
      try {
        rawResult = await searchYoutubeWithWorker(q, 5000);
        ytSearchBreaker.recordSuccess();
      } catch (e) {
        ytSearchBreaker.recordFailure();
        throw e;
      }
    }

    // 3. Validate Response Shape using Zod
    const parsedData = ytSearchResponseSchema.parse(rawResult);

    // 4. Transform Output
    const videos = parsedData.videos.slice(0, 5).map((v) => ({
      title: v.title,
      url: v.url,
      duration: v.seconds ?? 0,
      thumbnail: v.thumbnail ?? "",
      author: v.author?.name ?? "Unknown",
    }));

    // 5. Update Cache
    searchCache.set(q, videos);

    return NextResponse.json({ videos });
  } catch (err) {
    console.error("YouTube search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
