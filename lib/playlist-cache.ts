import { PlaylistItem } from "./types";

const playlistIndexCache = new WeakMap<PlaylistItem[], Map<string, number>>();

export function getPlaylistIndexMap(
  playlist: PlaylistItem[],
): Map<string, number> {
  let map = playlistIndexCache.get(playlist);
  if (!map) {
    map = new Map<string, number>();
    for (let i = 0; i < playlist.length; i++) {
      map.set(playlist[i].id, i);
    }
    playlistIndexCache.set(playlist, map);
  }
  return map;
}

export function findPlaylistItem(
  playlist: PlaylistItem[],
  id: string,
): PlaylistItem | undefined {
  const map = getPlaylistIndexMap(playlist);
  const index = map.get(id);
  return index !== undefined ? playlist[index] : undefined;
}

export function findPlaylistItemIndex(
  playlist: PlaylistItem[],
  id: string,
): number {
  const map = getPlaylistIndexMap(playlist);
  const index = map.get(id);
  return index !== undefined ? index : -1;
}
