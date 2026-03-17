export type PlaybackStatus = "playing" | "paused" | "buffering" | "ended";

export interface PlaybackState {
  status: PlaybackStatus;
  basePosition: number;
  baseTimestamp: number;
  rate: number;
  updatedBy: string;
  lastActionNonce?: string;
}

export interface PlaylistItem {
  id: string;
  url: string;
  provider: string;
  title: string;
  duration: number;
  addedBy: string;
  startPosition?: number;
  lastPosition?: number;
  thumbnail?: string;
}

export interface Participant {
  id: string;
  nickname: string;
  role: "owner" | "moderator" | "viewer";
  lastSeen: number;
  sessionToken?: string;
}

export interface RoomSettings {
  controlMode: "open" | "controlled" | "hybrid";
  autoplayNext: boolean;
  looping: boolean;
}

export interface RoomState {
  id: string;
  name: string;
  settings: RoomSettings;
  participants: Record<string, Participant>;
  playlist: PlaylistItem[];
  currentMediaId: string | null;
  playback: PlaybackState;
  version: number;
  sequence: number;
  lastActivity: number;
}

export interface PlayerMethods {
  getCurrentTime?: () => number;
  getDuration?: () => number;
  seekTo?: (position: number, type?: "seconds" | "fraction") => void;
  play?: () => void;
  pause?: () => void;
  getInternalPlayer?: (provider?: string) => any;
  currentTime?: number;
  playbackRate?: number;
  levels?: any[];
  currentLevel?: number;
  dataset?: DOMStringMap;
  addEventListener?: (type: string, listener: (event: any) => void) => void;
  setPlaybackRate?: (rate: number) => void;
  setQuality?: (quality: string) => void;
  setPlaybackQualityRange?: (min: string, max?: string) => void;
}
