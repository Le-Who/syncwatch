import { NextResponse } from "next/server";
import yts from "yt-search";
import { z } from "zod";
import { checkRedisRateLimit } from "@/lib/redis-rate-limit";

const ytPlaylistQuerySchema = z.string().min(1);

const ytPlaylistVideoSchema = z.object({
  title: z.string(),
  videoId: z.string(),
  duration: z
    .object({ seconds: z.number().int().nonnegative().catch(0) })
    .catch({ seconds: 0 }),
  thumbnail: z.string().url().catch(""), // Fallback if missing
});

const ytPlaylistResponseSchema = z.object({
  title: z.string().catch("Unknown Playlist"),
  videos: z.array(ytPlaylistVideoSchema).catch([]),
});

type PlaylistVideo = {
  title: string;
  videoId: string;
  duration: { seconds: number };
  thumbnail: string;
  author?: string;
};

type PlaylistResult = {
  title: string;
  videos: PlaylistVideo[];
};

function textContent(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.content === "string") return value.content;
  if (typeof value.simpleText === "string") return value.simpleText;
  if (Array.isArray(value.runs)) {
    return value.runs.map((run: any) => run?.text || "").join("");
  }
  return "";
}

function parseDurationSeconds(value: unknown): number {
  if (typeof value !== "string") return 0;
  const match = value.match(/\b\d{1,2}(?::\d{2}){1,2}\b/);
  if (!match) return 0;
  return match[0]
    .split(":")
    .map((part) => Number(part))
    .reduce((total, part) => total * 60 + part, 0);
}

function bestThumbnail(sources: any): string {
  const thumbnails = Array.isArray(sources) ? sources : [];
  const best = thumbnails
    .filter((source) => typeof source?.url === "string")
    .sort((a, b) => (Number(b?.width) || 0) - (Number(a?.width) || 0))[0];
  return best?.url || "";
}

function findFirstDurationText(node: any): string {
  if (!node || typeof node !== "object") return "";
  if (
    typeof node.text === "string" &&
    parseDurationSeconds(node.text) > 0
  ) {
    return node.text;
  }
  for (const value of Object.values(node)) {
    const found = findFirstDurationText(value);
    if (found) return found;
  }
  return "";
}

function extractJsonAfterMarker(source: string, marker: string): string | null {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = source.indexOf("{", markerIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function playlistTitleFromHtml(html: string, data: any): string {
  const fromInitialData = textContent(
    data?.metadata?.playlistMetadataRenderer?.title,
  );
  if (fromInitialData) return fromInitialData;

  const ogTitle = html.match(
    /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
  );
  if (ogTitle?.[1]) return ogTitle[1];

  return "Unknown Playlist";
}

function mapLockupVideo(lockup: any): PlaylistVideo | null {
  if (lockup?.contentType && lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") {
    return null;
  }

  const watchEndpoint =
    lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand
      ?.watchEndpoint;
  const videoId =
    (typeof lockup?.contentId === "string" && lockup.contentId) ||
    (typeof watchEndpoint?.videoId === "string" && watchEndpoint.videoId);
  if (!videoId) return null;

  const metadata = lockup?.metadata?.lockupMetadataViewModel;
  const title = textContent(metadata?.title) || "YouTube Video";
  const author = textContent(
    metadata?.metadata?.contentMetadataViewModel?.metadataRows?.[0]
      ?.metadataParts?.[0]?.text,
  );
  const thumbnail = bestThumbnail(
    lockup?.contentImage?.thumbnailViewModel?.image?.sources,
  );
  const duration = parseDurationSeconds(findFirstDurationText(lockup));

  return {
    title,
    videoId,
    duration: { seconds: duration },
    thumbnail,
    author: author || undefined,
  };
}

function mapPlaylistVideoRenderer(renderer: any): PlaylistVideo | null {
  const videoId = renderer?.videoId;
  if (typeof videoId !== "string" || !videoId) return null;
  return {
    title: textContent(renderer.title) || "YouTube Video",
    videoId,
    duration: {
      seconds: parseDurationSeconds(textContent(renderer.lengthText)),
    },
    thumbnail: bestThumbnail(renderer.thumbnail?.thumbnails),
    author: textContent(renderer.shortBylineText) || undefined,
  };
}

function collectPlaylistVideos(node: any, videos: Map<string, PlaylistVideo>) {
  if (!node || typeof node !== "object") return;

  const lockupVideo = mapLockupVideo(node.lockupViewModel);
  if (lockupVideo && !videos.has(lockupVideo.videoId)) {
    videos.set(lockupVideo.videoId, lockupVideo);
  }

  const legacyVideo = mapPlaylistVideoRenderer(node.playlistVideoRenderer);
  if (legacyVideo && !videos.has(legacyVideo.videoId)) {
    videos.set(legacyVideo.videoId, legacyVideo);
  }

  for (const value of Object.values(node)) {
    collectPlaylistVideos(value, videos);
  }
}

export function parseYouTubePlaylistHtml(html: string): PlaylistResult {
  const jsonSource = extractJsonAfterMarker(html, "ytInitialData");
  if (!jsonSource) {
    throw new Error("ytInitialData missing");
  }

  const data = JSON.parse(jsonSource);
  const videos = new Map<string, PlaylistVideo>();
  collectPlaylistVideos(data, videos);

  return {
    title: playlistTitleFromHtml(html, data),
    videos: Array.from(videos.values()),
  };
}

async function fetchPlaylistWithYtSearch(listId: string): Promise<PlaylistResult> {
  const searchPromise = yts({ listId });
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Timeout")), 5000);
  });

  const r = await Promise.race([searchPromise, timeoutPromise]);
  const parsedData = ytPlaylistResponseSchema.parse(r);
  return {
    title: parsedData.title,
    videos: parsedData.videos.map((v) => ({
      title: v.title,
      videoId: v.videoId,
      duration: { seconds: v.duration?.seconds ?? 0 },
      thumbnail: v.thumbnail ?? "",
    })),
  };
}

async function fetchPlaylistWithHtmlFallback(
  listId: string,
): Promise<PlaylistResult> {
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}&hl=en`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`YouTube playlist HTML failed: ${response.status}`);
  }

  return parseYouTubePlaylistHtml(await response.text());
}

function mapApiVideos(result: PlaylistResult) {
  return result.videos.map((v) => ({
    title: v.title,
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    duration: v.duration?.seconds ?? 0,
    thumbnail: v.thumbnail ?? "",
    author: v.author,
  }));
}

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const allowed = await checkRedisRateLimit(ip, 10, 60000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const { searchParams } = new URL(request.url);
  const rawListId = searchParams.get("listId");

  const qResult = ytPlaylistQuerySchema.safeParse(rawListId);
  if (!qResult.success) {
    return NextResponse.json(
      { error: "listId missing or invalid" },
      { status: 400 },
    );
  }

  const listId = qResult.data;

  try {
    let result: PlaylistResult;
    try {
      result = await fetchPlaylistWithYtSearch(listId);
    } catch (primaryError) {
      console.warn("yt-search playlist failed, using HTML fallback:", primaryError);
      result = await fetchPlaylistWithHtmlFallback(listId);
    }

    return NextResponse.json({
      videos: mapApiVideos(result),
      title: result.title,
    });
  } catch (err) {
    console.error("YouTube playlist error:", err);
    return NextResponse.json(
      { error: "Playlist fetch failed" },
      { status: 500 },
    );
  }
}
