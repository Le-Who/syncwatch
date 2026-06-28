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
  requesterId?: string;
  author?: string;
  startPosition?: number;
  lastPosition?: number;
  thumbnail?: string;
  aspectRatio?: number;
  isTemporary?: boolean;
  readyParticipants?: Record<string, boolean>;
}

export interface Participant {
  id: string;
  nickname: string;
  role: "owner" | "moderator" | "viewer";
  lastSeen: number;
  sessionToken?: string;
  ready?: boolean;
  /** P7: Set to true when participant is disconnected but within reconnection window */
  disconnected?: boolean;
}

export interface ChatMessage {
  id: string;
  participantId: string;
  nickname: string;
  message: string;
  sentAt: number;
}

export interface RoomSettings {
  autoplayNext: boolean;
  looping: boolean;
  shuffle?: boolean;
  playlistMode?: "editable" | "append_only";
  requestLeaderOnPause?: boolean;
  unpauseWithoutLeader?: boolean;
  /** Legacy persisted rooms may still contain this value; runtime permissions ignore it. */
  controlMode?: "open" | "controlled" | "hybrid";
}

export interface RoomState {
  id: string;
  name: string;
  settings: RoomSettings;
  participants: Record<string, Participant>;
  playlist: PlaylistItem[];
  chat: ChatMessage[];
  currentMediaId: string | null;
  leaderId: string | null;
  playback: PlaybackState;
  flashbacks: Record<string, { position: number; savedAt: number }>;
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
  duration?: number;
  playbackRate?: number;
  levels?: any[];
  currentLevel?: number;
  dataset?: DOMStringMap;
  addEventListener?: (type: string, listener: (event: any) => void) => void;
  setPlaybackRate?: (rate: number) => void;
  setQuality?: (quality: string) => void;
  setPlaybackQualityRange?: (min: string, max?: string) => void;
}
