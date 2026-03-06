import { create } from "zustand";
import { getSocket } from "./socket";

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
}

interface AppState {
  room: RoomState | null;
  serverClockOffset: number;
  isConnected: boolean;
  participantId: string | null;
  nickname: string;
  setNickname: (name: string) => void;
  connect: (roomId: string, nickname: string) => void;
  disconnect: () => void;
  sendCommand: (type: string, payload?: any) => void;
  init: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  room: null,
  serverClockOffset: 0,
  isConnected: false,
  participantId: null,
  nickname: "",
  init: () => {
    if (typeof window !== "undefined") {
      const storedName = localStorage.getItem("nickname") || "";
      const storedId =
        localStorage.getItem("participantId") || crypto.randomUUID();
      localStorage.setItem("participantId", storedId);
      set({ nickname: storedName, participantId: storedId });
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
  connect: (roomId: string, nickname: string) => {
    const socket = getSocket();
    let pId = get().participantId;
    if (!pId && typeof window !== "undefined") {
      pId = localStorage.getItem("participantId") || crypto.randomUUID();
      localStorage.setItem("participantId", pId);
      set({ participantId: pId });
    }

    // Remove previous listeners to avoid duplicates
    socket.off("connect");
    socket.off("disconnect");
    socket.off("room_state");
    socket.off("participant_joined");
    socket.off("participant_left");

    socket.on("connect", () => {
      set({ isConnected: true });
      socket.emit("join_room", { roomId, nickname, participantId: pId });
    });

    socket.on("disconnect", () => {
      set({ isConnected: false });
    });

    socket.on("room_state", (payload: { room: RoomState; serverTime: number }) => {
      const offset = payload.serverTime - Date.now();
      set({ room: payload.room, serverClockOffset: offset });
    });

    socket.on("participant_joined", (participant: Participant) => {
      set((state) => {
        if (!state.room) return state;
        return {
          room: {
            ...state.room,
            participants: {
              ...state.room.participants,
              [participant.id]: participant,
            },
          },
        };
      });
    });

    socket.on("participant_left", ({ participantId }) => {
      set((state) => {
        if (!state.room) return state;
        const newParticipants = { ...state.room.participants };
        delete newParticipants[participantId];
        return {
          room: {
            ...state.room,
            participants: newParticipants,
          },
        };
      });
    });

    socket.connect();
  },
  disconnect: () => {
    const socket = getSocket();
    socket.disconnect();
    set({ room: null, isConnected: false });
  },
  sendCommand: (type: string, payload?: any) => {
    const { room, isConnected } = get();
    if (room && isConnected) {
      getSocket().emit("command", { roomId: room.id, type, payload });
    }
  },
}));
