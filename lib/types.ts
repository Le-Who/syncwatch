export type CanonicalPlaybackStatus = "playing" | "paused" | "ended";
/** @deprecated Use CanonicalPlaybackStatus for in-memory room state. */
export type LegacyPlaybackStatus = CanonicalPlaybackStatus | "buffering";
export type PlaybackStatus = CanonicalPlaybackStatus;

export type ConnectionState = "connected" | "reconnecting" | "disconnected";
export type PlaybackHealth = "idle" | "ready" | "buffering" | "error";

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
  joinedAt: number;
  connection: ConnectionState;
  playbackHealth: PlaybackHealth;
  readyMediaId: string | null;
  lastDriftSeconds?: number;
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

export type LegacyRoomStateInput = Omit<
  Partial<RoomState>,
  "playback" | "participants" | "settings"
> & {
  playback?: Partial<Omit<PlaybackState, "status">> & {
    status?: LegacyPlaybackStatus;
  };
  participants?: Record<string, Partial<Participant>>;
  settings?: Partial<RoomSettings>;
};

function isConnectionState(value: unknown): value is ConnectionState {
  return (
    value === "connected" ||
    value === "reconnecting" ||
    value === "disconnected"
  );
}

function isPlaybackHealth(value: unknown): value is PlaybackHealth {
  return (
    value === "idle" ||
    value === "ready" ||
    value === "buffering" ||
    value === "error"
  );
}

function normalizeParticipant(
  id: string,
  participant: Partial<Participant>,
): Participant {
  const lastSeen =
    typeof participant.lastSeen === "number"
      ? participant.lastSeen
      : Date.now();

  return {
    id: typeof participant.id === "string" ? participant.id : id,
    nickname:
      typeof participant.nickname === "string" ? participant.nickname : id,
    role:
      participant.role === "owner" ||
      participant.role === "moderator" ||
      participant.role === "viewer"
        ? participant.role
        : "viewer",
    lastSeen,
    joinedAt:
      typeof participant.joinedAt === "number"
        ? participant.joinedAt
        : lastSeen,
    connection: isConnectionState(participant.connection)
      ? participant.connection
      : "connected",
    playbackHealth: isPlaybackHealth(participant.playbackHealth)
      ? participant.playbackHealth
      : "idle",
    readyMediaId:
      typeof participant.readyMediaId === "string"
        ? participant.readyMediaId
        : null,
    ...(typeof participant.lastDriftSeconds === "number"
      ? { lastDriftSeconds: participant.lastDriftSeconds }
      : {}),
    ...(typeof participant.sessionToken === "string"
      ? { sessionToken: participant.sessionToken }
      : {}),
    ...(typeof participant.ready === "boolean"
      ? { ready: participant.ready }
      : {}),
    ...(typeof participant.disconnected === "boolean"
      ? { disconnected: participant.disconnected }
      : {}),
  };
}

/**
 * Converts persisted and wire-compatible room state into the canonical
 * in-memory representation used by room logic and UI snapshots.
 */
export function normalizeRoomState(input: LegacyRoomStateInput): RoomState {
  const now = Date.now();
  const playback = input.playback ?? {};
  const participants = Object.fromEntries(
    Object.entries(input.participants ?? {}).map(([id, participant]) => [
      id,
      normalizeParticipant(id, participant),
    ]),
  );

  return {
    id: typeof input.id === "string" ? input.id : "",
    name: typeof input.name === "string" ? input.name : "",
    settings: {
      autoplayNext: input.settings?.autoplayNext ?? true,
      looping: input.settings?.looping ?? false,
      ...(typeof input.settings?.shuffle === "boolean"
        ? { shuffle: input.settings.shuffle }
        : {}),
      ...(input.settings?.playlistMode
        ? { playlistMode: input.settings.playlistMode }
        : {}),
      ...(typeof input.settings?.requestLeaderOnPause === "boolean"
        ? { requestLeaderOnPause: input.settings.requestLeaderOnPause }
        : {}),
      ...(typeof input.settings?.unpauseWithoutLeader === "boolean"
        ? { unpauseWithoutLeader: input.settings.unpauseWithoutLeader }
        : {}),
      ...(input.settings?.controlMode
        ? { controlMode: input.settings.controlMode }
        : {}),
    },
    participants,
    playlist: Array.isArray(input.playlist) ? input.playlist : [],
    chat: Array.isArray(input.chat) ? input.chat : [],
    currentMediaId:
      typeof input.currentMediaId === "string" ? input.currentMediaId : null,
    leaderId:
      typeof input.leaderId === "string" && participants[input.leaderId]
        ? input.leaderId
        : null,
    playback: {
      status:
        playback.status === "playing" || playback.status === "ended"
          ? playback.status
          : "paused",
      basePosition:
        typeof playback.basePosition === "number" ? playback.basePosition : 0,
      baseTimestamp:
        typeof playback.baseTimestamp === "number"
          ? playback.baseTimestamp
          : now,
      rate: typeof playback.rate === "number" ? playback.rate : 1,
      updatedBy:
        typeof playback.updatedBy === "string" ? playback.updatedBy : "system",
      ...(typeof playback.lastActionNonce === "string"
        ? { lastActionNonce: playback.lastActionNonce }
        : {}),
    },
    flashbacks:
      input.flashbacks &&
      typeof input.flashbacks === "object" &&
      !Array.isArray(input.flashbacks)
        ? input.flashbacks
        : {},
    version: typeof input.version === "number" ? input.version : 1,
    sequence: typeof input.sequence === "number" ? input.sequence : 1,
    lastActivity:
      typeof input.lastActivity === "number" ? input.lastActivity : now,
  };
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
