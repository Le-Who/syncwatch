import { NextResponse } from "next/server";
import yts from "yt-search";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q) {
    return NextResponse.json({ error: "Query missing" }, { status: 400 });
  }

  try {
    const r = await yts(q);
    const videos = r.videos.slice(0, 5).map((v) => ({
      title: v.title,
      url: v.url,
      duration: v.seconds,
      thumbnail: v.thumbnail,
      author: v.author.name,
    }));
    return NextResponse.json({ videos });
  } catch (err) {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
