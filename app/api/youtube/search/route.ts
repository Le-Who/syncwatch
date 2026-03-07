import { NextResponse } from "next/server";
import yts from "yt-search";
import { z } from "zod";

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

export async function GET(request: Request) {
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

  try {
    // 1. Enforce Timeout using AbortSignal
    // yt-search doesn't natively accept it, but we can race it
    const searchPromise = yts(q);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), 5000);
    });

    const r = await Promise.race([searchPromise, timeoutPromise]);

    // 2. Validate Response Shape using Zod
    const parsedData = ytSearchResponseSchema.parse(r);

    // 3. Optional Chaining and Map
    const videos = parsedData.videos.slice(0, 5).map((v) => ({
      title: v.title,
      url: v.url,
      duration: v.seconds ?? 0,
      thumbnail: v.thumbnail ?? "",
      author: v.author?.name ?? "Unknown",
    }));

    return NextResponse.json({ videos });
  } catch (err) {
    console.error("YouTube search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
