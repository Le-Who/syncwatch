import { NextResponse } from "next/server";
import yts from "yt-search";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const listId = searchParams.get("listId");

  if (!listId) {
    return NextResponse.json({ error: "listId missing" }, { status: 400 });
  }

  try {
    const list = await yts({ listId });
    const videos = list.videos.map((v) => ({
      title: v.title,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      duration: v.duration.seconds || 0,
      thumbnail: v.thumbnail,
    }));
    return NextResponse.json({ videos, title: list.title });
  } catch (err) {
    console.error("Playlist err", err);
    return NextResponse.json(
      { error: "Playlist fetch failed" },
      { status: 500 },
    );
  }
}
