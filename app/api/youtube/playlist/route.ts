import { NextResponse } from "next/server";
import yts from "yt-search";
import { z } from "zod";

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

export async function GET(request: Request) {
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
    // 1. Enforce Timeout using AbortSignal
    const searchPromise = yts({ listId });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 5000);
    });

    const r = await Promise.race([searchPromise, timeoutPromise]);

    // 2. Validate Response Shape using Zod
    const parsedData = ytPlaylistResponseSchema.parse(r);

    // 3. Optional Chaining and Map
    const videos = parsedData.videos.map((v) => ({
      title: v.title,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      duration: v.duration?.seconds ?? 0,
      thumbnail: v.thumbnail ?? "",
    }));

    return NextResponse.json({ videos, title: parsedData.title });
  } catch (err) {
    console.error("YouTube playlist error:", err);
    return NextResponse.json(
      { error: "Playlist fetch failed" },
      { status: 500 },
    );
  }
}
