import { NextRequest, NextResponse } from "next/server";
import { checkRedisRateLimit } from "@/lib/redis-rate-limit";
import { Parser } from "htmlparser2";
import { getAppRouteClientIp } from "@/lib/ip";
import {
  getMetadataText,
  UnsafeMetadataDestination,
} from "@/lib/metadata-http";

export async function GET(request: NextRequest) {
  const ip = getAppRouteClientIp(request.headers) || "unknown";
  if (!(await checkRedisRateLimit(`api:metadata:${ip}`, 20, 60_000))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  let url: URL;
  try {
    url = new URL(request.nextUrl.searchParams.get("url") ?? "");
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("protocol");
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (url.username || url.password)
    return NextResponse.json(
      { error: "Access to private network forbidden" },
      { status: 403 },
    );
  const host = url.hostname.toLowerCase();
  const youtube =
    host === "youtu.be" ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com");
  const vimeo = host === "vimeo.com" || host.endsWith(".vimeo.com");
  try {
    if (youtube || vimeo) {
      const endpoint = youtube
        ? "https://www.youtube.com/oembed"
        : "https://vimeo.com/api/oembed.json";
      const oembed = new URL(endpoint);
      oembed.searchParams.set("url", url.href);
      oembed.searchParams.set("format", "json");
      const metadata = JSON.parse(await getMetadataText(oembed));
      if (typeof metadata.title === "string")
        return NextResponse.json({
          title: metadata.title,
          thumbnail: metadata.thumbnail_url,
        });
    } else {
      const content = await getMetadataText(url);
      let title = "";
      let insideTitle = false;
      const parser = new Parser({
        onopentagname(name) {
          insideTitle = name === "title";
        },
        ontext(text) {
          if (insideTitle) title += text;
        },
        onclosetag(name) {
          if (name === "title") insideTitle = false;
        },
      });
      parser.write(content);
      parser.end();
      if (title.trim())
        return NextResponse.json({
          title: title
            .trim()
            .replace(/\s*-\s*(YouTube|Twitch)$/, "")
            .trim(),
        });
    }
  } catch (error) {
    if (error instanceof UnsafeMetadataDestination)
      return NextResponse.json(
        { error: "Access to private network forbidden" },
        { status: 403 },
      );
    console.warn(
      "Metadata unavailable",
      error instanceof Error ? error.name : "unknown error",
    );
  }
  return NextResponse.json({
    title: youtube
      ? "YouTube video"
      : url.pathname.split("/").pop() || "Direct Media",
  });
}
