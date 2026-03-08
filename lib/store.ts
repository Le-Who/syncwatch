import { create } from "zustand";
import { persist } from "zustand/middleware";
import { roomSocketService } from "./socket";
import { toast } from "sonner";

export type PlaybackStatus = "playing" | "paused" | "buffering" | "ended";

export interface PlaybackState {
  status: PlaybackStatus;
  basePosition: number;
  baseTimestamp: number;
  rate: number;
  updatedBy: string;
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
}

interface LocalSettingsState {
  volume: number;
  muted: boolean;
  theaterMode: boolean;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  toggleTheaterMode: () => void;
}

export const useSettingsStore = create<LocalSettingsState>()(
  persist(
    (set) => ({
      volume: 0.8,
      muted: false,
      theaterMode: false,
      setVolume: (volume) => set({ volume }),
      setMuted: (muted) => set({ muted }),
      toggleTheaterMode: () =>
        set((state) => ({ theaterMode: !state.theaterMode })),
    }),
    { name: "syncwatch-settings" },
  ),
);

interface AppState {
  room: RoomState | null;
  serverClockOffset: number;
  isConnected: boolean;
  participantId: string | null;
  sessionToken: string | null;
  nickname: string;
  commandSequence: number;
  setNickname: (name: string) => void;
  connect: (roomId: string, nickname: string) => Promise<void>;
  disconnect: () => void;
  sendCommand: (type: string, payload?: any) => void;
  init: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  room: null,
  serverClockOffset: 0,
  isConnected: false,
  participantId: null,
  sessionToken: null,
  nickname: "",
  commandSequence: 1,
  init: () => {
    if (typeof window !== "undefined") {
      const storedName = localStorage.getItem("nickname") || "";
      const storedId =
        localStorage.getItem("participantId") || crypto.randomUUID();
      const storedToken = localStorage.getItem("sessionToken") || null;
      localStorage.setItem("participantId", storedId);
      set({
        nickname: storedName,
        participantId: storedId,
        sessionToken: storedToken,
      });

      // Inject Zustand state getters/setters into the Socket Service
      roomSocketService.init(get, set);
    }
  },
  setNickname: (name: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("nickname", name);
    }
    set({ nickname: name });
    const { isConnected, room } = get();
    if (isConnected && room) {
      get().sendCommand("update_nickname", { nickname: name });
    }
  },
  connect: async (roomId: string, nickname: string) => {
    let pId = get().participantId;
    let sToken = get().sessionToken;
    if (!pId && typeof window !== "undefined") {
      pId = localStorage.getItem("participantId") || crypto.randomUUID();
      sToken = localStorage.getItem("sessionToken") || null;
      localStorage.setItem("participantId", pId);
      set({ participantId: pId, sessionToken: sToken });
    }

    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: pId }),
      });
      if (!res.ok) {
        toast.error("Handshake failed. Features may be restricted.");
      } else {
        const data = await res.json();
        if (data.token) {
          set({ sessionToken: data.token });
          // Hot-swap the connection immediately if it was already connected as guest
          roomSocketService.upgradeSession(data.token);
        }
        roomSocketService.connect(roomId, nickname, pId as string);
      }
    } catch (err) {
      console.warn("Could not establish secure session", err);
      // Fallback
      roomSocketService.connect(roomId, nickname, pId as string);
    }
  },
  disconnect: () => {
    roomSocketService.disconnect();
    set({ isConnected: false, room: null });
  },
  sendCommand: (type: string, payload?: any) => {
    roomSocketService.sendCommand(type, payload);
  },
}));
