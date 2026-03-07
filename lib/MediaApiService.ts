export interface MediaInfo {
  provider: string;
  title: string;
  duration: number;
  thumbnail?: string;
  url: string;
}

export class MediaApiService {
  static async fetchMediaInfo(url: string): Promise<MediaInfo> {
    let provider = "unknown";
    let title = "Direct Media";
    let duration = 0;
    let thumbnail: string | undefined = undefined;

    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      provider = "youtube";
      try {
        const res = await fetch(
          `/api/youtube/search?q=${encodeURIComponent(url)}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.videos && data.videos.length > 0) {
            title = data.videos[0].title;
            duration = data.videos[0].duration;
            thumbnail = data.videos[0].thumbnail;
          }
        }
      } catch (err) {
        console.error("Failed to fetch YouTube metadata:", err);
      }
    } else {
      if (url.includes("twitch.tv")) provider = "twitch";
      else if (url.includes("vimeo.com")) provider = "vimeo";
      else if (url.includes("soundcloud.com")) provider = "soundcloud";

      try {
        const res = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.title) title = data.title;
          if (data.thumbnail) thumbnail = data.thumbnail;
        }
      } catch (err) {
        console.error("Failed to fetch OpenGraph metadata:", err);
      }
    }

    return { provider, title, duration, thumbnail, url };
  }
}
