import { PlaylistItem } from "./types";

const playlistIndexCache = new WeakMap<PlaylistItem[], Map<string, number>>();

export function getPlaylistIndex(playlist: PlaylistItem[], id: string): number {
  let indexMap = playlistIndexCache.get(playlist);
  if (!indexMap) {
    indexMap = new Map();
    playlist.forEach((item, idx) => indexMap!.set(item.id, idx));
    playlistIndexCache.set(playlist, indexMap);
  }
  return indexMap.get(id) ?? -1;
}

export function getPlaylistItem(playlist: PlaylistItem[], id: string): PlaylistItem | undefined {
  const idx = getPlaylistIndex(playlist, id);
  if (idx === -1) return undefined;
  return playlist[idx];
}
