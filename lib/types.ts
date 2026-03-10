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
  role: "owner" | "moderator" | "guest";
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
