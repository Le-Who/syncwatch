import { create } from "zustand";
import { persist } from "zustand/middleware";
import { roomSocketService } from "./socket";
import { toast } from "sonner";
import {
  RoomState,
  PlaybackStatus,
  PlaybackState,
  PlaylistItem,
  Participant,
  RoomSettings,
} from "./types";

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
  occRollbackTick: number;
  isResyncing: boolean;
  resyncSession: () => Promise<void>;
  setNickname: (name: string) => void;
  connect: (roomId: string, nickname: string) => Promise<void>;
  disconnect: () => void;
  sendCommand: (type: string, payload?: any) => void;
  triggerOccRollback: () => void;
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
  occRollbackTick: 0,
  isResyncing: false,
  triggerOccRollback: () =>
    set((state) => ({ occRollbackTick: state.occRollbackTick + 1 })),
  resyncSession: async () => {
    const state = get();
    if (state.isResyncing) return;
    set({ isResyncing: true });
    setTimeout(() => {
      set({ isResyncing: false });
    }, 60000);

    if (state.room && typeof window !== "undefined") {
      try {
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId: state.participantId }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            set({ sessionToken: data.token });
            roomSocketService.upgradeSession(
              state.room.id,
              state.commandSequence + 1,
              data.token,
            );

            setTimeout(() => {
              while (roomSocketService.commandQueue.length > 0) {
                const cmd = roomSocketService.commandQueue.shift();
                if (cmd) {
                  roomSocketService.sendCommand(
                    cmd.roomId,
                    cmd.sequence,
                    cmd.type,
                    cmd.payload,
                    get().participantId,
                  );
                }
              }
            }, 600);
          }
        }
      } catch (e) {
        console.warn("Failed to resync session", e);
        roomSocketService.commandQueue = [];
      }
    }
  },
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

      // Expose to window for Playwright E2E introspection
      (window as any).useRoomStore = { getState: get, setState: set };
      (window as any).__roomSocketService = roomSocketService;

      roomSocketService.on("connected", () => {
        set({ isConnected: true });
        const state = get();
        if (state.room && state.participantId) {
          roomSocketService.joinRoom(
            state.room.id,
            state.room.participants[state.participantId]?.nickname || "User",
            state.participantId,
          );
        }
        if (state.sessionToken && state.room) {
          roomSocketService.upgradeSession(
            state.room.id,
            state.commandSequence,
            state.sessionToken,
          );
        }
      });

      roomSocketService.on("disconnected", () => {
        set({ isConnected: false });
      });

      roomSocketService.on("room_state", (payload: any) => {
        const { serverClockOffset } = get();
        let newOffset = serverClockOffset;
        if (serverClockOffset === 0) {
          newOffset = payload.serverTime - Date.now();
        }
        set({
          room: payload.room,
          serverClockOffset: newOffset,
          commandSequence: payload.room.sequence,
        });
      });

      roomSocketService.on("clock_sync", ({ offset }) => {
        set({ serverClockOffset: offset });
      });

      roomSocketService.on("participant_joined", (participant: any) => {
        const state = get();
        if (!state.room) return;
        set({
          room: {
            ...state.room,
            participants: {
              ...state.room.participants,
              [participant.id]: participant,
            },
          },
        });
      });

      roomSocketService.on("participant_left", ({ participantId }) => {
        const state = get();
        if (!state.room) return;
        const newParticipants = { ...state.room.participants };
        delete newParticipants[participantId];
        set({ room: { ...state.room, participants: newParticipants } });
      });

      roomSocketService.on("session_upgraded", ({ participantId }) => {
        set({ participantId });
      });

      roomSocketService.on("error", (error: any) => {
        const msg = error.message || "An error occurred";
        if (msg === "VERSION_CONFLICT") {
          toast("Sync Adjustment", {
            description:
              "Another user changed the state first. Rolling back to server time.",
            icon: "⏪",
          });
          get().triggerOccRollback();
          return;
        }

        if (
          !msg.includes("Too many") &&
          !msg.includes("Rate limit") &&
          !msg.includes("Guest commands blocked")
        ) {
          toast.error(msg);
        }

        if (msg.includes("Unauthorized") || msg.includes("Guest")) {
          if (
            roomSocketService.lastCommand &&
            !roomSocketService.commandQueue.includes(
              roomSocketService.lastCommand,
            )
          ) {
            roomSocketService.commandQueue.push(roomSocketService.lastCommand);
            roomSocketService.lastCommand = null;
          }
          get().resyncSession();
        }
      });
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
          if (get().room?.id === roomId) {
            roomSocketService.upgradeSession(
              roomId,
              get().commandSequence,
              data.token,
            );
          }
        }
        roomSocketService.connect(
          roomId,
          nickname,
          pId as string,
          data.token || sToken,
        );
      }
    } catch (err) {
      console.warn("Could not establish secure session", err);
      // Fallback
      roomSocketService.connect(roomId, nickname, pId as string, sToken);
    }
  },
  disconnect: () => {
    roomSocketService.disconnect();
    set({ isConnected: false, room: null });
  },
  sendCommand: (type: string, payload?: any) => {
    const isFastPath = [
      "play",
      "pause",
      "seek",
      "update_rate",
      "buffering",
      "sync_correction",
    ].includes(type);

    if (isFastPath) {
      // Inject atomic nonce for action deduplication (Anti-Echo/Rollback)
      payload = { ...payload, nonce: crypto.randomUUID() };
    }

    const state = get();
    if (!state.room) return;

    set((s) => ({
      commandSequence: s.commandSequence + 1,
    }));

    roomSocketService.sendCommand(
      state.room.id,
      state.commandSequence + 1,
      type,
      payload,
      state.participantId,
    );
  },
}));
