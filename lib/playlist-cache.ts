import { PlaylistItem } from "./types";

const indexCache = new WeakMap<PlaylistItem[], Map<string, number>>();

export function getPlaylistIndexMap(playlist: PlaylistItem[]): Map<string, number> {
  let map = indexCache.get(playlist);
  if (!map) {
    map = new Map();
    for (let i = 0; i < playlist.length; i++) {
      map.set(playlist[i].id, i);
    }
    indexCache.set(playlist, map);
  }
  return map;
}
