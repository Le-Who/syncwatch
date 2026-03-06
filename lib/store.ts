import { create } from "zustand";
import { getSocket } from "./socket";
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

interface AppState {
  room: RoomState | null;
  serverClockOffset: number;
  isConnected: boolean;
  participantId: string | null;
  nickname: string;
  commandSequence: number;
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
  commandSequence: 1,
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

      // NTP-style clock sync
      let pings = 0;
      let offsets: number[] = [];

      const doPing = () => {
        socket.emit(
          "ping_time",
          Date.now(),
          (serverTime: number, clientTime: number) => {
            const end = Date.now();
            const rtt = end - clientTime;
            // Offset = server point of view - client point of view
            // If server is 1000 and client is 500, offset is 500 (sync client + 500)
            const offset = serverTime - (end - rtt / 2);

            offsets.push(offset);
            if (offsets.length > 5) offsets.shift();

            const sorted = [...offsets].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];

            set({ serverClockOffset: median });
          },
        );
      };

      doPing();
      const pingInterval = setInterval(() => {
        pings++;
        if (pings > 5) {
          clearInterval(pingInterval);
        } else {
          doPing();
        }
      }, 1000);
    });

    socket.on("disconnect", () => {
      set({ isConnected: false });
    });

    socket.on(
      "room_state",
      (payload: { room: RoomState; serverTime: number }) => {
        const { serverClockOffset, commandSequence } = get();

        // Update our sync offset if we haven't done NTP yet
        let newOffset = serverClockOffset;
        if (serverClockOffset === 0) {
          newOffset = payload.serverTime - Date.now();
        }

        // Check for stale event (optimistic UI rejection)
        // If server sends a sequence less than what we've already sent,
        // we ignore their playback state but we can accept participant changes.
        // For simplicity and safety, we merge the room but keep our command sequence.

        const previousRoom = get().room;

        // Check for state changes to trigger toasts
        if (previousRoom) {
          // Playback status change
          if (
            previousRoom.playback.status !== payload.room.playback.status &&
            payload.room.playback.updatedBy !== get().nickname &&
            payload.room.playback.updatedBy !== "system"
          ) {
            const action =
              payload.room.playback.status === "playing"
                ? "▶️ Started playing via"
                : payload.room.playback.status === "paused"
                  ? "⏸️ Paused by"
                  : payload.room.playback.status === "buffering"
                    ? "⏳ Buffering for"
                    : "Playback updated by";
            toast(`${action} ${payload.room.playback.updatedBy}`);
          }

          // Video added
          if (previousRoom.playlist.length < payload.room.playlist.length) {
            const newVideos = payload.room.playlist.filter(
              (item) => !previousRoom.playlist.some((p) => p.id === item.id),
            );
            newVideos.forEach((v) => {
              if (v.addedBy !== get().nickname) {
                toast(`🎵 Video added by ${v.addedBy}`);
              }
            });
          }
        }

        set({
          room: payload.room,
          serverClockOffset: newOffset,
          commandSequence: payload.room.sequence,
        });
      },
    );

    socket.on("participant_joined", (participant: Participant) => {
      toast(`👋 ${participant.nickname} joined the room`);
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
        const participant = state.room.participants[participantId];
        if (participant) {
          toast(`🚪 ${participant.nickname} left the room`);
        }

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
    const { room, isConnected, commandSequence } = get();
    if (room && isConnected) {
      const nextSequence = commandSequence + 1;
      set({ commandSequence: nextSequence });
      getSocket().emit("command", {
        roomId: room.id,
        type,
        payload,
        sequence: nextSequence,
      });
    }
  },
}));
