import ReactPlayer from "react-player";
import {
  expandMediaInput,
  extractStartPositionFromUrl,
  extractYouTubePlaylistId,
} from "./media-input";

export type MediaInsertMode = "next" | "end";

export interface MediaSeed {
  url?: string;
  provider?: string;
  title?: string;
  duration?: number;
  startPosition?: number;
  thumbnail?: string;
  author?: string;
  aspectRatio?: number;
}

export interface MediaAddCommand {
  type: "add_item" | "add_items";
  payload: Record<string, any>;
}

interface BuildMediaAddCommandOptions {
  insertMode?: MediaInsertMode;
  seed?: MediaSeed;
  fetcher?: (input: string) => Promise<{
    ok: boolean;
    json: () => Promise<any>;
  }>;
  canPlay?: (url: string) => boolean;
}

export class MediaComposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaComposeError";
  }
}

const DEFAULT_INSERT_MODE: MediaInsertMode = "end";

export async function buildMediaAddCommand(
  input: string,
  options: BuildMediaAddCommandOptions = {},
): Promise<MediaAddCommand> {
  const urls = expandMediaInput(input);
  if (urls.length === 0) {
    throw new MediaComposeError("Paste a media URL first.");
  }

  const insertMode = options.insertMode ?? DEFAULT_INSERT_MODE;
  const fetcher = options.fetcher ?? ((url: string) => fetch(url));
  const canPlay =
    options.canPlay ?? ((url: string) => Boolean(ReactPlayer.canPlay?.(url)));

  const playlistId = urls.length === 1 ? extractYouTubePlaylistId(urls[0]) : null;
  if (playlistId) {
    const items = await fetchYouTubePlaylistItems(playlistId, fetcher);
    return {
      type: "add_items",
      payload: {
        insertMode,
        items,
      },
    };
  }

  const items = await Promise.all(
    urls.map((url) =>
      buildMediaItem(url, {
        seed: urls.length === 1 ? options.seed : undefined,
        fetcher,
        canPlay,
      }),
    ),
  );

  if (items.length === 1) {
    return {
      type: "add_item",
      payload: {
        ...items[0],
        insertMode,
      },
    };
  }

  return {
    type: "add_items",
    payload: {
      insertMode,
      items,
    },
  };
}

async function fetchYouTubePlaylistItems(
  listId: string,
  fetcher: BuildMediaAddCommandOptions["fetcher"],
) {
  const response = await fetcher!(`/api/youtube/playlist?listId=${listId}`);
  if (!response.ok) {
    throw new MediaComposeError("Could not load the YouTube playlist.");
  }

  const data = await response.json();
  const videos = Array.isArray(data.videos) ? data.videos : [];
  if (videos.length === 0) {
    throw new MediaComposeError("The YouTube playlist has no playable videos.");
  }

  return videos.map((video: any) =>
    compactMediaItem({
      url: video.url,
      provider: "youtube",
      title: video.title || "YouTube Video",
      duration: Number(video.duration) || 0,
      startPosition: 0,
      thumbnail: video.thumbnail,
      author: video.author,
    }),
  );
}

async function buildMediaItem(
  url: string,
  options: Required<
    Pick<BuildMediaAddCommandOptions, "canPlay" | "fetcher">
  > & { seed?: MediaSeed },
) {
  assertValidMediaUrl(url, options.canPlay);

  const seed = options.seed;
  const metadata =
    seed?.title || seed?.thumbnail || seed?.author || seed?.aspectRatio
      ? {}
      : await fetchMetadata(url, options.fetcher);
  const provider = seed?.provider || detectProvider(url);

  return compactMediaItem({
    url,
    provider,
    title: seed?.title || metadata.title || fallbackTitle(provider),
    duration: seed?.duration ?? (Number(metadata.duration) || 0),
    startPosition:
      seed?.startPosition ?? extractStartPositionFromUrl(url),
    thumbnail: seed?.thumbnail || metadata.thumbnail,
    author: seed?.author || metadata.author,
    aspectRatio: seed?.aspectRatio || metadata.aspectRatio,
  });
}

function assertValidMediaUrl(url: string, canPlay: (url: string) => boolean) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("bad protocol");
    }
  } catch {
    throw new MediaComposeError("Enter a valid HTTP or HTTPS media URL.");
  }

  if (!canPlay(url)) {
    throw new MediaComposeError("This URL is not supported by the player.");
  }
}

async function fetchMetadata(
  url: string,
  fetcher: BuildMediaAddCommandOptions["fetcher"],
) {
  try {
    const response = await fetcher!(`/api/metadata?url=${encodeURIComponent(url)}`);
    if (!response.ok) return {};
    const data = await response.json();
    return typeof data === "object" && data ? data : {};
  } catch {
    return {};
  }
}

function detectProvider(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
    if (host.includes("vimeo.com")) return "vimeo";
    if (host.includes("twitch.tv")) return "twitch";
    if (host.includes("soundcloud.com")) return "soundcloud";
  } catch {
    return "media";
  }

  if (/\.(mp4|webm|ogg|m3u8|mpd)(\?|#|$)/i.test(url)) return "direct";
  return "media";
}

function fallbackTitle(provider: string): string {
  switch (provider) {
    case "youtube":
      return "YouTube Video";
    case "vimeo":
      return "Vimeo Video";
    case "twitch":
      return "Twitch Stream";
    case "soundcloud":
      return "SoundCloud Track";
    case "direct":
      return "Direct Media";
    default:
      return "Media";
  }
}

function compactMediaItem(input: Record<string, any>) {
  const item: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") {
      item[key] = value;
    }
  }
  return item;
}
