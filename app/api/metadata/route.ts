import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import dns from "dns/promises";
import { Parser } from "htmlparser2";

function isBogon(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  const ipv6 = ip.toLowerCase();
  if (
    ipv6 === "::1" ||
    ipv6.startsWith("fe80") ||
    ipv6.startsWith("fc") ||
    ipv6.startsWith("fd")
  ) {
    return true;
  }
  return false;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip, 20, 60000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const urlParam = request.nextUrl.searchParams.get("url");
  if (!urlParam)
    return NextResponse.json({ title: "Unknown Media" }, { status: 400 });

  let targetUrl: URL;
  try {
    targetUrl = new URL(urlParam);
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      return NextResponse.json(
        { error: "Invalid protocol HTTP/HTTPS required" },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // 1. DNS Resolution & Validation against SSRF
  try {
    const addresses = await dns.resolve(targetUrl.hostname);
    if (addresses.some(isBogon)) {
      return NextResponse.json(
        { error: "Access to private network forbidden" },
        { status: 403 },
      );
    }
  } catch (e) {
    console.error("DNS resolution failed:", e);
    return NextResponse.json(
      { error: "Could not resolve hostname" },
      { status: 400 },
    );
  }

  try {
    const provider = getProvider(urlParam);

    if (provider === "youtube") {
      const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(urlParam)}&format=json`;
      const res = await fetch(oembed, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({
          title: data.title,
          thumbnail: data.thumbnail_url,
        });
      }
    } else if (provider === "vimeo") {
      const oembed = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(urlParam)}`;
      const res = await fetch(oembed, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({
          title: data.title,
          thumbnail: data.thumbnail_url,
        });
      }
    }

    // 2. HTTP Streaming with Early Abort and Limits for Generic Providers
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error("Fetch failed");

    let titleBuffer = "";
    let isTitle = false;
    let bytesRead = 0;
    const MAX_BYTES = 50 * 1024; // 50 KB max parsing limit

    const parser = new Parser({
      onopentagname(name) {
        if (name === "title") isTitle = true;
      },
      ontext(text) {
        if (isTitle) titleBuffer += text;
      },
      onclosetag(name) {
        if (name === "title") {
          isTitle = false;
          clearTimeout(timeout);
          controller.abort(); // Cancel the request early!
        }
      },
    });

    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          bytesRead += value.length;
          parser.write(decoder.decode(value, { stream: true }));

          if (titleBuffer && !isTitle) {
            break; // Title fully parsed
          }

          if (bytesRead > MAX_BYTES) {
            controller.abort();
            break;
          }
        }
      } catch (err: any) {
        // AbortError is expected when we early out
        if (err.name !== "AbortError") {
          throw err;
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    }

    parser.end();
    clearTimeout(timeout);

    if (titleBuffer) {
      let title = titleBuffer
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
      title = title.trim();
      title = title
        .replace(/\s*-\s*YouTube$/, "")
        .replace(/\s*-\s*Twitch$/, "");
      return NextResponse.json({ title });
    }
  } catch (e) {
    console.error("Metadata fetch error:", e);
  }

  // Final fallback (URL last segment)
  try {
    const p = new URL(urlParam).pathname.split("/").pop();
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
