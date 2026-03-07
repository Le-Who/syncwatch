import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, 20, 60000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const url = request.nextUrl.searchParams.get("url");
  if (!url)
    return NextResponse.json({ title: "Unknown Media" }, { status: 400 });

  try {
    const provider = getProvider(url);
    if (provider === "youtube") {
      const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await fetch(oembed, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({
          title: data.title,
          thumbnail: data.thumbnail_url,
        });
      }
    } else if (provider === "vimeo") {
      const oembed = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
      const res = await fetch(oembed, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({
          title: data.title,
          thumbnail: data.thumbnail_url,
        });
      }
    }

    // Generic HTML title fallback for Twitch / Custom URLs
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const text = await res.text();
      const match = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (match && match[1]) {
        let title = match[1]
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        title = title.trim();
        // Clean up common suffixes
        title = title.replace(/\s*-\s*YouTube$/, "");
        title = title.replace(/\s*-\s*Twitch$/, "");
        return NextResponse.json({ title });
      }
    }
  } catch (e) {
    console.error("Metadata fetch error:", e);
  }

  // Final fallback (URL last segment)
  try {
    const p = new URL(url).pathname.split("/").pop();
    if (p) return NextResponse.json({ title: p });
  } catch {}

  return NextResponse.json({ title: "Direct Media" });
}

function getProvider(url: string) {
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("vimeo.com")) return "vimeo";
  if (url.includes("twitch.tv")) return "twitch";
  return "direct";
}
